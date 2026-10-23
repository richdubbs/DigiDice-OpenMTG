/**
 * std-exile-play-1-2 (lane std-exile-play-1: play or cast from exile): the round's readings played through the engine with synthetic cards compiled by the game's
 * default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/
 * is not in the cloud checkout).
 *
 *   CR 603.7, 608.2h, 611.2a  "~ deals 3 damage to target creature. When that creature dies this turn, exile a number of cards from the top of your library equal to
 *                             its power, then choose a card exiled this way. Until the end of your next turn, you may play that card." (eff.stdexile2.choose.oneExiledThisWay):
 *                             when the creature dies, as many cards as its last known power are exiled; only the chosen one is playable, through your next turn;
 *                             nothing happens if the creature survives
 *   CR 406.1, 608.2c, 609.4b  "target opponent reveals X cards from their hand, where X is the number of Goblins you control. You choose one of those cards. That player
 *                             exiles it. If an instant or sorcery card is exiled this way, you may cast it for as long as you control this creature, and mana of any
 *                             type can be spent to cast that spell." (eff.stdexile2.thatPlayer.exiles.obj): the chosen card is exiled; an instant may be cast with
 *                             mana of any type while you control the creature, a creature card may not; the permission ends when the creature leaves
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId } from '../../../src/index';
import { act, find, pass } from '../../m3/scenario';
import { scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const EPIPHANY = card('Test Epiphany', 'Instant',
  'Test Epiphany deals 3 damage to target creature. When that creature dies this turn, exile a number of cards from the top of your library equal to its power, then choose a card exiled this way. Until the end of your next turn, you may play that card.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['2', '3'], '{2}');
const WALL = card('Test Wall', 'Creature — Wall', '', ['2', '5'], '{2}');
const PONDER = card('Test Ponder', 'Instant', 'Draw a card.', undefined, '{0}');
const SURGE = card('Test Surge', 'Sorcery', 'You gain 2 life.', undefined, '{0}');
const TASTER = card('Test Taster', 'Creature — Goblin Warlock',
  "When this creature enters, target opponent reveals X cards from their hand, where X is the number of Goblins you control. You choose one of those cards. That player exiles it. If an instant or sorcery card is exiled this way, you may cast it for as long as you control this creature, and mana of any type can be spent to cast that spell.",
  ['3', '2']);
const BLUE = card('Test Insight', 'Instant', 'Draw a card.', undefined, '{U}');
const DEFS = [EPIPHANY, OGRE, WALL, PONDER, SURGE, TASTER, BLUE];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const exiledOf = (s: GameState, owner = 'p1'): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.owner === owner);
const castsOf = (s: GameState, id: ObjectId, player = 'p1') => legalActions(s, player).filter((a) => a.kind === 'cast' && a.object === id);

describe('CR 603.7, 608.2h: when that creature dies this turn, exile as many cards as its power, then choose one to play until the end of your next turn', () => {
  const burn = (victim: string, pick: string): GameState => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Epiphany'], library: ['Test Ponder', 'Test Surge', 'Plains'] }, p2: { battlefield: [victim] }, defs: DEFS });
    const target = find(s, victim, 'battlefield', 'p2');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Epiphany', 'hand') });
    s = settle(s, { targets: [{ kind: 'object', id: target }] });
    // the choice is among the exiled cards (new objects in exile, CR 400.7): pick by name
    for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      if (s.pending?.kind === 'chooseObjects') {
        const opts = (s.pending as unknown as { options: ObjectId[] }).options;
        s = settle(s, { objects: [opts.find((id) => s.objects[id]!.defId === pick) ?? opts[0]!] });
      } else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    return s;
  };
  it('the creature dies (2 power): the top two cards are exiled, and only the chosen one may be played', () => {
    const s = burn('Test Ogre', 'Test Surge');
    expect(s.zones.graveyard['p2']!.some((id) => s.objects[id]!.defId === 'Test Ogre')).toBe(true);
    const ex = exiledOf(s);
    expect(ex.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Ponder', 'Test Surge']);
    const surge = ex.find((id) => s.objects[id]!.defId === 'Test Surge')!;
    const ponder = ex.find((id) => s.objects[id]!.defId === 'Test Ponder')!;
    expect(castsOf(s, surge).length).toBe(1);
    expect(castsOf(s, ponder).length).toBe(0);
  });
  it('CR 611.2a: the chosen card stays playable during your next turn, and not after it', () => {
    let s = burn('Test Ogre', 'Test Ponder');
    const ponder = exiledOf(s).find((id) => s.objects[id]!.defId === 'Test Ponder')!;
    for (let guard = 0; s.turn.number < 3 && guard < 400; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.turn.number).toBe(3);
    expect(s.turn.activePlayer).toBe('p1');
    expect(castsOf(s, ponder).length).toBe(1);
    for (let guard = 0; s.turn.number < 4 && guard < 400; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(castsOf(s, ponder).length).toBe(0);
  });
  it('the creature survives the damage: nothing is exiled (CR 603.7c: the delayed ability never triggers)', () => {
    const s = burn('Test Wall', 'Test Surge');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Wall')).toBe(true);
    expect(exiledOf(s).length).toBe(0);
  });
});

describe('CR 406.1, 608.2c, 609.4b: you choose one of the revealed cards, that player exiles it, and an instant or sorcery exiled this way is yours to cast', () => {
  const enter = (pick: string): { s: GameState; taster: ObjectId; card: ObjectId | undefined } => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Taster'], battlefield: ['Plains'] }, p2: { hand: ['Test Insight', 'Test Ogre'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Taster', 'hand') });
    for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      if (s.pending?.kind === 'chooseObjects') {
        const opts = (s.pending as unknown as { options: ObjectId[] }).options;
        s = settle(s, { objects: [opts.find((id) => s.objects[id]!.defId === pick) ?? opts[0]!] });
      } else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settle(s, { targets: [{ kind: 'player', id: 'p2' }] });
    }
    const taster = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Taster')!;
    return { s, taster, card: s.zones.exile.find((id) => s.objects[id]!.defId === pick) };
  };
  it('the chosen card leaves the opponent\'s hand for exile (one Goblin: X is 1)', () => {
    const { s, card } = enter('Test Insight');
    expect(card).toBeDefined();
    expect(s.zones.hand['p2']!.some((id) => s.objects[id]!.defId === 'Test Insight')).toBe(false);
    expect(s.zones.hand['p2']!.some((id) => s.objects[id]!.defId === 'Test Ogre')).toBe(true);
  });
  it('CR 609.4b: an instant exiled this way is castable by you with white mana while you control the creature', () => {
    const { s: s0, card } = enter('Test Insight');
    expect(castsOf(s0, card!).length).toBe(1);
    expect(legalActions(s0, 'p2').some((a) => a.kind === 'cast' && a.object === card)).toBe(false);
    const hand = s0.zones.hand['p1']!.length;
    const s = resolveAll(settle(act(s0, castsOf(s0, card!)[0]!.action)));
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
  });
  it('CR 608.2c: a creature card exiled this way is not castable', () => {
    const { s, card } = enter('Test Ogre');
    expect(card).toBeDefined();
    expect(castsOf(s, card!).length).toBe(0);
  });
  it('CR 611.2b: once the creature leaves the battlefield, the exiled instant is no longer castable', () => {
    const { s: s0, card, taster } = enter('Test Insight');
    const s = { ...s0, zones: { ...s0.zones, battlefield: s0.zones.battlefield.filter((id) => id !== taster) }, objects: { ...s0.objects, [taster]: { ...s0.objects[taster]!, zone: 'graveyard' as const } } } as GameState;
    s.zones.graveyard = { ...s.zones.graveyard, p1: [...s.zones.graveyard['p1']!, taster] };
    expect(castsOf(s, card!).length).toBe(0);
  });
});
