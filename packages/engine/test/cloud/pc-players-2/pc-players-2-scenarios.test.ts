/**
 * Round pc-players-2 (precon lane pc-players), played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 208.1, 121.1, 608.2c   "Draw two cards if you control the creature with the greatest power or tied for the greatest power": a tie counts, an opponent's bigger creature does not
 *   CR 404.1, 608.2d, 400.3   "Choose an opponent. That player returns a card from their graveyard to their hand.": the opponent chooses from THEIR graveyard
 *   CR 402.1, 608.2h          "If that player has more cards in hand than you, draw cards equal to the difference."
 *   CR 119.1                  "If that player has more life than you"
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { act, answer, find, life, scenario } from '../../m3/scenario';
import { card, full, resolveAll, settle } from '../cmd3/helpers';

const handSize = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;
const cast = (s0: GameState, name: string, p: Parameters<typeof settle>[1] = {}): GameState => resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), p), p);

const SIGHT = card('Test Sight', 'Sorcery', 'Draw two cards if you control the creature with the greatest power or tied for the greatest power.');
const LEAD = card('Test Lead', 'Sorcery', 'Draw a card if you control a creature with the greatest power among creatures on the battlefield.');
const RECALL = card('Test Recall', 'Sorcery', 'Choose an opponent. That player returns a card from their graveyard to their hand.');
const ENVY = card('Test Envy', 'Sorcery', 'Choose an opponent. If that player has more cards in hand than you, draw cards equal to the difference.');
const SPITE = card('Test Spite', 'Sorcery', 'Choose an opponent. If that player has more life than you, draw a card.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
const GIANT = card('Test Giant', 'Creature — Giant', '', ['6', '6']);
const DEFS = [SIGHT, LEAD, RECALL, ENVY, SPITE, BEAR, OGRE, GIANT];

describe('the synthetic cards are automated', () => {
  it('every synthetic spell plays fully', () => {
    for (const d of [SIGHT, LEAD, RECALL, ENVY, SPITE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 208.1, 608.2c: "the creature with the greatest power or tied for the greatest power"', () => {
  const run = (mine: string[], theirs: string[]): GameState => {
    const s = scenario([], { p1: { hand: ['Test Sight'], battlefield: mine }, p2: { battlefield: theirs }, defs: DEFS });
    return cast(s, 'Test Sight');
  };
  const before = (mine: string[], theirs: string[]): number => handSize(scenario([], { p1: { hand: ['Test Sight'], battlefield: mine }, p2: { battlefield: theirs }, defs: DEFS }), 'p1') - 1;
  it('Alice has the biggest creature: she draws two', () => expect(handSize(run(['Test Ogre'], ['Test Bear']), 'p1')).toBe(before(['Test Ogre'], ['Test Bear']) + 2));
  it('a tie counts (both control a 3/3): she draws two', () => expect(handSize(run(['Test Ogre'], ['Test Ogre']), 'p1')).toBe(before(['Test Ogre'], ['Test Ogre']) + 2));
  it('Bob has a bigger creature: she draws nothing', () => expect(handSize(run(['Test Ogre'], ['Test Giant']), 'p1')).toBe(before(['Test Ogre'], ['Test Giant'])));
  it('Alice controls no creature: she draws nothing, even if nobody does', () => expect(handSize(run([], []), 'p1')).toBe(before([], [])));
  it('the one-card wording "a creature with the greatest power among creatures on the battlefield" reads the same way', () => {
    const s = scenario([], { p1: { hand: ['Test Lead'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    expect(handSize(cast(s, 'Test Lead'), 'p1')).toBe(handSize(s, 'p1') - 1);
  });
});

describe('CR 404.1, 608.2d, 400.3: "That player returns a card from their graveyard to their hand."', () => {
  it('Bob (not Alice) chooses, from his own graveyard; Alice\'s graveyard is untouched', () => {
    let s = scenario([], { p1: { hand: ['Test Recall'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Ogre', 'Test Giant'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Recall', 'hand', 'p1') }), {});
    let asked = 0;
    for (let guard = 0; guard < 10 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else if (d.kind === 'chooseObjects') { asked++; expect(d.player).toBe('p2'); s = answer(s, { kind: 'chooseObjects', ids: [d.options[d.options.length - 1]!] }); }
      else s = settle(s, {});
    }
    expect(asked).toBeGreaterThan(0);
    expect((s.zones.hand['p2'] ?? []).length).toBe(1);
    expect((s.zones.graveyard['p2'] ?? []).length).toBe(1);
    expect((s.zones.graveyard['p1'] ?? []).map((id) => s.objects[id]!.defId)).toContain('Test Bear');
  });
  it('an empty graveyard: nothing happens', () => {
    const s = scenario([], { p1: { hand: ['Test Recall'] }, defs: DEFS });
    const t = cast(s, 'Test Recall');
    expect(handSize(t, 'p2')).toBe(handSize(s, 'p2'));
  });
});

describe('CR 402.1, 608.2h: "If that player has more cards in hand than you, draw cards equal to the difference."', () => {
  it('Bob has 5 more cards than Alice\'s remaining hand: she draws the difference', () => {
    const s = scenario([], { p1: { hand: ['Test Envy'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, defs: DEFS });
    const t = cast(s, 'Test Envy');
    expect(handSize(t, 'p1')).toBe(handSize(t, 'p2'));
    expect(handSize(t, 'p1')).toBe(handSize(s, 'p2'));
  });
  it('equal hands (after Alice casts the spell): she draws nothing', () => {
    const s = scenario([], { p1: { hand: ['Test Envy'] }, defs: DEFS });
    expect(handSize(cast(s, 'Test Envy'), 'p1')).toBe(handSize(s, 'p1') - 1);
  });
  it('Bob has fewer cards: she draws nothing', () => {
    const s = scenario([], { p1: { hand: ['Test Envy', 'Test Bear', 'Test Bear'] }, defs: DEFS });
    expect(handSize(cast(s, 'Test Envy'), 'p1')).toBe(handSize(s, 'p1') - 1);
  });
});

describe('CR 119.1: "If that player has more life than you"', () => {
  it('Bob 30 against Alice 20: she draws; Bob 20 (a tie) or less: she does not', () => {
    const s = scenario([], { p1: { hand: ['Test Spite'] }, defs: DEFS });
    s.players.find((p) => p.id === 'p2')!.life = 30;
    expect(handSize(cast(s, 'Test Spite'), 'p1')).toBe(handSize(s, 'p1'));
    const t = scenario([], { p1: { hand: ['Test Spite'] }, defs: DEFS });
    expect(handSize(cast(t, 'Test Spite'), 'p1')).toBe(handSize(t, 'p1') - 1);
    void life;
  });
});
