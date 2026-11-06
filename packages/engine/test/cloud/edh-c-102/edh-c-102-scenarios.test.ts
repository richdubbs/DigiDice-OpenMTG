/**
 * Commander EDHREC ranks 29,001-29,500, round edh-c-102 (third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 607.2a, 400.3          "When ~ leaves the battlefield, return the exiled cards to their owner's graveyard." (Gravegouger)
 *   CR 607.2a, 400.3          "Put all cards exiled with ~ into their owner's hand." (Kyren Archive)
 *   CR 607.2a, 400.3          "When ~ leaves the battlefield, each player returns to their hand all cards they own exiled with it." (Parallax Nexus)
 *   CR 608.2c, 608.2h, 400.7  "Exile all white creatures. For each creature exiled this way, its controller draws a card." (Martyr's Cry)
 *   CR 111.4, 208.3, 608.2h   "Exile target creature card from your graveyard. Create a black Zombie creature token. Its power is equal to that card's power and its toughness is equal to that card's toughness." (Ritual of the Returned)
 *   CR 119.5, 608.2c          "Count the number of permanents you control. Your life total becomes that number." (Touch of the Eternal)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars } from '../../../src/index';
import type { GameState, ObjectId } from '../../../src/index';
import { act, advanceTo, answer, card, cast, drive, find, full, lifeOf, obj, resolveAll, scenario } from '../r4-cost/support';

const zoneOf = (s: GameState, name: string, owner: 'p1' | 'p2'): string => {
  for (const z of ['hand', 'graveyard', 'library'] as const) if (s.zones[z][owner]!.some((id) => s.objects[id]!.defId === name)) return z;
  if (s.zones.exile.some((id) => s.objects[id]!.defId === name && s.objects[id]!.owner === owner)) return 'exile';
  if (s.zones.battlefield.some((id) => s.objects[id]!.defId === name)) return 'battlefield';
  return 'gone';
};
const onBf = (s: GameState, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId);

describe('CR 607.2a, 400.3: "return the exiled cards to their owner\'s graveyard" (Gravegouger)', () => {
  const WARDEN = card('Test Grave Warden', 'Creature — Horror', 'When this creature enters, exile up to two target cards from a single graveyard.\nWhen this creature leaves the battlefield, return the exiled cards to their owner\'s graveyard.', '{0}', ['2', '2']);
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  const X1 = card('Test Relic One', 'Artifact', '');
  const X2 = card('Test Relic Two', 'Artifact', '');
  const X3 = card('Test Relic Three', 'Artifact', '');
  const board = (): GameState => scenario([], { defs: [WARDEN, SMITE, X1, X2, X3], p1: { hand: ['Test Grave Warden', 'Test Smite'], graveyard: ['Test Relic Three'] }, p2: { graveyard: ['Test Relic One', 'Test Relic Two'] } });
  const entered = (): GameState => {
    const s0 = board();
    const a = find(s0, 'Test Relic One', 'graveyard', 'p2');
    const b = find(s0, 'Test Relic Two', 'graveyard', 'p2');
    return resolveAll(cast(s0, 'Test Grave Warden'), { options: [['p2']], targets: [[obj(a), obj(b)]] });
  };
  it('is full', () => expect(full(WARDEN)).toBe(true));
  it('the two cards are exiled when it enters', () => {
    const s = entered();
    expect(zoneOf(s, 'Test Relic One', 'p2')).toBe('exile');
    expect(zoneOf(s, 'Test Relic Two', 'p2')).toBe('exile');
  });
  it('when it leaves the battlefield the exiled cards return to their OWNER\'s graveyard (the opponent\'s), not to the controller\'s', () => {
    let s = entered();
    s = resolveAll(cast(s, 'Test Smite', { targets: [[obj(onBf(s, 'Test Grave Warden')[0]!)]] }));
    expect(zoneOf(s, 'Test Relic One', 'p2')).toBe('graveyard');
    expect(zoneOf(s, 'Test Relic Two', 'p2')).toBe('graveyard');
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId.startsWith('Test Relic One'))).toBe(false);
  });
  it('negative: a card that was not exiled with it stays where it is (the controller\'s own graveyard card)', () => {
    let s = entered();
    s = resolveAll(cast(s, 'Test Smite', { targets: [[obj(onBf(s, 'Test Grave Warden')[0]!)]] }));
    expect(zoneOf(s, 'Test Relic Three', 'p1')).toBe('graveyard');
  });
  it('negative: while it stays on the battlefield the cards stay exiled', () => {
    const s = entered();
    expect(zoneOf(s, 'Test Relic One', 'p2')).toBe('exile');
    expect(onBf(s, 'Test Grave Warden')).toHaveLength(1);
  });
});

describe('CR 607.2a, 400.3: "Put all cards exiled with ~ into their owner\'s hand" (Kyren Archive)', () => {
  const ARCHIVE = card('Test Book Vault', 'Artifact — Book', '{0}: Exile target card from a graveyard face down.\n{0}, Sacrifice this artifact: Put all cards exiled with this artifact into their owner\'s hand.');
  const A = card('Test Scroll One', 'Artifact', '');
  const B = card('Test Scroll Two', 'Artifact', '');
  const board = (): GameState => scenario([], { defs: [ARCHIVE, A, B], p1: { battlefield: ['Test Book Vault'], graveyard: ['Test Scroll One'] }, p2: { graveyard: ['Test Scroll Two'] } });
  it('is full', () => expect(full(ARCHIVE)).toBe(true));
  it('every card exiled with it goes to its owner\'s hand: the opponent\'s card to the opponent, yours to you', () => {
    let s = board();
    const vault = find(s, 'Test Book Vault', 'battlefield', 'p1');
    s = drive(act(s, { type: 'activate', player: 'p1', source: vault, ability: 'p:0:0' }), { targets: [[obj(find(s, 'Test Scroll One', 'graveyard', 'p1'))]] });
    s = resolveAll(s);
    s = drive(act(s, { type: 'activate', player: 'p1', source: vault, ability: 'p:0:0' }), { targets: [[obj(find(s, 'Test Scroll Two', 'graveyard', 'p2'))]] });
    s = resolveAll(s);
    expect(zoneOf(s, 'Test Scroll One', 'p1')).toBe('exile');
    expect(zoneOf(s, 'Test Scroll Two', 'p2')).toBe('exile');
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: vault, ability: 'p:0:1' })));
    expect(zoneOf(s, 'Test Scroll One', 'p1')).toBe('hand');
    expect(zoneOf(s, 'Test Scroll Two', 'p2')).toBe('hand');
  });
  it('negative: a card exiled by something else is not returned', () => {
    const OTHER = card('Test Other Exiler', 'Sorcery', 'Exile target card from a graveyard.');
    const s0 = scenario([], { defs: [ARCHIVE, A, B, OTHER], p1: { battlefield: ['Test Book Vault'], hand: ['Test Other Exiler'], graveyard: ['Test Scroll One'] }, p2: { graveyard: ['Test Scroll Two'] } });
    const vault = find(s0, 'Test Book Vault', 'battlefield', 'p1');
    let s = resolveAll(cast(s0, 'Test Other Exiler', { targets: [[obj(find(s0, 'Test Scroll Two', 'graveyard', 'p2'))]] }));
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: vault, ability: 'p:0:0' }), { targets: [[obj(find(s, 'Test Scroll One', 'graveyard', 'p1'))]] }));
    s = resolveAll(drive(act(s, { type: 'activate', player: 'p1', source: vault, ability: 'p:0:1' })));
    expect(zoneOf(s, 'Test Scroll One', 'p1')).toBe('hand');
    expect(zoneOf(s, 'Test Scroll Two', 'p2')).toBe('exile');
  });
});

describe('CR 607.2a, 400.3: "each player returns to their hand all cards they own exiled with it" (Parallax Nexus)', () => {
  const NEXUS = card('Test Parallax Well', 'Enchantment', '{0}: Target opponent exiles a card from their hand. Activate only as a sorcery.\nWhen this enchantment leaves the battlefield, each player returns to their hand all cards they own exiled with it.');
  const SMITE = card('Test Unmake', 'Instant', 'Destroy target enchantment.');
  const A = card('Test Card Alpha', 'Artifact', '');
  it('is full', () => expect(full(NEXUS)).toBe(true));
  it('the card the opponent exiled returns to the opponent\'s hand when it leaves the battlefield; none before', () => {
    const s0 = scenario([], { defs: [NEXUS, SMITE, A], p1: { battlefield: ['Test Parallax Well'], hand: ['Test Unmake'] }, p2: { hand: ['Test Card Alpha'] } });
    const well = find(s0, 'Test Parallax Well', 'battlefield', 'p1');
    let s = resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: well, ability: 'p:0:0' }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(zoneOf(s, 'Test Card Alpha', 'p2')).toBe('exile');
    s = resolveAll(cast(s, 'Test Unmake', { targets: [[obj(well)]] }));
    expect(zoneOf(s, 'Test Card Alpha', 'p2')).toBe('hand');
  });
  it('negative: if it never exiled a card, nothing is returned (the opponent\'s hand card stays)', () => {
    const s0 = scenario([], { defs: [NEXUS, SMITE, A], p1: { battlefield: ['Test Parallax Well'], hand: ['Test Unmake'] }, p2: { hand: ['Test Card Alpha'] } });
    const well = find(s0, 'Test Parallax Well', 'battlefield', 'p1');
    const s = resolveAll(cast(s0, 'Test Unmake', { targets: [[obj(well)]] }));
    expect(zoneOf(s, 'Test Card Alpha', 'p2')).toBe('hand');
    expect(onBf(s, 'Test Parallax Well')).toHaveLength(0);
  });
});

describe('CR 119.5, 608.2c: "count the number of permanents you control. Your life total becomes that number." (Touch of the Eternal)', () => {
  const TOUCH = card('Test Eternal Touch', 'Enchantment', 'At the beginning of your upkeep, count the number of permanents you control. Your life total becomes that number.');
  const RING = card('Test Ring', 'Artifact', '');
  it('is full', () => expect(full(TOUCH)).toBe(true));
  it('at your upkeep your life total becomes the number of permanents you control (the Touch counts itself): 3 permanents, life 20 -> 3', () => {
    let s = scenario([], { defs: [TOUCH, RING], p1: { battlefield: ['Test Eternal Touch', 'Test Ring', 'Test Ring'] }, p2: { battlefield: ['Test Ring'] } });
    s = resolveAll(advanceTo(s, 3, 'upkeep'));
    expect(lifeOf(s, 'p1')).toBe(3);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('life can go up too: 22 permanents (lands included) on a 20-life player -> 22', () => {
    const lands = Array(21).fill('Plains') as string[];
    let s = scenario([], { defs: [TOUCH], p1: { battlefield: ['Test Eternal Touch', ...lands] } });
    s = resolveAll(advanceTo(s, 3, 'upkeep'));
    expect(lifeOf(s, 'p1')).toBe(22);
  });
  it('ruling 2012-07-01: the change counts as life gain or life loss (CR 119.5): a "whenever you gain life" watcher sees 20 -> 22, a "whenever you lose life" watcher sees 20 -> 3', () => {
    const GAIN = card('Test Gain Watcher', 'Enchantment', 'Whenever you gain life, you draw a card.');
    const LOSE = card('Test Lose Watcher', 'Enchantment', 'Whenever you lose life, you draw a card.');
    const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
    const lands = Array(21).fill('Plains') as string[];
    let up = scenario([], { defs: [TOUCH, GAIN], p1: { battlefield: ['Test Eternal Touch', 'Test Gain Watcher', ...lands.slice(0, 20)] } });
    const before = handSize(advanceTo(up, 3, 'upkeep'));
    up = resolveAll(advanceTo(up, 3, 'upkeep'));
    expect(lifeOf(up, 'p1')).toBe(22);
    expect(handSize(up)).toBe(before + 1);
    let down = scenario([], { defs: [TOUCH, LOSE, RING], p1: { battlefield: ['Test Eternal Touch', 'Test Lose Watcher', 'Test Ring'] } });
    const beforeDown = handSize(advanceTo(down, 3, 'upkeep'));
    down = resolveAll(advanceTo(down, 3, 'upkeep'));
    expect(lifeOf(down, 'p1')).toBe(3);
    expect(handSize(down)).toBe(beforeDown + 1);
  });
  it('negative: not at the opponent\'s upkeep (turn 2): life is still 20', () => {
    let s = scenario([], { defs: [TOUCH, RING], p1: { battlefield: ['Test Eternal Touch', 'Test Ring'] } });
    s = resolveAll(advanceTo(s, 2, 'upkeep'));
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('negative: only YOUR permanents count (the opponent\'s do not)', () => {
    let s = scenario([], { defs: [TOUCH, RING], p1: { battlefield: ['Test Eternal Touch'] }, p2: { battlefield: ['Test Ring', 'Test Ring', 'Test Ring'] } });
    s = resolveAll(advanceTo(s, 3, 'upkeep'));
    expect(lifeOf(s, 'p1')).toBe(1);
  });
});

describe('CR 608.2c, 608.2h, 400.7: "Exile all white creatures. For each creature exiled this way, its controller draws a card." (Martyr\'s Cry)', () => {
  const CRY = card('Test Martyr Wail', 'Sorcery', 'Exile all white creatures. For each creature exiled this way, its controller draws a card.');
  const W = card('Test White Knight', 'Creature — Knight', '', '{0}', ['2', '2'], ['W']);
  const G = card('Test Green Bear', 'Creature — Bear', '', '{0}', ['2', '2'], ['G']);
  const B = card('Test Black Rat', 'Creature — Rat', '', '{0}', ['1', '1'], ['B']);
  const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
  const board = (): GameState => scenario([], { defs: [CRY, W, G, B], p1: { hand: ['Test Martyr Wail'], battlefield: ['Test White Knight', 'Test White Knight', 'Test Green Bear'] }, p2: { battlefield: ['Test White Knight', 'Test Black Rat'] } });
  it('is full', () => expect(full(CRY)).toBe(true));
  it('every white creature is exiled and each controller draws one card per creature of theirs: you draw 2, the opponent 1', () => {
    const s0 = board();
    const [h1, h2] = [handSize(s0, 'p1'), handSize(s0, 'p2')];
    const s = resolveAll(cast(s0, 'Test Martyr Wail'));
    expect(onBf(s, 'Test White Knight')).toHaveLength(0);
    expect(handSize(s, 'p1')).toBe(h1 - 1 + 2);
    expect(handSize(s, 'p2')).toBe(h2 + 1);
  });
  it('negative: non-white creatures stay and do not draw (the green Bear and the black Rat)', () => {
    const s = resolveAll(cast(board(), 'Test Martyr Wail'));
    expect(onBf(s, 'Test Green Bear')).toHaveLength(1);
    expect(onBf(s, 'Test Black Rat')).toHaveLength(1);
  });
  it('negative: a player with no white creature draws nothing', () => {
    const s0 = scenario([], { defs: [CRY, W, G], p1: { hand: ['Test Martyr Wail'], battlefield: ['Test Green Bear'] }, p2: { battlefield: ['Test White Knight'] } });
    const [h1, h2] = [handSize(s0, 'p1'), handSize(s0, 'p2')];
    const s = resolveAll(cast(s0, 'Test Martyr Wail'));
    expect(handSize(s, 'p1')).toBe(h1 - 1);
    expect(handSize(s, 'p2')).toBe(h2 + 1);
  });
});

describe('CR 111.4, 208.3, 608.2h: the Zombie token takes the exiled card\'s power and toughness (Ritual of the Returned)', () => {
  const RITE = card('Test Dark Rite', 'Instant', 'Exile target creature card from your graveyard. Create a black Zombie creature token. Its power is equal to that card\'s power and its toughness is equal to that card\'s toughness.');
  const BIG = card('Test Big Lizard', 'Creature — Lizard', '', '{0}', ['5', '2'], ['G']);
  const SMALL = card('Test Small Fly', 'Creature — Insect', '', '{0}', ['1', '4'], ['G']);
  const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
  const board = (): GameState => scenario([], { defs: [RITE, BIG, SMALL], p1: { hand: ['Test Dark Rite'], graveyard: ['Test Big Lizard', 'Test Small Fly'] }, p2: { graveyard: ['Test Small Fly'] } });
  it('is full', () => expect(full(RITE)).toBe(true));
  it('power and toughness are copied separately: a 5/2 card makes a black 5/2 Zombie, a 1/4 card a 1/4 Zombie; the card is exiled', () => {
    for (const [name, expected] of [['Test Big Lizard', '5/2'], ['Test Small Fly', '1/4']] as const) {
      const s0 = board();
      const target = find(s0, name, 'graveyard', 'p1');
      const s = resolveAll(cast(s0, 'Test Dark Rite', { targets: [[obj(target)]] }));
      const z = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
      expect(z, name).toHaveLength(1);
      expect(pt(s, z[0]!), name).toBe(expected);
      expect(getChars(s, z[0]!)!.colors, name).toEqual(['B']);
      expect(getChars(s, z[0]!)!.subtypes, name).toContain('Zombie');
      expect(zoneOf(s, name, 'p1'), name).toBe('exile');
    }
  });
  it('negative: it targets a creature card in YOUR graveyard only (the opponent\'s card is not a legal target)', () => {
    const s0 = board();
    const theirs = find(s0, 'Test Small Fly', 'graveyard', 'p2');
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dark Rite', 'hand', 'p1') });
    const r = applyAction(s1, { type: 'answer', player: 'p1', decisionId: s1.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(theirs)] } });
    expect(r.error).toBeDefined();
  });
});
