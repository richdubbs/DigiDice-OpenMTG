/**
 * CLOUD C2 (hand statics: "your maximum hand size is N", "each opponent's maximum hand size is N", "players have no maximum hand size", "you have no maximum
 * hand size for the rest of the game", "as long as ..., you have no maximum hand size"), played through the engine with synthetic cards compiled by the game's
 * default compiler (wordings are invented, design 6.10).
 *
 *   CR 402.2             each player has a maximum hand size, normally seven; an effect may change it or remove it
 *   CR 514.1             in the cleanup step the active player discards down to their maximum hand size
 *   CR 613.11            rule modifications apply in timestamp order (the latest maximum wins)
 *   CR 611.2a            a resolved effect with no stated duration lasts for the rest of the game
 *   CR 611.3a            a static ability's effect applies only while its "as long as" condition holds
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { maxHandSize } from '../../../src/statics/hooks';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
/** An experimental template (design 6.9: no real-card evidence yet) caps its card at partial; the ability itself is lowered with nothing manual in it. */
const capped = (d: CardDef): boolean => d.automation.level === 'partial' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;

/** Cast the named spell from p1's hand and let it resolve (no targets). */
function cast(s0: GameState, name: string): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let guard = 0; s.pending?.kind === 'payCost' && guard < 5; guard++) s = answer(s, { kind: 'payCost', auto: true });
  return pass(pass(s));
}

/**
 * Pass until the active player's cleanup step asks for a discard to hand size (CR 514.1), answering it with the first cards offered, or until the next turn
 * begins. Returns the state and how many cards the cleanup asked to discard (0 when it asked nothing).
 */
function throughCleanup(s0: GameState): { s: GameState; discarded: number } {
  let s = s0;
  const turn = s.turn.number;
  let discarded = 0;
  for (let guard = 0; s.turn.number === turn && guard < 200; guard++) {
    const d = s.pending;
    if (d?.kind === 'chooseObjects' && d.rules?.includes('CR 514.1') === true) {
      discarded = d.min;
      s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    } else if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else s = pass(s);
  }
  return { s, discarded };
}

const FILLER = Array(6).fill('Plains') as string[];

describe('CR 402.2, 514.1: "Your maximum hand size is three." (a static ability)', () => {
  const VOW = card('Test Narrow Vow', 'Enchantment', 'Your maximum hand size is three.');
  it('is automated', () => expect(full(VOW)).toBe(true));
  it('its controller discards down to three in their cleanup step; the opponent keeps seven', () => {
    const s0 = scenario([], { defs: [VOW], p1: { battlefield: ['Test Narrow Vow'], hand: FILLER }, p2: { hand: FILLER } });
    expect(maxHandSize(s0, 'p1')).toBe(3);
    expect(maxHandSize(s0, 'p2')).toBe(7);
    const { s, discarded } = throughCleanup(s0);
    expect(discarded).toBe(3);
    expect(handSize(s, 'p1')).toBe(3);
  });
  it('without the enchantment the same hand of six is kept (the maximum is seven again)', () => {
    const s0 = scenario([], { p1: { hand: FILLER } });
    expect(maxHandSize(s0, 'p1')).toBe(7);
    expect(throughCleanup(s0).discarded).toBe(0);
  });
});

describe('CR 402.2, 613.11: "Each opponent\'s maximum hand size is two."', () => {
  const GAG = card('Test Gag Order', 'Artifact', "Each opponent's maximum hand size is two.");
  it('is lowered (experimental: capped at partial) and changes only the opponent', () => {
    expect(capped(GAG)).toBe(true);
    const s = scenario([], { defs: [GAG], p1: { battlefield: ['Test Gag Order'] } });
    expect(maxHandSize(s, 'p1')).toBe(7);
    expect(maxHandSize(s, 'p2')).toBe(2);
  });
  it('with the opponent\'s own "Your maximum hand size is three." as well, the later of the two maximums applies (timestamp order)', () => {
    const VOW = card('Test Narrow Vow', 'Enchantment', 'Your maximum hand size is three.');
    // the opponent's own enchantment is put onto the battlefield first, the artifact second: the artifact's maximum is the later one
    const s = scenario([], { defs: [GAG, VOW], p2: { battlefield: ['Test Narrow Vow'] }, p1: { battlefield: ['Test Gag Order'] } });
    const vow = s.objects[find(s, 'Test Narrow Vow', 'battlefield', 'p2')]!;
    const gag = s.objects[find(s, 'Test Gag Order', 'battlefield', 'p1')]!;
    expect(maxHandSize(s, 'p2')).toBe(vow.timestamp > gag.timestamp ? 3 : 2);
  });
});

describe('CR 402.2: "Players have no maximum hand size." and "Each player has no maximum hand size."', () => {
  const OPEN = card('Test Open Library', 'Artifact', 'Players have no maximum hand size.');
  const OPEN2 = card('Test Wide Library', 'Artifact', 'Each player has no maximum hand size.');
  it('both remove the maximum of every player ("Players ..." is automated; "Each player has ..." is experimental: capped at partial)', () => {
    expect(full(OPEN)).toBe(true);
    expect(capped(OPEN2)).toBe(true);
    for (const [d, name] of [[OPEN, 'Test Open Library'], [OPEN2, 'Test Wide Library']] as const) {
      const s = scenario([], { defs: [d], p2: { battlefield: [name] } });
      expect(maxHandSize(s, 'p1')).toBeNull();
      expect(maxHandSize(s, 'p2')).toBeNull();
    }
  });
  it('with ten cards in hand the active player discards nothing', () => {
    const s0 = scenario([], { defs: [OPEN], p2: { battlefield: ['Test Open Library'] }, p1: { hand: Array(10).fill('Plains') as string[] } });
    const { s, discarded } = throughCleanup(s0);
    expect(discarded).toBe(0);
    expect(handSize(s, 'p1')).toBe(10);
  });
});

describe('CR 611.2a, 402.2: "Draw two cards. You have no maximum hand size for the rest of the game." (a resolved effect)', () => {
  const TOME = card('Test Endless Tome', 'Sorcery', 'Draw two cards. You have no maximum hand size for the rest of the game.');
  it('is automated', () => expect(full(TOME)).toBe(true));
  it('after it resolves its caster has no maximum hand size, also on later turns; the opponent keeps seven', () => {
    const s0 = scenario([], { defs: [TOME], p1: { hand: ['Test Endless Tome', ...FILLER, ...FILLER] } });
    expect(maxHandSize(s0, 'p1')).toBe(7);
    const s1 = cast(s0, 'Test Endless Tome');
    expect(handSize(s1, 'p1')).toBe(14);
    expect(maxHandSize(s1, 'p1')).toBeNull();
    expect(maxHandSize(s1, 'p2')).toBe(7);
    const { s, discarded } = throughCleanup(s1);
    expect(discarded).toBe(0);
    expect(maxHandSize(s, 'p1')).toBeNull();
    // the spell is in the graveyard: the effect does not depend on its source (CR 611.2a)
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Endless Tome')).toBe(true);
  });
});

describe('CR 611.3a, 402.2: "As long as you control an artifact, you have no maximum hand size."', () => {
  const VAULT = card('Test Vault Keeper', 'Creature — Human Wizard', 'As long as you control an artifact, you have no maximum hand size.', ['1', '1']);
  const COG = card('Test Cog', 'Artifact', '');
  it('is lowered (experimental: capped at partial)', () => expect(capped(VAULT)).toBe(true));
  it('the maximum is gone only while the condition holds', () => {
    const without = scenario([], { defs: [VAULT, COG], p1: { battlefield: ['Test Vault Keeper'] } });
    expect(maxHandSize(without, 'p1')).toBe(7);
    const withCog = scenario([], { defs: [VAULT, COG], p1: { battlefield: ['Test Vault Keeper', 'Test Cog'] } });
    expect(maxHandSize(withCog, 'p1')).toBeNull();
    expect(maxHandSize(withCog, 'p2')).toBe(7);
  });
});
