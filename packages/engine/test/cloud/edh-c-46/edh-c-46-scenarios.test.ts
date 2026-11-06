/**
 * Commander lane edh-c, round edh-c-46: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) casts or controls the card under test. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 506.2, 119.3      "Whenever this creature is dealt combat damage, you gain that much life and attacking player loses that much life." (Souls of the Faultless)
 *   CR 115.1, 608.2c     "Choose any target. Draw three cards, then discard a card. ~ deals damage equal to the discarded card's mana value to that permanent or player." (Blast of Genius)
 *   CR 115.1, 202.3      "Return target spell or permanent with mana value 1 or greater to its owner's hand." (Divide by Zero)
 *   CR 118.9, 611.2a     "You may play it without paying its mana cost for as long as it remains exiled." (Spelljack)
 *   CR 614.10, 121.3     "If a player would draw a card, that player skips that draw instead." and "each player sacrifices a permanent of their choice unless they discard a card." (Possessed Portal)
 *   CR 121.1, 608.2h     "enters with a number of +1/+1 counters equal to the greatest number of cards an opponent has drawn this turn." (Thought Sponge)
 *   CR 615.5, 119.3      "Prevent all damage target spell would deal this turn. You gain life equal to the damage prevented this way." (Hallow)
 *   CR 502.3, 611.2c     "Each attacking creature and each blocking creature doesn't untap during its controller's next untap step." (Spore Cloud)
 *   CR 120.3, 701.9a     "~ deals 2 damage to each opponent. Those players each discard two cards at random." (Skull Rend)
 *   CR 701.13a, 608.2d   "Target opponent may exile a card from their graveyard. If that player doesn't, you may draw a card." (Gravestorm)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, resolveStack, lifeOf } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, cost = '{0}', extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...extra } as OracleCard);
}
const zoneOf = (s: GameState, p: string, zone: 'hand' | 'graveyard' | 'battlefield' | 'exile' | 'library'): string[] =>
  Object.values(s.objects).filter((o) => o.zone === zone && o.owner === p).map((o) => s.defs[o.defId]!.name);
const count = (s: GameState, p: string, zone: 'hand' | 'graveyard' | 'battlefield' | 'exile' | 'library', name: string): number => zoneOf(s, p, zone).filter((n) => n === name).length;

/** p1 casts the named spell from hand (free); `targets` answer a target choice; then everything resolves, `answers` answer the decisions in order. */
function cast(s: GameState, name: string, targets: { kind: 'player' | 'object'; id: string }[] = [], answers: Parameters<typeof resolveStack>[1] = [], player = 'p1'): GameState {
  let t = act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never);
  for (let i = 0; i < 4 && t.pending && t.pending.kind !== 'priority'; i++) {
    if (t.pending.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets } as never);
    else if (t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    else break;
  }
  return resolveStack(t, answers);
}
const idOf = (s: GameState, name: string, zone: string, owner?: string): ObjectId => Object.values(s.objects).find((o) => o.zone === zone && s.defs[o.defId]!.name === name && (owner === undefined || o.owner === owner))!.id;

describe('CR 115.1, 608.2c: "Choose any target. Draw three cards, then discard a card. ~ deals damage equal to the discarded card\'s mana value to that permanent or player."', () => {
  const BLAST = card('Test Genius Blast', 'Sorcery', 'Choose any target. Draw three cards, then discard a card. ~ deals damage equal to the discarded card\'s mana value to that permanent or player.');
  const ONE = card('Test One Drop', 'Artifact', '', '{1}');
  const FIVE = card('Test Five Drop', 'Artifact', '', '{5}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', { power: '2', toughness: '2' });
  it('is automated', () => expect(BLAST.automation.level).toBe('full'));
  const start = (): GameState => mpScenario({ players: 3, defs: [BLAST, ONE, FIVE, BEAR], zones: { p1: { hand: ['Test Genius Blast'], library: ['Test One Drop', 'Test Five Drop', 'Test One Drop'] }, p2: { battlefield: ['Test Bear'] } } });
  it('the announced player takes damage equal to the mana value of the card discarded after the draw', () => {
    const s0 = start();
    let s = cast(s0, 'Test Genius Blast', [{ kind: 'player', id: 'p3' }]);
    expect(s.pending?.kind).toBe('chooseObjects'); // the discard
    const five = Object.values(s.objects).find((o) => o.zone === 'hand' && o.owner === 'p1' && s.defs[o.defId]!.name === 'Test Five Drop')!.id;
    s = answer(s, { kind: 'chooseObjects', ids: [five] });
    s = resolveStack(s, []);
    expect(lifeOf(s, 'p3')).toBe(lifeOf(s0, 'p3') - 5);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2'));
    expect(count(s, 'p1', 'graveyard', 'Test Five Drop')).toBe(1); // discarded
    expect(count(s, 'p1', 'hand', 'Test One Drop')).toBe(2); // the other two cards drawn stay
  });
  it('a permanent can be the target (damage to that permanent)', () => {
    const s0 = start();
    const bear = idOf(s0, 'Test Bear', 'battlefield', 'p2');
    let s = cast(s0, 'Test Genius Blast', [{ kind: 'object', id: bear }]);
    const five = Object.values(s.objects).find((o) => o.zone === 'hand' && o.owner === 'p1' && s.defs[o.defId]!.name === 'Test Five Drop')!.id;
    s = answer(s, { kind: 'chooseObjects', ids: [five] });
    s = resolveStack(s, []);
    expect(s.objects[bear]?.zone).not.toBe('battlefield'); // 5 damage kills the 2/2
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2'));
  });
  it('negative: discarding the one-drop deals only 1 damage', () => {
    const s0 = start();
    let s = cast(s0, 'Test Genius Blast', [{ kind: 'player', id: 'p3' }]);
    const one = Object.values(s.objects).find((o) => o.zone === 'hand' && o.owner === 'p1' && s.defs[o.defId]!.name === 'Test One Drop')!.id;
    s = answer(s, { kind: 'chooseObjects', ids: [one] });
    s = resolveStack(s, []);
    expect(lifeOf(s, 'p3')).toBe(lifeOf(s0, 'p3') - 1);
  });
});

/** p1 casts the named card (free, no target); p1 passes so that p2 has priority with it on the stack. Returns that state and the spell's id. */
function p1CastsThenPasses(s: GameState, name: string): { s: GameState; spell: ObjectId } {
  let t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never);
  if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
  const spell = t.zones.stack.map((x) => (typeof x === 'string' ? x : (x as { id: string }).id)).find((id) => s.defs[t.objects[id]?.defId ?? '']?.name === name) ?? '';
  t = act(t, { type: 'pass', player: 'p1' });
  return { s: t, spell };
}

describe('CR 115.1, 202.3: "Return target spell or permanent with mana value 1 or greater to its owner\'s hand."', () => {
  const ZERO = card('Test Zero Bounce', 'Instant', 'Return target spell or permanent with mana value 1 or greater to its owner\'s hand.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}', { power: '2', toughness: '2' });
  const TOKENISH = card('Test Zero Drop', 'Artifact', '', '{0}');
  const SOMEFEW = card('Test Gain', 'Instant', 'You gain 1 life.', '{1}');
  it('is automated', () => expect(ZERO.automation.level).toBe('full'));
  it('returns a permanent with mana value 1 or greater to its owner\'s hand', () => {
    const s0 = mpScenario({ players: 3, defs: [ZERO, BEAR, TOKENISH], zones: { p1: { hand: ['Test Zero Bounce'] }, p2: { battlefield: ['Test Bear', 'Test Zero Drop'] } } });
    const bear = idOf(s0, 'Test Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Zero Bounce', [{ kind: 'object', id: bear }]);
    expect(count(s, 'p2', 'hand', 'Test Bear')).toBe(1);
    expect(count(s, 'p2', 'battlefield', 'Test Bear')).toBe(0);
  });
  it('a permanent with mana value 0 is not a legal target (negative: the spell cannot be cast with it as the only permanent)', () => {
    const s0 = mpScenario({ players: 3, defs: [ZERO, BEAR, TOKENISH], zones: { p1: { hand: ['Test Zero Bounce'] }, p2: { battlefield: ['Test Zero Drop'] } } });
    expect(() => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zero Bounce', 'hand', 'p1') } as never)).toThrow(/no legal one/);
  });
  it('returns a spell on the stack to its owner\'s hand (the spell does not resolve)', () => {
    const s0 = mpScenario({ players: 3, defs: [ZERO, SOMEFEW], zones: { p1: { hand: ['Test Gain'], battlefield: ['Plains'] }, p2: { hand: ['Test Zero Bounce'] } } });
    const { s: t, spell } = p1CastsThenPasses(s0, 'Test Gain');
    expect(spell).not.toBe('');
    const lifeBefore = lifeOf(t, 'p1');
    const s = cast(t, 'Test Zero Bounce', [{ kind: 'object', id: spell }], [], 'p2');
    expect(lifeOf(s, 'p1')).toBe(lifeBefore); // the sorcery never resolved
    expect(count(s, 'p1', 'hand', 'Test Gain')).toBe(1);
  });
});

describe('CR 118.9, 611.2a: "Counter target spell. If that spell is countered this way, exile it instead ... You may play it without paying its mana cost for as long as it remains exiled."', () => {
  const JACK = card('Test Spell Jack', 'Instant', 'Counter target spell. If that spell is countered this way, exile it instead of putting it into its owner\'s graveyard. You may play it without paying its mana cost for as long as it remains exiled.');
  const GAIN = card('Test Gain Five', 'Instant', 'You gain 5 life.', '{3}{W}');
  it('is automated', () => expect(JACK.automation.level).toBe('full'));
  it('the countered spell is exiled and its counterspell\'s controller may cast it for free; its owner may not', () => {
    const s0 = mpScenario({ players: 3, defs: [JACK, GAIN], zones: { p1: { hand: ['Test Gain Five'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Spell Jack'] } } });
    const { s: t, spell } = p1CastsThenPasses(s0, 'Test Gain Five');
    let s = cast(t, 'Test Spell Jack', [{ kind: 'object', id: spell }], [], 'p2');
    expect(count(s, 'p1', 'exile', 'Test Gain Five')).toBe(1);
    expect(count(s, 'p1', 'graveyard', 'Test Gain Five')).toBe(0);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1')); // countered
    const exiled = idOf(s, 'Test Gain Five', 'exile', 'p1');
    // the owner may not cast it (the permission is the counterspell's controller's)
    expect(() => act(s, { type: 'cast', player: 'p1', card: exiled } as never)).toThrow();
    // p2 (no mana at all) casts it without paying its mana cost when they next have priority
    for (let i = 0; i < 30 && !(s.pending?.kind === 'priority' && s.pending.player === 'p2'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    const opts = legalActions(s, 'p2').filter((a) => a.kind === 'cast' && (a.action as { card?: string }).card === exiled);
    expect(opts.length).toBe(1);
    expect(legalActions(s, 'p1').filter((a) => a.kind === 'cast' && (a.action as { card?: string }).card === exiled)).toHaveLength(0);
    s = act(s, opts[0]!.action);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = resolveStack(s, []);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(t, 'p2') + 5);
    expect(count(s, 'p1', 'exile', 'Test Gain Five')).toBe(0);
  });
});

describe('CR 614.10, 121.3, 118.12a: "If a player would draw a card, that player skips that draw instead." / "each player sacrifices a permanent of their choice unless they discard a card."', () => {
  const PORTAL = card('Test Hollow Gate', 'Artifact', 'If a player would draw a card, that player skips that draw instead.\nAt the beginning of each end step, each player sacrifices a permanent of their choice unless they discard a card.');
  const DRAW = card('Test Draw Two', 'Instant', 'Target player draws two cards.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', { power: '2', toughness: '2' });
  const SPARE = card('Test Spare', 'Artifact', '', '{4}');
  it('is automated', () => expect(PORTAL.automation.level).toBe('full'));
  it('every player\'s draws are skipped (negative: the draw happens without the permanent)', () => {
    const base = { defs: [PORTAL, DRAW], players: 3, zones: { p1: { hand: ['Test Draw Two'] }, p2: {} } as never };
    const without = cast(mpScenario({ ...base }), 'Test Draw Two', [{ kind: 'player', id: 'p2' }]);
    expect(zoneOf(without, 'p2', 'hand').length).toBe(2);
    const withGate = cast(mpScenario({ ...base, zones: { p1: { hand: ['Test Draw Two'] }, p2: { battlefield: ['Test Hollow Gate'] } } }), 'Test Draw Two', [{ kind: 'player', id: 'p2' }]);
    expect(zoneOf(withGate, 'p2', 'hand').length).toBe(0);
    // the Gate's controller is not special: a Gate under p1 skips the draws of the other players too
    const gateUnderP1 = cast(mpScenario({ ...base, zones: { p1: { hand: ['Test Draw Two'], battlefield: ['Test Hollow Gate'] }, p2: {} } as never }), 'Test Draw Two', [{ kind: 'player', id: 'p3' }]);
    expect(zoneOf(gateUnderP1, 'p3', 'hand').length).toBe(0);
  });
  it('at the end step each player sacrifices a permanent unless they discard a card (a player with no card in hand must sacrifice)', () => {
    let s = mpScenario({ players: 3, defs: [PORTAL, BEAR, SPARE], zones: { p1: { battlefield: ['Test Hollow Gate'], hand: ['Test Spare'] }, p2: { battlefield: ['Test Bear'] }, p3: { battlefield: ['Test Bear', 'Test Spare'], hand: ['Test Spare'] } } });
    const seen: string[] = [];
    for (let i = 0; i < 80 && s.turn.step !== 'cleanup'; i++) {
      const p = s.pending;
      if (p === undefined || p === null) break;
      seen.push(`${p.kind}:${p.player}`);
      if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseObjects') {
        const opts = (p as unknown as { options: ObjectId[] }).options;
        // p1 and p3 keep their hand card where they can: pay the discard; p2 has none and sacrifices the Bear
        s = answer(s, { kind: 'chooseObjects', ids: [opts[0]!] });
      } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true }); // pay the cost (discard) when asked
      else break;
    }
    expect(seen.filter((x) => x.startsWith('yesNo')).length).toBeGreaterThan(0);
    // p2 had no card to discard: its only permanent is sacrificed
    expect(count(s, 'p2', 'battlefield', 'Test Bear')).toBe(0);
    expect(count(s, 'p2', 'graveyard', 'Test Bear')).toBe(1);
  });
});

describe('CR 121.1, 608.2h, 614.1c: "~ enters with a number of +1/+1 counters on it equal to the greatest number of cards an opponent has drawn this turn."', () => {
  const SPONGE = card('Test Draw Sponge', 'Creature — Sponge', 'Flash\nThis creature enters with a number of +1/+1 counters on it equal to the greatest number of cards an opponent has drawn this turn.', '{0}', { power: '0', toughness: '0' });
  const DRAW3 = card('Test Draw Three', 'Instant', 'Target player draws three cards.');
  const DRAW1 = card('Test Draw One', 'Instant', 'Target player draws a card.');
  const counters = (s: GameState): number => s.objects[idOf(s, 'Test Draw Sponge', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;
  it('is automated', () => expect(SPONGE.automation.level).toBe('full'));
  it('counts the most cards ONE opponent drew this turn (not the total of all opponents)', () => {
    const base = mpScenario({ players: 3, defs: [SPONGE, DRAW3, DRAW1], zones: { p1: { hand: ['Test Draw Three', 'Test Draw One', 'Test Draw One', 'Test Draw Sponge'] } } });
    let s = cast(base, 'Test Draw Three', [{ kind: 'player', id: 'p2' }]);
    s = cast(s, 'Test Draw One', [{ kind: 'player', id: 'p3' }]);
    s = cast(s, 'Test Draw One', [{ kind: 'player', id: 'p3' }]);
    s = cast(s, 'Test Draw Sponge');
    expect(counters(s)).toBe(3); // p2 drew 3, p3 drew 2: the greatest, not 5
  });
  it('negative: the controller\'s own draws are not an opponent\'s', () => {
    const base = mpScenario({ players: 3, defs: [SPONGE, DRAW3], zones: { p1: { hand: ['Test Draw Three', 'Test Draw Sponge'] } } });
    let s = cast(base, 'Test Draw Three', [{ kind: 'player', id: 'p1' }]);
    s = cast(s, 'Test Draw Sponge');
    expect(count(s, 'p1', 'battlefield', 'Test Draw Sponge') + count(s, 'p1', 'graveyard', 'Test Draw Sponge')).toBe(1);
    // with 0 counters it is a 0/0 and dies (state-based actions); nothing was drawn by an opponent
    expect(count(s, 'p1', 'graveyard', 'Test Draw Sponge')).toBe(1);
  });
});

describe('CR 615.5, 119.3: "Prevent all damage target spell would deal this turn. You gain life equal to the damage prevented this way."', () => {
  const HALLOW = card('Test Hallow Ward', 'Instant', 'Prevent all damage target spell would deal this turn. You gain life equal to the damage prevented this way.');
  const BURN = card('Test Burn Four', 'Instant', '~ deals 4 damage to target player.', '{1}');
  it('is automated', () => expect(HALLOW.automation.level).toBe('full'));
  it('the damage the targeted spell would deal is prevented and the controller of the Hallow gains that much life', () => {
    const s0 = mpScenario({ players: 3, defs: [HALLOW, BURN], zones: { p1: { hand: ['Test Burn Four'], battlefield: ['Plains'] }, p2: { hand: ['Test Hallow Ward'] } } });
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burn Four', 'hand', 'p1') } as never);
    if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] } as never);
    if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    const burn = t.zones.stack.map((x) => (typeof x === 'string' ? x : (x as { id: string }).id)).find((id) => t.defs[t.objects[id]?.defId ?? '']?.name === 'Test Burn Four')!;
    t = act(t, { type: 'pass', player: 'p1' });
    const s = cast(t, 'Test Hallow Ward', [{ kind: 'object', id: burn }], [], 'p2');
    expect(lifeOf(s, 'p3')).toBe(lifeOf(s0, 'p3')); // the 4 damage was prevented
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') + 4); // the Hallow's controller gained that much
  });
  it('negative: another spell cast later still deals its damage and gains nothing', () => {
    const s0 = mpScenario({ players: 3, defs: [HALLOW, BURN], zones: { p1: { hand: ['Test Burn Four', 'Test Burn Four'], battlefield: ['Plains', 'Plains'] }, p2: { hand: ['Test Hallow Ward'] } } });
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Burn Four', 'hand', 'p1') } as never);
    t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] } as never);
    if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    const burn = t.zones.stack.map((x) => (typeof x === 'string' ? x : (x as { id: string }).id)).find((id) => t.defs[t.objects[id]?.defId ?? '']?.name === 'Test Burn Four')!;
    t = act(t, { type: 'pass', player: 'p1' });
    let s = cast(t, 'Test Hallow Ward', [{ kind: 'object', id: burn }], [], 'p2');
    const afterFirst = lifeOf(s, 'p3');
    s = cast(s, 'Test Burn Four', [{ kind: 'player', id: 'p3' }]);
    expect(lifeOf(s, 'p3')).toBe(afterFirst - 4);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') + 4);
  });
});

describe('CR 502.3, 611.2c, 615: "Tap all blocking creatures. Prevent all combat damage that would be dealt this turn. Each attacking creature and each blocking creature doesn\'t untap during its controller\'s next untap step."', () => {
  const CLOUD = card('Test Spore Mist', 'Instant', 'Tap all blocking creatures. Prevent all combat damage that would be dealt this turn. Each attacking creature and each blocking creature doesn\'t untap during its controller\'s next untap step.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', { power: '2', toughness: '2' });
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', '{0}', { power: '3', toughness: '3' });
  const tappedOf = (s: GameState, name: string, p: string): boolean => s.objects[idOf(s, name, 'battlefield', p)]!.tapped;
  it('is automated', () => expect(CLOUD.automation.level).toBe('full'));
  function afterBlocks(): GameState {
    let s = mpScenario({ players: 3, defs: [CLOUD, BEAR, WOLF], zones: { p1: { battlefield: ['Test Bear'], hand: ['Test Spore Mist'] }, p2: { battlefield: ['Test Wolf'] }, p3: { battlefield: ['Test Wolf'] } } });
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Bear', 'battlefield', 'p1'), defender: 'p2' }] });
    for (let i = 0; i < 10 && s.pending?.kind === 'priority'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    expect(s.pending?.kind).toBe('declareBlockers');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: idOf(s, 'Test Wolf', 'battlefield', 'p2'), attacker: idOf(s, 'Test Bear', 'battlefield', 'p1') }] });
    return s;
  }
  it('the blocker is tapped, no combat damage is dealt, and neither the attacker nor the blocker untaps in its controller\'s next untap step; an uninvolved creature untaps normally', () => {
    let s = afterBlocks();
    while (s.pending?.kind === 'priority' && s.pending.player !== 'p1') s = act(s, { type: 'pass', player: s.pending.player });
    s = cast(s, 'Test Spore Mist');
    expect(tappedOf(s, 'Test Wolf', 'p2')).toBe(true); // tapped by the spell
    const bearId = idOf(s, 'Test Bear', 'battlefield', 'p1');
    const wolfId = idOf(s, 'Test Wolf', 'battlefield', 'p2');
    for (let i = 0; i < 12 && s.pending?.kind === 'priority' && s.turn.step !== 'end'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    expect(s.objects[bearId]!.damage).toBe(0);
    expect(s.objects[wolfId]!.damage).toBe(0);
    // p3's Wolf is tapped by hand to see it untap normally in p3's untap step
    s.objects[idOf(s, 'Test Wolf', 'battlefield', 'p3')]!.tapped = true;
    // run to p2's turn: the blocker stays tapped through p2's untap step
    for (let i = 0; i < 60 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'upkeep'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.objects[wolfId]!.tapped).toBe(true);
    // p3's untap step: its Wolf untaps
    for (let i = 0; i < 60 && !(s.turn.activePlayer === 'p3' && s.turn.step === 'upkeep'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    expect(tappedOf(s, 'Test Wolf', 'p3')).toBe(false);
    // p1's next untap step: the attacker stays tapped (it attacked and has no vigilance)
    for (let i = 0; i < 60 && !(s.turn.activePlayer === 'p1' && s.turn.step === 'upkeep'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    expect(s.turn.activePlayer).toBe('p1');
    expect(s.objects[bearId]!.tapped).toBe(true);
  });
});

describe('CR 120.3, 701.9a, 608.2c: "~ deals 2 damage to each opponent. Those players each discard two cards at random."', () => {
  const REND = card('Test Skull Split', 'Sorcery', '~ deals 2 damage to each opponent. Those players each discard two cards at random.');
  const JUNK = card('Test Junk', 'Artifact', '', '{4}');
  it('is automated', () => expect(REND.automation.level).toBe('full'));
  it('every opponent takes the damage and discards two cards at random (all of them with fewer); the controller keeps their hand', () => {
    const s0 = mpScenario({ players: 3, defs: [REND, JUNK], zones: { p1: { hand: ['Test Skull Split', 'Test Junk'] }, p2: { hand: ['Test Junk', 'Test Junk', 'Test Junk'] }, p3: { hand: ['Test Junk'] } } });
    const s = cast(s0, 'Test Skull Split');
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 2);
    expect(lifeOf(s, 'p3')).toBe(lifeOf(s0, 'p3') - 2);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
    expect(count(s, 'p2', 'hand', 'Test Junk')).toBe(1);
    expect(count(s, 'p2', 'graveyard', 'Test Junk')).toBe(2);
    expect(count(s, 'p3', 'hand', 'Test Junk')).toBe(0);
    expect(count(s, 'p3', 'graveyard', 'Test Junk')).toBe(1);
    expect(count(s, 'p1', 'hand', 'Test Junk')).toBe(1);
  });
});

describe('CR 701.13a, 608.2d, 608.2c: "Target opponent may exile a card from their graveyard. If that player doesn\'t, you may draw a card."', () => {
  const STORM = card('Test Grave Storm', 'Instant', 'Target opponent may exile a card from their graveyard. If that player doesn\'t, you may draw a card.');
  const JUNK = card('Test Junk', 'Artifact', '', '{4}');
  it('is automated', () => expect(STORM.automation.level).toBe('full'));
  /** Answers by kind and player: `exile` is what the opponent (p2) answers to the may, `draw` what p1 answers to theirs. */
  function play(graveyard: string[], exile: boolean, draw: boolean): GameState {
    let s = mpScenario({ players: 3, defs: [STORM, JUNK], zones: { p1: { hand: ['Test Grave Storm'] }, p2: { graveyard } } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Storm', 'hand', 'p1') } as never);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as never);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let i = 0; i < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      const p = s.pending!;
      if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
      else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: p.player === 'p2' ? exile : draw });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [(p as unknown as { options: ObjectId[] }).options[0]!] });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    return s;
  }
  it('the opponent exiles a card from their graveyard: you do not draw', () => {
    const s = play(['Test Junk', 'Test Junk'], true, true);
    expect(count(s, 'p2', 'exile', 'Test Junk')).toBe(1);
    expect(count(s, 'p2', 'graveyard', 'Test Junk')).toBe(1);
    expect(zoneOf(s, 'p1', 'hand').length).toBe(1); // only the Plains of the turn's draw step
  });
  it('the opponent declines: you may draw a card (and do)', () => {
    const s = play(['Test Junk'], false, true);
    expect(count(s, 'p2', 'exile', 'Test Junk')).toBe(0);
    expect(zoneOf(s, 'p1', 'hand').length).toBe(2);
  });
  it('the opponent declines and you decline: nobody draws', () => {
    const s = play(['Test Junk'], false, false);
    expect(zoneOf(s, 'p1', 'hand').length).toBe(1); // only the Plains of the turn's draw step
  });
  it('an opponent with an empty graveyard cannot exile: you may draw', () => {
    const s = play([], true, true);
    expect(zoneOf(s, 'p1', 'hand').length).toBe(2);
  });
});

describe('CR 506.2, 119.3, 120.3: "Whenever this creature is dealt combat damage, you gain that much life and attacking player loses that much life."', () => {
  const SOUL = card('Test Faultless Soul', 'Creature — Spirit', 'Defender\nWhenever this creature is dealt combat damage, you gain that much life and attacking player loses that much life.', '{0}', { power: '0', toughness: '9' });
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', { power: '3', toughness: '3' });
  it('is automated', () => expect(SOUL.automation.level).toBe('full'));
  it('the player whose creature dealt the combat damage (the attacking player) loses that much, the controller gains it', () => {
    let s = mpScenario({ players: 3, defs: [SOUL, OGRE], zones: { p1: { battlefield: ['Test Faultless Soul'] }, p2: { battlefield: ['Test Ogre'] } } });
    const s0 = s;
    for (let i = 0; i < 80 && !(s.pending?.kind === 'declareAttackers' && s.pending.player === 'p2'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: idOf(s, 'Test Ogre', 'battlefield', 'p2'), defender: 'p1' }] });
    for (let i = 0; i < 10 && s.pending?.kind === 'priority'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    expect(s.pending?.kind).toBe('declareBlockers');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: idOf(s, 'Test Faultless Soul', 'battlefield', 'p1'), attacker: idOf(s, 'Test Ogre', 'battlefield', 'p2') }] });
    s = resolveStack(s, []);
    for (let i = 0; i < 12 && lifeOf(s, 'p1') === lifeOf(s0, 'p1') && s.pending?.kind === 'priority'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    s = resolveStack(s, []);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 3);
    expect(lifeOf(s, 'p2')).toBe(lifeOf(s0, 'p2') - 3);
    expect(lifeOf(s, 'p3')).toBe(lifeOf(s0, 'p3'));
  });
});
