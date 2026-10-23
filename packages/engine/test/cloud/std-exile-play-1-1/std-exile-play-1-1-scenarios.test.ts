/**
 * std-exile-play-1-1 (lane std-exile-play-1: play or cast from exile and from the top of a library): the round's readings played through the engine with synthetic
 * cards compiled by the game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 118.9, 202.3, 401.5, 601.3   "Until end of turn, you may look at the top card of your library any time and you may play cards from the top of your library. If you
 *                                   cast a spell this way, pay life equal to its mana value rather than pay its mana cost." (rid.stdexile1.top.castThisWay.lifeCost): the
 *                                   top card is cast for life, no mana; a land is played for nothing (CR 305.9); not without enough life (CR 119.4)
 *   CR 406.3, 608.2c, 609.4b, 611.2b "look at the top N cards of target opponent's library, exile two of them face down, then put the rest on the bottom of their library in
 *                                   a random order. You may play the exiled cards for as long as they remain exiled. Mana of any type can be spent to cast spells this
 *                                   way." (rid.stdexile1.castThisWay.anyManaType): the two chosen cards, face down, are castable by the looker with mana of any type;
 *                                   the rest are not, nor are they after they leave exile
 *   CR 108.3, 601.2a, 603.2         "Whenever a player casts a spell they don't own, that player creates a Treasure token." (trg.stdexile1.cast.notOwnedByCaster): the
 *                                   caster of another player's card gets the Treasure; a spell its caster owns triggers nothing
 *   CR 406.3, 608.2c, 611.2b        "..., its controller looks at the top card of that opponent's library and exiles it face down. They may play that card for as long
 *                                   as it remains exiled. Mana of any type can be spent to cast a spell this way." (eff.stdexile1.they.may.play.impulse.dur): the
 *                                   attacker's controller, not the damaged opponent, may play it
 *   CR 608.2c, 609.4b, 611.2a       "... until they exile a nonland card. You may put a +1/+1 counter on ~. If you don't, you may cast the exiled nonland card until end
 *                                   of turn and mana of any type can be spent to cast that spell.": the card the exile stopped at, castable this turn only if the
 *                                   counter was declined; the lands exiled before it are not
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId } from '../../../src/index';
import { act, answer, find, life, pass } from '../../m3/scenario';
import { scenario } from '../../m3/scenario';
import { attackWith, card, full, resolveAll, settle } from '../cmd3/helpers';
import { attackUnblocked, toStep } from '../../m4/helpers';

const REVERIE = card('Test Reverie', 'Sorcery',
  'Until end of turn, you may look at the top card of your library any time and you may play cards from the top of your library. If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost.');
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const SURGE = card('Test Surge', 'Sorcery', 'You gain X life.', undefined, '{X}{R}');
const PROWLER = card('Test Prowler', 'Creature — Cat Rogue',
  "When ~ enters, look at the top four cards of target opponent's library, exile two of them face down, then put the rest on the bottom of their library in a random order. You may play the exiled cards for as long as they remain exiled. Mana of any type can be spent to cast spells this way.",
  ['2', '2']);
const BLUE = card('Test Ponder', 'Instant', 'Draw a card.', undefined, '{U}');
const MINISTER = card('Test Minister', 'Legendary Creature — Aetherborn Rogue',
  "Whenever a player casts a spell they don't own, that player creates a Treasure token.\nWhenever a creature deals combat damage to one of your opponents, its controller looks at the top card of that opponent's library and exiles it face down. They may play that card for as long as it remains exiled. Mana of any type can be spent to cast a spell this way.",
  ['3', '4']);
const AGENT = card('Test Agent', 'Legendary Creature — Human Spy',
  "Whenever Test Agent deals combat damage to a player, that player exiles cards from the top of their library until they exile a nonland card. You may put a +1/+1 counter on Test Agent. If you don't, you may cast the exiled nonland card until end of turn and mana of any type can be spent to cast that spell.",
  ['2', '1']);
const DEFS = [REVERIE, CUB, SURGE, PROWLER, BLUE, MINISTER, AGENT];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const topOf = (s: GameState, player = 'p1'): ObjectId => s.zones.library[player]![0]!;
const castsOf = (s: GameState, id: ObjectId, player = 'p1') => legalActions(s, player).filter((a) => a.kind === 'cast' && a.object === id);

describe('CR 118.9, 202.3, 401.5: cards played from the top of your library this turn, spells cast for life equal to their mana value', () => {
  const reverie = (library: string[], hand: string[] = []): GameState => {
    const s = scenario(['Plains', 'Forest'], { p1: { hand: ['Test Reverie', ...hand], library }, defs: DEFS });
    return resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Reverie', 'hand') }));
  };
  it('the top card is cast for life equal to its mana value, with no mana (CR 118.9: "rather than pay its mana cost")', () => {
    const s0 = reverie(['Test Cub']);
    const cub = topOf(s0);
    expect(s0.objects[cub]!.defId).toBe('Test Cub');
    const casts = castsOf(s0, cub);
    expect(casts.length).toBe(1);
    const before = life(s0, 'p1');
    const s = resolveAll(settle(act(s0, casts[0]!.action)));
    expect(life(s, 'p1')).toBe(before - 2); // CR 202.3: {1}{G} is mana value 2
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Cub' && s.objects[id]!.controller === 'p1')).toBe(true);
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.length).toBe(0);
  });
  it('CR 107.3b, 202.3e (audit-fix-1): a spell with {X} is cast with X = 0, for life equal to its mana value with X = 0 (the alternative cost has no {X})', () => {
    let s = reverie(['Test Surge']);
    const before = life(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: topOf(s) });
    expect(s.pending?.kind).not.toBe('chooseNumber'); // audit-fix-1: no X is announced
    s = resolveAll(settle(s));
    expect(life(s, 'p1')).toBe(before - 1); // paid 1 life ({0}{R} is mana value 1), then gained 0
  });
  it('CR 305.9: a land on top is played with a land play and costs no life', () => {
    const s0 = reverie(['Forest']);
    const forest = topOf(s0);
    const play = legalActions(s0, 'p1').find((a) => a.kind === 'playLand' && a.object === forest);
    expect(play).toBeDefined();
    const before = life(s0, 'p1');
    const s = act(s0, play!.action);
    expect(s.objects[forest]?.zone ?? 'battlefield').toBe('battlefield');
    expect(life(s, 'p1')).toBe(before);
  });
  it('CR 119.4: without enough life the spell is not offered; without the effect the top card is not castable at all', () => {
    const s0 = reverie(['Test Cub']);
    const poor = { ...s0, players: s0.players.map((p) => (p.id === 'p1' ? { ...p, life: 1 } : p)) } as GameState;
    expect(castsOf(poor, topOf(poor)).length).toBe(0);
    const plain = scenario(['Plains', 'Forest'], { p1: { library: ['Test Cub'] }, defs: DEFS });
    expect(castsOf(plain, topOf(plain)).length).toBe(0);
  });
  it('CR 514.2, 611.2a: the permission ends with the turn', () => {
    const s0 = reverie(['Test Cub', 'Test Surge']);
    let s = s0;
    for (let guard = 0; s.turn.number === 1 && guard < 200; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.turn.number).toBe(2);
    expect(s.continuousEffects.some((r) => r.effect.s === 'permit' && r.effect.fromTop === true)).toBe(false);
  });
});

describe('CR 406.3, 608.2c, 609.4b: the exiled cards, face down, played by the player who looked at them with mana of any type', () => {
  const enter = (): { s: GameState; picked: ObjectId[]; rest: ObjectId[] } => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Prowler'], battlefield: ['Plains'] }, p2: { library: ['Test Ponder', 'Test Cub', 'Test Surge', 'Plains'] }, defs: DEFS });
    const top = s.zones.library['p2']!.slice(0, 4);
    const picked = [top[0]!, top[1]!]; // Test Ponder ({U}) and Test Cub ({1}{G})
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Prowler', 'hand') });
    s = resolveAll(settle(s), { targets: [{ kind: 'player', id: 'p2' }], objects: picked });
    // CR 400.7: in exile they are new objects
    const exiled = (name: string): ObjectId => s.zones.exile.find((id) => s.objects[id]!.defId === name && s.objects[id]!.owner === 'p2')!;
    return { s, picked: [exiled('Test Ponder'), exiled('Test Cub')], rest: [top[2]!, top[3]!] };
  };
  it('the chosen cards are exiled face down and the rest go to the bottom of their library (CR 401.4, 406.3)', () => {
    const { s, picked, rest } = enter();
    for (const id of picked) {
      expect(id).toBeDefined();
      expect(s.objects[id]!.zone).toBe('exile');
      expect(s.objects[id]!.faceDown).toBe(true);
    }
    const lib = s.zones.library['p2']!;
    expect(lib.slice(-2).map((id) => s.objects[id]!.defId).sort()).toEqual(rest.map((id) => s.objects[id]?.defId ?? '').sort().length === 2 ? lib.slice(-2).map((id) => s.objects[id]!.defId).sort() : []);
    expect(lib.slice(-2).map((id) => s.objects[id]!.defId).sort()).toEqual(['Plains', 'Test Surge']);
  });
  it('CR 609.4b: the looker casts the exiled blue instant with white mana; the opponent cannot', () => {
    const { s: s0, picked } = enter();
    const ponder = picked[0]!;
    expect(castsOf(s0, ponder, 'p1').length).toBe(1);
    expect(legalActions(s0, 'p2').some((a) => a.kind === 'cast' && a.object === ponder)).toBe(false);
    const hand = s0.zones.hand['p1']!.length;
    const s = resolveAll(settle(act(s0, castsOf(s0, ponder, 'p1')[0]!.action)));
    expect(s.objects[ponder]?.zone ?? 'gone').not.toBe('exile');
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
  });
  it('the cards put on the bottom are not playable (CR 608.2c: only the exiled cards)', () => {
    const { s } = enter();
    const surge = s.zones.library['p2']!.find((id) => s.objects[id]!.defId === 'Test Surge')!;
    expect(castsOf(s, surge, 'p1').length).toBe(0);
  });
});

describe('CR 108.3, 406.3, 611.2b: a card exiled face down by the attacker\'s controller, and a Treasure for casting a spell one does not own', () => {
  const treasures = (s: GameState, player: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player && s.objects[id]!.kind === 'token').length;
  const hit = (): { s: GameState; card: ObjectId } => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Minister', 'Test Cub', 'Plains'] }, p2: { library: ['Test Ponder'] }, defs: DEFS });
    const cub = find(s, 'Test Cub', 'battlefield', 'p1');
    s = attackUnblocked(s, [cub]);
    s = resolveAll(s);
    const card = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Ponder')!;
    return { s, card };
  };
  it('CR 406.3, 510.2: on combat damage to the opponent, the attacker\'s controller exiles the top card of that player\'s library face down', () => {
    const { s, card } = hit();
    expect(card).toBeDefined();
    expect(s.objects[card]!.faceDown).toBe(true);
    expect(s.objects[card]!.owner).toBe('p2');
  });
  it('CR 608.2c, 609.4b: they (the attacker\'s controller) may cast it with mana of any type; the damaged opponent may not', () => {
    let { s, card } = hit();
    s = toStep(s, 'main2');
    expect(legalActions(s, 'p2').some((a) => a.kind === 'cast' && a.object === card)).toBe(false);
    const casts = castsOf(s, card, 'p1');
    expect(casts.length).toBe(1);
    const before = treasures(s, 'p1');
    s = resolveAll(settle(act(s, casts[0]!.action)));
    // CR 108.3, 601.2a: p1 cast a spell p2 owns: the first ability triggers for p1
    expect(treasures(s, 'p1')).toBe(before + 1);
    expect(treasures(s, 'p2')).toBe(0);
  });
  it('CR 108.3: a spell its caster owns makes no Treasure', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Minister', 'Plains'], hand: ['Test Reverie'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Reverie', 'hand') })));
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Reverie')).toBe(true);
    expect(treasures(s, 'p1')).toBe(0);
  });
});

describe('CR 608.2c, 609.4b, 611.2a: the exiled nonland card, castable this turn with mana of any type if you declined the counter', () => {
  const hit = (yes: boolean): { s: GameState; card: ObjectId; agent: ObjectId } => {
    let s = scenario(['Plains', 'Forest'], { p1: { battlefield: ['Test Agent', 'Plains'] }, p2: { library: ['Forest', 'Test Ponder', 'Test Cub'] }, defs: DEFS });
    const agent = find(s, 'Test Agent', 'battlefield', 'p1');
    s = attackWith(s, [agent]);
    // pass through combat damage, answering the optional counter, until the trigger has resolved
    const done = (x: GameState): boolean => x.zones.exile.some((id) => x.objects[id]!.defId === 'Test Ponder') && x.zones.stack.length === 0 && x.pending?.kind === 'priority';
    for (let guard = 0; !done(s) && guard < 60; guard++) {
      s = settle(s, { yes });
      if (!done(s) && s.pending?.kind === 'priority') s = pass(s);
    }
    const card = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Ponder')!;
    return { s, card, agent };
  };
  it('CR 406.1: the lands are exiled too, and the exile stops at the first nonland card', () => {
    const { s, card } = hit(false);
    expect(card).toBeDefined();
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Forest')).toBe(true);
    expect(s.zones.library['p2']!.some((id) => s.objects[id]!.defId === 'Test Cub')).toBe(true);
  });
  it('declined: you may cast it with mana of any type this turn (CR 609.4b); the exiled land is not playable', () => {
    let { s, card } = hit(false);
    s = toStep(s, 'main2');
    expect(castsOf(s, card, 'p1').length).toBe(1);
    const forest = s.zones.exile.find((id) => s.objects[id]!.defId === 'Forest')!;
    expect(legalActions(s, 'p1').some((a) => a.object === forest)).toBe(false);
    const hand = s.zones.hand['p1']!.length;
    s = resolveAll(settle(act(s, castsOf(s, card, 'p1')[0]!.action)));
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
  });
  it('accepted: the counter is put on ~ and the card is not castable (CR 608.2c: "if you don\'t")', () => {
    let { s, card, agent } = hit(true);
    expect(s.objects[agent]!.counters['+1/+1'] ?? 0).toBe(1);
    s = toStep(s, 'main2');
    expect(castsOf(s, card, 'p1').length).toBe(0);
  });
  it('CR 514.2: declined, the permission ends with the turn', () => {
    let { s, card } = hit(false);
    for (let guard = 0; s.turn.number === 1 && guard < 200; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.continuousEffects.some((r) => r.effect.s === 'permit' && JSON.stringify(r.effect).includes(card))).toBe(false);
  });
});
