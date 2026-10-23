/**
 * Commander precon lane M (std-rm): the new readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks, with its negative case (CR cites from memory, unverified: rules/cr/ is not in the
 * cloud checkout).
 *
 *   CR 122.1, 613.4c   "~ gets +1/+1 for each experience counter you have": the player's own counters, not an opponent's
 *   CR 122.1f          "for each poison counter you have" in a static ability reads the player's poison total (statics/match.ts)
 *   CR 702.26b, 502.1  "Target creature phases out", "Each creature target player controls phases out": only those, back in their controller's untap step
 *   CR 601.2a          "Whenever an opponent casts a spell from anywhere other than their hand": a flashback cast triggers it, a cast from hand does not
 *   CR 111.1, 603.4    "if you created a token this turn": your token counts, an opponent's does not
 *   CR 119.3, 603.4    "if a player lost 4 or more life this turn": one player's losses add up; two players' do not (Standard round P's reading, on main)
 *   CR 121.1, 601.2f   "costs {1} less to cast for each card you've drawn this turn"; CR 601.2a "for each spell you've cast this turn from anywhere other than your hand"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { advanceTo, castAuto, find, findAll, life, scenario } from '../../m5/helpers';
import { activate, cast, handSize, pt, resolveAll, target } from '../../m5/cr-examples/helpers';
import { pass } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const tweak = (s: GameState, f: (t: GameState) => void): GameState => { const t = structuredClone(s); f(t); return t; };

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

// ---- CR 122.1: a player's counters as a quantity ------------------------------------------------------------------------------------------------------------

describe('CR 122.1, 613.4c: "~ gets +1/+1 for each experience counter you have."', () => {
  const VETERAN = card('Test Veteran Captain', 'Creature — Human Soldier', 'Whenever you cast a creature spell, you get an experience counter.\nThis creature gets +1/+1 for each experience counter you have.', { pt: ['1', '1'] });
  it('is automated', () => expect(full(VETERAN)).toBe(true));
  it('counts the experience counters its controller has, gained as creature spells are cast; an opponent\'s do not count', () => {
    let s = scenario([], { defs: [VETERAN, BEAR], p1: { battlefield: ['Test Veteran Captain'], hand: ['Test Bear'] } });
    const v = find(s, 'Test Veteran Captain', 'battlefield', 'p1');
    expect(pt(s, v)).toEqual([1, 1]);
    s = tweak(s, (t) => { t.players[1]!.counters = { experience: 5 }; });
    expect(pt(s, v)).toEqual([1, 1]);
    s = resolveAll(cast(s, 'Test Bear'));
    expect(s.players[0]!.counters['experience']).toBe(1);
    expect(pt(s, v)).toEqual([2, 2]);
    s = tweak(s, (t) => { t.players[0]!.counters = { experience: 3 }; });
    expect(pt(s, v)).toEqual([4, 4]);
  });
});

describe('CR 122.1f: "for each poison counter you have" in a static ability is the player\'s poison total', () => {
  const MARTYR = card('Test Plague Martyr', 'Creature — Phyrexian', 'This creature gets +2/+0 for each poison counter you have.', { pt: ['1', '3'] });
  it('is automated and reads poison, not another kind', () => {
    expect(full(MARTYR)).toBe(true);
    let s = scenario([], { defs: [MARTYR], p1: { battlefield: ['Test Plague Martyr'] } });
    const m = find(s, 'Test Plague Martyr', 'battlefield', 'p1');
    expect(pt(s, m)).toEqual([1, 3]);
    s = tweak(s, (t) => { t.players[0]!.poison = 2; t.players[1]!.poison = 7; t.players[0]!.counters = { experience: 4 }; });
    expect(pt(s, m)).toEqual([5, 3]);
  });
});

describe('CR 122.1, 608.2h: "where X is the number of experience counters you have", "for each experience counter you have"', () => {
  const RALLY = card('Test Veteran Rally', 'Sorcery', 'Put X +1/+1 counters on target creature, where X is the number of experience counters you have.');
  const STUDY = card('Test Veteran Study', 'Sorcery', 'Draw a card for each experience counter you have.');
  it('both are automated and count the caster\'s counters', () => {
    expect(full(RALLY)).toBe(true);
    expect(full(STUDY)).toBe(true);
    let s = scenario([], { defs: [RALLY, STUDY, BEAR], p1: { hand: ['Test Veteran Rally', 'Test Veteran Study'], battlefield: ['Test Bear'] } });
    s = tweak(s, (t) => { t.players[0]!.counters = { experience: 2 }; t.players[1]!.counters = { experience: 6 }; });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Veteran Rally', [target(bear)]));
    expect(s.objects[bear]!.counters['+1/+1']).toBe(2);
    const hand = handSize(s, 'p1');
    s = resolveAll(cast(s, 'Test Veteran Study'));
    expect(handSize(s, 'p1')).toBe(hand - 1 + 2);
  });
});

describe('CR 604.3, 109.5, 122.1: a token\'s "This creature\'s power and toughness are each equal to the number of experience counters you have." (the G10 change of the round)', () => {
  const SHRINE = card('Test Spirit Shrine', 'Artifact', '{0}: Create a white Spirit enchantment creature token. It has "This creature\'s power and toughness are each equal to the number of experience counters you have."');
  it('is automated; the token counts its controller\'s experience counters, not an opponent\'s', () => {
    expect(full(SHRINE)).toBe(true);
    let s = scenario([], { defs: [SHRINE], p1: { battlefield: ['Test Spirit Shrine'] } });
    s = tweak(s, (t) => { t.players[0]!.counters = { experience: 3 }; t.players[1]!.counters = { experience: 5 }; });
    s = resolveAll(activate(s, find(s, 'Test Spirit Shrine', 'battlefield', 'p1')));
    const tok = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(pt(s, tok)).toEqual([3, 3]);
  });
});

// ---- CR 702.26: phasing -------------------------------------------------------------------------------------------------------------------------------------

describe('CR 702.26b, 502.1: "Target creature phases out."', () => {
  const VEIL = card('Test Fold Veil', 'Instant', 'Target creature phases out.');
  it('only the target phases out; it phases in during its controller\'s next untap step', () => {
    expect(full(VEIL)).toBe(true);
    let s = scenario([], { defs: [VEIL, BEAR], p1: { hand: ['Test Fold Veil'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
    const [a, b] = findAll(s, 'Test Bear', 'battlefield', 'p2') as [string, string];
    s = resolveAll(cast(s, 'Test Fold Veil', [target(a)]));
    expect(s.objects[a]!.phasedOut).toBe(true);
    expect(s.objects[b]!.phasedOut).toBe(false);
    s = advanceTo(s, 2, 'upkeep'); // p2's untap step
    expect(s.objects[a]!.phasedOut).toBe(false);
  });
});

describe('CR 702.26b: "Each creature target player controls phases out." (and the kicked "instead" of a spell)', () => {
  const SWEEP = card('Test Fold Sweep', 'Sorcery', 'Each creature target player controls phases out.');
  const DISMISS = card('Test Fold Dismissal', 'Instant', 'Kicker {0}\nTarget creature phases out. If this spell was kicked, each creature target player controls phases out instead.');
  it('the target player\'s creatures phase out, the other player\'s stay', () => {
    expect(full(SWEEP)).toBe(true);
    let s = scenario([], { defs: [SWEEP, BEAR], p1: { hand: ['Test Fold Sweep'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
    s = resolveAll(cast(s, 'Test Fold Sweep', [target('p2')]));
    expect(findAll(s, 'Test Bear', 'battlefield', 'p2').every((id) => s.objects[id]!.phasedOut)).toBe(true);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.phasedOut).toBe(false);
  });
  it('the kicked spell is automated (CR 614.15, 702.33d: the choice made as it is cast decides which instruction it has)', () => {
    expect(full(DISMISS)).toBe(true);
  });
});

// ---- CR 601.2a: cast from anywhere other than the caster's hand ---------------------------------------------------------------------------------------------

describe('CR 601.2a: "Whenever an opponent casts a spell from anywhere other than their hand, draw a card."', () => {
  const WATCHER = card('Test Grave Watcher', 'Creature — Spirit', 'Whenever an opponent casts a spell from anywhere other than their hand, draw a card.', { pt: ['1', '1'] });
  const ECHO = card('Test Echo Charm', 'Instant', 'You gain 1 life.\nFlashback {0}');
  it('is automated', () => expect(full(WATCHER)).toBe(true));
  it('an opponent\'s flashback cast triggers it; the same spell cast from that opponent\'s hand does not', () => {
    let s = scenario([], { defs: [WATCHER, ECHO], p1: { battlefield: ['Test Grave Watcher'] }, p2: { hand: ['Test Echo Charm'], graveyard: ['Test Echo Charm'] } });
    s = advanceTo(s, 2, 'main1');
    const hand = handSize(s, 'p1');
    s = resolveAll(castAuto(s, 'Test Echo Charm', { player: 'p2' }));
    expect(handSize(s, 'p1')).toBe(hand);
    s = resolveAll(castAuto(s, 'Test Echo Charm', { player: 'p2', method: 'flashback' }));
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });
  it('its controller\'s own flashback cast does not trigger it (an opponent casts)', () => {
    let s = scenario([], { defs: [WATCHER, ECHO], p1: { battlefield: ['Test Grave Watcher'], graveyard: ['Test Echo Charm'] } });
    const hand = handSize(s, 'p1');
    s = resolveAll(castAuto(s, 'Test Echo Charm', { method: 'flashback' }));
    expect(handSize(s, 'p1')).toBe(hand);
  });
});

// ---- CR 603.4: history conditions ---------------------------------------------------------------------------------------------------------------------------

describe('CR 111.1, 603.4: "At the beginning of each end step, if you created a token this turn, draw a card."', () => {
  const KEEPER = card('Test Token Keeper', 'Creature — Human', 'At the beginning of each end step, if you created a token this turn, draw a card.', { pt: ['1', '1'] });
  const SQUIRE = card('Test Squire Call', 'Instant', 'Create a 1/1 white Soldier creature token.');
  const endStep = (s: GameState): GameState => resolveAll(advanceTo(s, 1, 'end'));
  it('is automated', () => expect(full(KEEPER)).toBe(true));
  it('draws after you created a token this turn', () => {
    let s = scenario([], { defs: [KEEPER, SQUIRE], p1: { battlefield: ['Test Token Keeper'], hand: ['Test Squire Call'] } });
    s = resolveAll(cast(s, 'Test Squire Call'));
    const hand = handSize(s, 'p1');
    s = endStep(s);
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });
  it('does not draw when only an opponent created a token this turn', () => {
    let s = scenario([], { defs: [KEEPER, SQUIRE], p1: { battlefield: ['Test Token Keeper'] }, p2: { hand: ['Test Squire Call'] } });
    s = pass(s); // p2 gets priority in p1's main phase
    s = resolveAll(cast(s, 'Test Squire Call', [], 'p2'));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').length).toBe(1); // the opponent's Soldier token
    const hand = handSize(s, 'p1');
    s = endStep(s);
    expect(handSize(s, 'p1')).toBe(hand);
  });
});

describe('CR 119.3, 603.4: "At the beginning of each end step, if a player lost 4 or more life this turn, you draw a card."', () => {
  const OMEN = card('Test Blood Omen', 'Creature — Vampire', 'At the beginning of each end step, if a player lost 4 or more life this turn, you draw a card.', { pt: ['1', '1'] });
  const DRAIN = card('Test Sip', 'Instant', 'Target player loses 2 life.');
  const board = (): GameState => scenario([], { defs: [OMEN, DRAIN], p1: { battlefield: ['Test Blood Omen'], hand: ['Test Sip', 'Test Sip'] } });
  const endStep = (s: GameState): GameState => resolveAll(advanceTo(s, 1, 'end'));
  it('is automated', () => expect(full(OMEN)).toBe(true));
  it('two losses of 2 by one player add up to 4: it draws', () => {
    let s = resolveAll(cast(board(), 'Test Sip', [target('p2')]));
    s = resolveAll(cast(s, 'Test Sip', [target('p2')]));
    expect(life(s, 'p2')).toBe(16);
    const hand = handSize(s, 'p1');
    expect(handSize(endStep(s), 'p1')).toBe(hand + 1);
  });
  it('2 life lost by each of two players is not 4 by one player: it does not draw', () => {
    let s = resolveAll(cast(board(), 'Test Sip', [target('p2')]));
    s = resolveAll(cast(s, 'Test Sip', [target('p1')]));
    const hand = handSize(s, 'p1');
    expect(handSize(endStep(s), 'p1')).toBe(hand);
  });
});

describe('CR 119.3, 603.4: "if an opponent lost 3 or more life this turn" counts opponents only', () => {
  const SPY = card('Test Cutthroat Spy', 'Creature — Merfolk', 'At the beginning of each end step, if an opponent lost 3 or more life this turn, you may draw a card.', { pt: ['1', '1'] });
  const DRAIN = card('Test Deep Sip', 'Instant', 'Target player loses 3 life.');
  it('is automated; its controller losing 3 life does not satisfy it, an opponent losing 3 does', () => {
    expect(full(SPY)).toBe(true);
    const run = (who: 'p1' | 'p2'): number => {
      let s = scenario([], { defs: [SPY, DRAIN], p1: { battlefield: ['Test Cutthroat Spy'], hand: ['Test Deep Sip'] } });
      s = resolveAll(cast(s, 'Test Deep Sip', [target(who)]));
      const hand = handSize(s, 'p1');
      s = resolveAll(advanceTo(s, 1, 'end'), [{ kind: 'yesNo', yes: true } as DecisionAnswer]);
      return handSize(s, 'p1') - hand;
    };
    expect(run('p2')).toBe(1);
    expect(run('p1')).toBe(0);
  });
});

// ---- CR 121.1, 601.2a, 601.2f: counts of the turn after "for each" ------------------------------------------------------------------------------------------

describe('CR 121.1, 601.2f: "This spell costs {1} less to cast for each card you\'ve drawn this turn."', () => {
  const FLARE = card('Test Studied Flare', 'Instant', "This spell costs {1} less to cast for each card you've drawn this turn.\nTest Studied Flare deals 3 damage to any target.", { cost: '{2}{R}' });
  const BOOKS = card('Test Two Books', 'Sorcery', 'Draw two cards.');
  it('is automated; after two cards drawn this turn {2}{R} costs {R}', () => {
    expect(full(FLARE)).toBe(true);
    let s = scenario(['Mountain'], { defs: [FLARE, BOOKS], p1: { hand: ['Test Studied Flare', 'Test Two Books'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } });
    s = resolveAll(cast(s, 'Test Two Books'));
    s = cast(s, 'Test Studied Flare', [target('p2')]);
    expect(s.zones.stack.length).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length).toBe(1);
  });
  it('with no card drawn this turn the full cost is paid', () => {
    let s = scenario(['Mountain'], { defs: [FLARE], p1: { hand: ['Test Studied Flare'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } });
    s = cast(s, 'Test Studied Flare', [target('p2')]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length).toBe(3);
  });
});

describe('CR 601.2a, 601.2i: "Draw a card for each spell you\'ve cast this turn from anywhere other than your hand."', () => {
  const SURGE = card('Test Paradox Wave', 'Instant', "Draw a card for each spell you've cast this turn from anywhere other than your hand.");
  const ECHO = card('Test Echo Charm', 'Instant', 'You gain 1 life.\nFlashback {0}');
  it('is automated; counts the flashback cast, not the casts from hand (itself included)', () => {
    expect(full(SURGE)).toBe(true);
    let s = scenario([], { defs: [SURGE, ECHO], p1: { hand: ['Test Paradox Wave', 'Test Echo Charm'], graveyard: ['Test Echo Charm'] } });
    s = resolveAll(castAuto(s, 'Test Echo Charm'));
    s = resolveAll(castAuto(s, 'Test Echo Charm', { method: 'flashback' }));
    const hand = handSize(s, 'p1');
    s = resolveAll(cast(s, 'Test Paradox Wave'));
    expect(handSize(s, 'p1')).toBe(hand - 1 + 1);
  });
});
