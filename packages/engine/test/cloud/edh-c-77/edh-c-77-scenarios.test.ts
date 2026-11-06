/**
 * Commander lane edh-c, round edh-c-77 (EDHREC ranks 23,501-24,000, third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games. Each group has its negative cases. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 608.2c, 122.1, 611.2a  "Put a +1/+1 counter on target creature you control, and that creature gains flying until end of turn." (the join ", and that creature")
 *   CR 115.1, 601.2c, 608.2c  "Choose target opponent. Destroy target land that player controls. ~ deals 3 damage to that player and 1 damage to each creature they control."
 *   CR 701.20a, 608.2c        "You may reveal up to two instant cards from among them and put the revealed cards into your hand."
 *   CR 702.33a, 702.33c       "You may reveal a card with a kicker ability from among them and put it into your hand." (multikicker is a kicker cost)
 *   CR 607.2a, 607.2k, 702.72a "When ~ enters, sacrifice it unless you exile a creature you control other than ~. / When ~ leaves the battlefield, return the exiled card ..."
 *   CR 701.20a, 120.3, 202.3  "Target opponent reveals the top card of their library. ~ deals damage equal to the revealed card's mana value to that player and each creature that player controls. If a land card is revealed this way, return ~ to its owner's hand."
 *   CR 603.7c, 109.5, 509.1   "Destroy target creature. Whenever a creature blocks this turn, its controller loses 1 life."
 *   CR 508.1, 509.1, 603.4    "When ~ enters, you may exile target creature if it attacked or blocked this turn. Return that card ... at the beginning of the next end step."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, find, mpScenario, pass } from '../../m12/rules/helpers';
import { answer, legal } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers, toStep, tweak } from '../../m4/helpers';
import { card, full, pt, resolveAll, settle } from '../cmd3/helpers';

const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const onBf = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
const inHand = (s: GameState, p: string, defId: string): number => (s.zones.hand[p] ?? []).filter((id) => s.objects[id]!.defId === defId).length;
const inLib = (s: GameState, p: string, defId: string): number => (s.zones.library[p] ?? []).filter((id) => s.objects[id]!.defId === defId).length;
const inYard = (s: GameState, p: string, defId: string): number => (s.zones.graveyard[p] ?? []).filter((id) => s.objects[id]!.defId === defId).length;
const castAs = (s: GameState, name: string, player: string, picks: Parameters<typeof settle>[1] = {}): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never), picks);
/** Cast, answering each target decision in turn with the next list (a target that depends on an earlier one is chosen after it). */
const castSeq = (s0: GameState, name: string, player: string, lists: ReturnType<typeof target>[][]): GameState => {
  let s = act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never);
  for (const l of lists) if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: l } as never);
  return resolveAll(s);
};
const target = (id: string, kind: 'object' | 'player' = 'object') => ({ kind, id } as never);
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => k.keyword);
const activate = (s: GameState, id: ObjectId, picks: Parameters<typeof settle>[1] = {}): GameState => {
  const a = legal(s, 'p1', 'activate').find((x) => x.object === id && !x.isMana)!;
  return resolveAll(settle(act(s, a.action), picks), picks);
};

describe('CR 608.2c, 122.1, 611.2a: "{0}: Put a +1/+1 counter on another target creature you control, and that creature gains flying until end of turn."', () => {
  const COACH = card('Test Wing Coach', 'Creature — Bird', '{0}: Put a +1/+1 counter on another target creature you control, and that creature gains flying until end of turn.', ['1', '1']);
  const OX = card('Test Plain Ox', 'Creature — Ox', '', ['2', '2']);
  const FOE = card('Test Foe Ox', 'Creature — Ox', '', ['2', '2']);
  const defs = [COACH, OX, FOE];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Wing Coach', 'Test Plain Ox'] }, p2: { battlefield: ['Test Foe Ox'] } } });
  it('is automated', () => expect(full(COACH)).toBe(true));
  it('the other creature gets the counter and flying until end of turn; the source itself does not', () => {
    const s0 = start();
    const ox = onBf(s0, 'p1', 'Test Plain Ox')[0]!;
    const coach = onBf(s0, 'p1', 'Test Wing Coach')[0]!;
    const s1 = activate(s0, coach, { targets: [target(ox)] });
    expect(pt(s1, ox)).toBe('3/3');
    expect(kws(s1, ox)).toContain('flying');
    expect(pt(s1, coach)).toBe('1/1');
    expect(kws(s1, coach)).not.toContain('flying');
  });
  it('an opponent\'s creature is not a legal target (negative)', () => {
    const s0 = start();
    const foe = onBf(s0, 'p2', 'Test Foe Ox')[0]!;
    const coach = onBf(s0, 'p1', 'Test Wing Coach')[0]!;
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === coach && !x.isMana)!;
    const d = act(s0, a.action);
    const opts = (d.pending as { targets?: { options?: { id: string }[] }[] } | undefined)?.targets?.[0]?.options ?? [];
    expect(opts.map((o) => o.id)).not.toContain(foe);
  });
  it('", and that creature" is the same ability as ". That creature" (one reading, not two)', () => {
    const plain = card('Test Wing Coach', 'Creature — Bird', '{0}: Put a +1/+1 counter on another target creature you control. That creature gains flying until end of turn.', ['1', '1']);
    expect(JSON.stringify(COACH.faces[0]!.abilities.map((a) => (a as { effect?: unknown }).effect))).toBe(JSON.stringify(plain.faces[0]!.abilities.map((a) => (a as { effect?: unknown }).effect)));
  });

});

describe('CR 115.1, 601.2c, 608.2c: "Choose target opponent. Destroy target land that player controls. ~ deals 2 damage to that player and 1 damage to each creature they control."', () => {
  const BLAST = card('Test Raze Plan', 'Sorcery', 'Choose target opponent. Destroy target land that player controls. ~ deals 2 damage to that player and 1 damage to each creature they control.');
  const OX = card('Test Plain Ox', 'Creature — Ox', '', ['2', '3']);
  const defs = [BLAST, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Raze Plan'], battlefield: ['Test Plain Ox'] }, p2: { battlefield: ['Plains', 'Plains', 'Test Plain Ox'] }, p3: { battlefield: ['Plains'] } } });
  it('is automated', () => expect(full(BLAST)).toBe(true));
  it('destroys a land of the chosen opponent only, damages that player and their creatures only', () => {
    const s0 = start();
    const land = s0.zones.battlefield.find((id) => s0.objects[id]!.controller === 'p2' && s0.objects[id]!.defId === 'Plains')!;
    const s1 = castSeq(s0, 'Test Raze Plan', 'p1', [[target('p2', 'player')], [target(land)]]);
    expect(onBf(s1, 'p2', 'Plains').length).toBe(1);
    expect(onBf(s1, 'p3', 'Plains').length).toBe(1);
    expect(life(s1, 'p2')).toBe(18);
    expect(life(s1, 'p3')).toBe(20);
    expect(s1.objects[onBf(s1, 'p2', 'Test Plain Ox')[0]!]!.damage).toBe(1);
    expect(s1.objects[onBf(s1, 'p1', 'Test Plain Ox')[0]!]!.damage).toBe(0);
  });
  it('a land of another player is not a legal target (the land is "that player controls", negative)', () => {
    const s0 = start();
    const other = s0.zones.battlefield.find((id) => s0.objects[id]!.controller === 'p3' && s0.objects[id]!.defId === 'Plains')!;
    expect(() => castSeq(s0, 'Test Raze Plan', 'p1', [[target('p2', 'player')], [target(other)]])).toThrow();
  });
});

describe('CR 701.20a, 608.2c: "Look at the top four cards of your library. You may reveal up to two instant cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in any order."', () => {
  const CLUES = card('Test Trail Notes', 'Sorcery', 'Look at the top four cards of your library. You may reveal up to two instant cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in any order.');
  const I1 = card('Test Spark One', 'Instant', '~ deals 1 damage to any target.');
  const I2 = card('Test Spark Two', 'Instant', '~ deals 2 damage to any target.');
  const I3 = card('Test Spark Three', 'Instant', '~ deals 3 damage to any target.');
  const OX = card('Test Plain Ox', 'Creature — Ox', '', ['2', '2']);
  const defs = [CLUES, I1, I2, I3, OX];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Trail Notes'], library: ['Plains', 'Test Spark One', 'Test Plain Ox', 'Test Spark Two', 'Test Spark Three', 'Test Plain Ox'] } } });
  it('is automated', () => expect(full(CLUES)).toBe(true));
  it('two of the three instants seen are taken and put into the hand; the other cards go to the bottom', () => {
    const s0 = start();
    const [i1, , i2] = s0.zones.library['p1']!.slice(0, 4) as [string, string, string, string];
    const s1 = resolveAll(castAs(s0, 'Test Trail Notes', 'p1'), { objects: [i1, i2] });
    expect(inHand(s1, 'p1', 'Test Spark One')).toBe(1);
    expect(inHand(s1, 'p1', 'Test Spark Two')).toBe(1);
    expect(inHand(s1, 'p1', 'Test Spark Three')).toBe(0);
    expect(inHand(s1, 'p1', 'Test Plain Ox')).toBe(0);
    // the fifth card was never looked at: it is on top of the library after the other cards of the four went to the bottom
    expect(s1.objects[s1.zones.library['p1']![0]!]!.defId).toBe('Test Plain Ox');
    expect(inLib(s1, 'p1', 'Test Spark Three')).toBe(1);
  });
  it('a third instant is refused: at most two cards can be taken (negative)', () => {
    const s0 = start();
    const [i1, , i2, i3] = s0.zones.library['p1']!.slice(0, 4) as [string, string, string, string];
    expect(() => resolveAll(castAs(s0, 'Test Trail Notes', 'p1'), { objects: [i1, i2, i3] })).toThrow();
  });
  it('a creature card among the four is never taken (negative)', () => {
    const s0 = start();
    const oxen = s0.zones.library['p1']!.slice(0, 4).filter((id) => s0.objects[id]!.defId === 'Test Plain Ox');
    expect(() => resolveAll(castAs(s0, 'Test Trail Notes', 'p1'), { objects: oxen })).toThrow();
  });
});

describe('CR 702.33a, 702.33c, 201.5: "When ~ enters, look at the top five cards of your library. You may reveal a card with a kicker ability from among them and put it into your hand."', () => {
  const SCRIBE = card('Test Rune Scribe', 'Creature — Wizard', 'When ~ enters, look at the top five cards of your library. You may reveal a card with a kicker ability from among them and put it into your hand. Put the rest on the bottom of your library in a random order.', ['1', '1']);
  const K = card('Test Kick Bolt', 'Instant', 'Kicker {2}\n~ deals 2 damage to any target.');
  const MK = card('Test Multi Bolt', 'Instant', 'Multikicker {1}\n~ deals 1 damage to any target.');
  const PLAIN = card('Test Plain Bolt', 'Instant', '~ deals 2 damage to any target.');
  const defs = [SCRIBE, K, MK, PLAIN];
  const start = (top: string[]): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Rune Scribe'], library: top } } });
  it('is automated', () => expect(full(SCRIBE)).toBe(true));
  it('a card with kicker can be taken', () => {
    const s0 = start(['Plains', 'Test Plain Bolt', 'Test Kick Bolt', 'Plains', 'Plains', 'Plains']);
    const k = s0.zones.library['p1']![1]!;
    const s1 = resolveAll(castAs(s0, 'Test Rune Scribe', 'p1'), { objects: [k] });
    expect(inHand(s1, 'p1', 'Test Kick Bolt')).toBe(1);
    expect(inHand(s1, 'p1', 'Test Plain Bolt')).toBe(0);
  });
  it('a card with multikicker (a kicker cost, CR 702.33c) can be taken', () => {
    const s0 = start(['Plains', 'Test Plain Bolt', 'Test Multi Bolt', 'Plains', 'Plains', 'Plains']);
    const k = s0.zones.library['p1']![1]!;
    const s1 = resolveAll(castAs(s0, 'Test Rune Scribe', 'p1'), { objects: [k] });
    expect(inHand(s1, 'p1', 'Test Multi Bolt')).toBe(1);
  });
  it('a card without a kicker ability cannot be taken, whatever is picked (negative)', () => {
    const s0 = start(['Plains', 'Test Plain Bolt', 'Plains', 'Plains', 'Plains', 'Plains']);
    const p = s0.zones.library['p1']![0]!;
    const s1 = resolveAll(castAs(s0, 'Test Rune Scribe', 'p1'), { objects: [p] });
    expect(inHand(s1, 'p1', 'Test Plain Bolt')).toBe(0);
  });
});

describe('CR 607.2a, 607.2k, 702.72a: "When ~ enters, sacrifice it unless you exile a creature you control other than ~. When ~ leaves the battlefield, return the exiled card to the battlefield under its owner\'s control."', () => {
  const DRAKE = card('Test Warp Drake', 'Creature — Drake', 'Flying\nWhen ~ enters, sacrifice it unless you exile a creature you control other than ~.\nWhen ~ leaves the battlefield, return the exiled card to the battlefield under its owner\'s control.', ['3', '3']);
  const OX = card('Test Plain Ox', 'Creature — Ox', '', ['2', '2']);
  const KILL = card('Test Slay Spell', 'Instant', 'Destroy target creature.');
  const defs = [DRAKE, OX, KILL];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Warp Drake'], battlefield: ['Test Plain Ox'] }, p2: { hand: ['Test Slay Spell'] } } });
  it('is automated', () => expect(full(DRAKE)).toBe(true));
  it('exiling a creature keeps the drake; when the drake leaves, the exiled creature returns', () => {
    const s0 = start();
    const ox = onBf(s0, 'p1', 'Test Plain Ox')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Warp Drake', 'p1'), { objects: [ox] });
    expect(onBf(s1, 'p1', 'Test Warp Drake').length).toBe(1);
    expect(onBf(s1, 'p1', 'Test Plain Ox').length).toBe(0);
    expect(s1.zones.exile.some((id) => s1.objects[id]!.defId === 'Test Plain Ox')).toBe(true);
    const drake = onBf(s1, 'p1', 'Test Warp Drake')[0]!;
    let s2 = tweak(s1, (st) => { st.turn.activePlayer = 'p2'; st.pending = { ...st.pending!, player: 'p2' } as never; });
    s2 = resolveAll(castAs(s2, 'Test Slay Spell', 'p2', { targets: [target(drake)] }), { targets: [target(drake)] });
    expect(onBf(s2, 'p1', 'Test Warp Drake').length).toBe(0);
    expect(onBf(s2, 'p1', 'Test Plain Ox').length).toBe(1);
  });
  it('CR 607.2a (ruling 2022-12-08): the drake that left before its enters ability resolved returns nothing; the creature exiled afterwards stays exiled', () => {
    const s0 = start();
    const ox = onBf(s0, 'p1', 'Test Plain Ox')[0]!;
    // cast the drake and let the spell resolve: its enters trigger is on the stack
    let s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Warp Drake', 'hand', 'p1') } as never);
    s1 = settle(s1);
    s1 = pass(s1); // p1 passes with the spell on the stack ... p2 and the others pass, the spell resolves
    for (let i = 0; i < 12 && !s1.zones.stack.some((id) => s1.objects[id]?.stack?.kind === 'triggered'); i++) s1 = pass(s1);
    const drake = onBf(s1, 'p1', 'Test Warp Drake')[0]!;
    expect(drake).toBeDefined();
    // p2 destroys the drake in response to the enters trigger
    s1 = tweak(s1, (st) => { st.pending = { ...st.pending!, player: 'p2' } as never; });
    s1 = settle(act(s1, { type: 'cast', player: 'p2', card: find(s1, 'Test Slay Spell', 'hand', 'p2') } as never), { targets: [target(drake)] });
    const s2 = resolveAll(s1, { targets: [target(drake)], objects: [ox] });
    expect(onBf(s2, 'p1', 'Test Warp Drake').length).toBe(0);
    expect(onBf(s2, 'p1', 'Test Plain Ox').length).toBe(0);
    expect(s2.zones.exile.some((id) => s2.objects[id]!.defId === 'Test Plain Ox')).toBe(true);
  });
  it('CR 607.2a: two enters triggers of one drake (Panharmonicon) exile two creatures and both return when it leaves', () => {
    const PAN = card('Test Echo Engine', 'Artifact', 'If a permanent entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.');
    const s0 = mpScenario({ defs: [...defs, PAN, card('Test Bear', 'Creature — Bear', '', ['2', '2'])], zones: { p1: { hand: ['Test Warp Drake'], battlefield: ['Test Echo Engine', 'Test Plain Ox', 'Test Bear'] }, p2: { hand: ['Test Slay Spell'] } } });
    const [ox, bear] = [onBf(s0, 'p1', 'Test Plain Ox')[0]!, onBf(s0, 'p1', 'Test Bear')[0]!];
    let s1 = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Warp Drake', 'hand', 'p1') } as never));
    for (let i = 0; i < 12 && onBf(s1, 'p1', 'Test Bear').length + onBf(s1, 'p1', 'Test Plain Ox').length > 0; i++) s1 = settle(pass(s1), { objects: [onBf(s1, 'p1', 'Test Plain Ox')[0] ?? onBf(s1, 'p1', 'Test Bear')[0]!] });
    expect(s1.zones.exile.length).toBe(2);
    const drake = onBf(s1, 'p1', 'Test Warp Drake')[0]!;
    expect(drake).toBeDefined();
    s1 = tweak(s1, (st) => { st.pending = { ...st.pending!, player: 'p2' } as never; });
    const s2 = resolveAll(castAs(s1, 'Test Slay Spell', 'p2', { targets: [target(drake)] }), { targets: [target(drake)] });
    expect(onBf(s2, 'p1', 'Test Plain Ox').length + onBf(s2, 'p1', 'Test Bear').length).toBe(2);
    expect([ox, bear].length).toBe(2);
  });
  it('without a creature to exile (or declining) the drake is sacrificed and nothing comes back (negative)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Warp Drake'] } } });
    const s1 = resolveAll(castAs(s0, 'Test Warp Drake', 'p1'));
    expect(onBf(s1, 'p1', 'Test Warp Drake').length).toBe(0);
    expect(inYard(s1, 'p1', 'Test Warp Drake')).toBe(1);
    expect(s1.zones.exile.length).toBe(0);
  });
});

describe('CR 701.20a, 120.3, 202.3: "Target opponent reveals the top card of their library. ~ deals damage equal to the revealed card\'s mana value to that player and each creature that player controls. If a land card is revealed this way, return ~ to its owner\'s hand."', () => {
  const ERUPT = card('Test Mind Flare', 'Instant', 'Target opponent reveals the top card of their library. ~ deals damage equal to the revealed card\'s mana value to that player and each creature that player controls. If a land card is revealed this way, return ~ to its owner\'s hand.', undefined, '{0}');
  const BIG = card('Test Big Spell', 'Sorcery', '', undefined, '{3}{R}');
  const OX = card('Test Plain Ox', 'Creature — Ox', '', ['2', '9']);
  const defs = [ERUPT, BIG, OX];
  const start = (top: string): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Mind Flare'], battlefield: ['Test Plain Ox'] }, p2: { battlefield: ['Test Plain Ox'], library: [top] }, p3: { battlefield: ['Test Plain Ox'] } } });
  it('is automated', () => expect(full(ERUPT)).toBe(true));
  it('a mana value 4 card: 4 damage to the opponent and to each creature they control, nothing to the others; the spell goes to the graveyard', () => {
    const s0 = start('Test Big Spell');
    const picks = { targets: [target('p2', 'player')] };
    const s1 = resolveAll(castAs(s0, 'Test Mind Flare', 'p1', picks), picks);
    expect(life(s1, 'p2')).toBe(16);
    expect(s1.objects[onBf(s1, 'p2', 'Test Plain Ox')[0]!]!.damage).toBe(4);
    expect(s1.objects[onBf(s1, 'p3', 'Test Plain Ox')[0]!]!.damage).toBe(0);
    expect(s1.objects[onBf(s1, 'p1', 'Test Plain Ox')[0]!]!.damage).toBe(0);
    expect(life(s1, 'p3')).toBe(20);
    expect(inYard(s1, 'p1', 'Test Mind Flare')).toBe(1);
  });
  it('a land (mana value 0): no damage, and the spell returns to its owner\'s hand', () => {
    const s0 = start('Plains');
    const picks = { targets: [target('p2', 'player')] };
    const s1 = resolveAll(castAs(s0, 'Test Mind Flare', 'p1', picks), picks);
    expect(life(s1, 'p2')).toBe(20);
    expect(inHand(s1, 'p1', 'Test Mind Flare')).toBe(1);
  });
});

describe('CR 603.7c, 109.5, 509.1: "Destroy target creature. Whenever a creature blocks this turn, its controller loses 1 life."', () => {
  const HUNT = card('Test Wall Hunt', 'Sorcery', 'Destroy target creature. Whenever a creature blocks this turn, its controller loses 1 life.');
  const ATK = card('Test Raider', 'Creature — Orc', '', ['2', '2']);
  const BLK = card('Test Guard', 'Creature — Ox', '', ['1', '4']);
  const DOOMED = card('Test Doomed Ox', 'Creature — Ox', '', ['1', '1']);
  const defs = [HUNT, ATK, BLK, DOOMED];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Wall Hunt'], battlefield: ['Test Raider'] }, p2: { battlefield: ['Test Guard'] }, p3: { battlefield: ['Test Doomed Ox'] } } });
  it('is automated', () => expect(full(HUNT)).toBe(true));
  it('the player who controls the blocking creature loses 1 life, not the controller of the destroyed one, and only a blocker triggers it', () => {
    const s0 = start();
    const doomed = onBf(s0, 'p3', 'Test Doomed Ox')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Wall Hunt', 'p1', { targets: [target(doomed)] }), { targets: [target(doomed)] });
    expect(onBf(s1, 'p3', 'Test Doomed Ox').length).toBe(0);
    expect(life(s1, 'p3')).toBe(20);
    expect(life(s1, 'p2')).toBe(20);
    const raider = onBf(s1, 'p1', 'Test Raider')[0]!;
    const guard = onBf(s1, 'p2', 'Test Guard')[0]!;
    let s2 = tweak(s1, (st) => { st.objects[raider]!.controlledSinceTurn = 0; });
    s2 = declareAttackers(toDeclareAttackers(s2), [[raider, 'p2']]);
    s2 = declareBlockers(toDeclareBlockers(s2), [[guard, raider]]);
    s2 = resolveAll(s2);
    expect(life(s2, 'p2')).toBe(19);
    expect(life(s2, 'p1')).toBe(20);
    expect(life(s2, 'p3')).toBe(20);
  });
  it('with no block this turn nobody loses life (negative)', () => {
    const s0 = start();
    const doomed = onBf(s0, 'p3', 'Test Doomed Ox')[0]!;
    const s1 = resolveAll(castAs(s0, 'Test Wall Hunt', 'p1', { targets: [target(doomed)] }), { targets: [target(doomed)] });
    const raider = onBf(s1, 'p1', 'Test Raider')[0]!;
    let s2 = tweak(s1, (st) => { st.objects[raider]!.controlledSinceTurn = 0; });
    s2 = declareAttackers(toDeclareAttackers(s2), [[raider, 'p2']]);
    s2 = declareBlockers(toDeclareBlockers(s2), []);
    s2 = resolveAll(s2);
    expect(life(s2, 'p2')).toBe(20);
    expect(life(s2, 'p3')).toBe(20);
  });
});

describe('CR 508.1, 509.1, 603.4: "When ~ enters, you may exile target creature if it attacked or blocked this turn. Return that card to the battlefield under its owner\'s control at the beginning of the next end step."', () => {
  const VIZ = card('Test Phase Clerk', 'Creature — Human', 'Flash\nWhen ~ enters, you may exile target creature if it attacked or blocked this turn. Return that card to the battlefield under its owner\'s control at the beginning of the next end step.', ['1', '1']);
  const OX = card('Test Plain Ox', 'Creature — Ox', '', ['2', '2']);
  const GUARD = card('Test Guard', 'Creature — Ox', '', ['1', '4']);
  const defs = [VIZ, OX, GUARD];
  it('is automated', () => expect(full(VIZ)).toBe(true));
  it('a target that did not attack or block this turn is not exiled (negative)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Phase Clerk'] }, p2: { battlefield: ['Test Plain Ox'] } } });
    const ox = onBf(s0, 'p2', 'Test Plain Ox')[0]!;
    const picks = { targets: [target(ox)] };
    const s1 = resolveAll(castAs(s0, 'Test Phase Clerk', 'p1', picks), picks);
    expect(onBf(s1, 'p2', 'Test Plain Ox').length).toBe(1);
    expect(s1.zones.exile.length).toBe(0);
  });
  it('a target that attacked this turn is exiled and comes back at the beginning of the next end step', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Phase Clerk'], battlefield: ['Test Plain Ox'] } } });
    const ox = onBf(s0, 'p1', 'Test Plain Ox')[0]!;
    let s1 = tweak(s0, (st) => { st.objects[ox]!.controlledSinceTurn = 0; });
    s1 = declareAttackers(toDeclareAttackers(s1), [[ox, 'p2']]);
    s1 = toStep(s1, 'declareBlockers');
    const picks = { targets: [target(ox)] };
    const s2 = resolveAll(castAs(s1, 'Test Phase Clerk', 'p1', picks), picks);
    expect(onBf(s2, 'p1', 'Test Plain Ox').length).toBe(0);
    expect(s2.zones.exile.some((id) => s2.objects[id]!.defId === 'Test Plain Ox')).toBe(true);
    const s3 = toStep(s2, 'end');
    const s4 = resolveAll(s3);
    expect(onBf(s4, 'p1', 'Test Plain Ox').length).toBe(1);
  });
  it('a creature that blocked this turn is exiled too', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Plain Ox'] }, p2: { battlefield: ['Test Guard'], hand: ['Test Phase Clerk'] } } });
    const ox = onBf(s0, 'p1', 'Test Plain Ox')[0]!;
    const guard = onBf(s0, 'p2', 'Test Guard')[0]!;
    let s1 = tweak(s0, (st) => { st.objects[ox]!.controlledSinceTurn = 0; });
    s1 = declareAttackers(toDeclareAttackers(s1), [[ox, 'p2']]);
    s1 = declareBlockers(toDeclareBlockers(s1), [[guard, ox]]);
    // p2 (the blocker's controller) casts the flash creature during the declare blockers step
    s1 = passUntil(s1, (x) => x.pending?.player === 'p2' && x.turn.step === 'declareBlockers', 'p2 priority in the declare blockers step');
    const picks = { targets: [target(guard)] };
    const s2 = resolveAll(castAs(s1, 'Test Phase Clerk', 'p2', picks), picks);
    expect(onBf(s2, 'p2', 'Test Guard').length).toBe(0);
  });
});

describe('CR 106.6, 601.2a, 702.34a: "{T}: Add two mana in any combination of colors. Spend this mana only to cast spells with flashback from a graveyard."', () => {
  const ALTAR = card('Test Grave Altar', 'Artifact', '{T}: Add two mana in any combination of colors. Spend this mana only to cast spells with flashback from a graveyard.');
  const FB = card('Test Echo Burn', 'Instant', 'Flashback {1}{R}\n~ deals 2 damage to any target.', undefined, '{1}{R}');
  const PLAIN = card('Test Plain Burn', 'Instant', '~ deals 2 damage to any target.', undefined, '{1}{R}');
  const defs = [ALTAR, FB, PLAIN];
  const castable = (s: GameState, name: string, from: 'hand' | 'graveyard'): boolean => legal(s, 'p1', 'cast').some((a) => s.defs[s.objects[a.object!]!.defId]!.name === name && s.objects[a.object!]!.zone === from);
  it('is automated', () => expect(full(ALTAR)).toBe(true));
  it('a flashback spell in a graveyard can be cast with the altar\'s mana alone', () => {
    const s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Grave Altar'], graveyard: ['Test Echo Burn'] } } });
    expect(castable(s, 'Test Echo Burn', 'graveyard')).toBe(true);
  });
  it('the same card in the hand, and a spell with no flashback, cannot use the altar\'s mana (negative)', () => {
    const s = mpScenario({ defs, zones: { p1: { battlefield: ['Test Grave Altar'], hand: ['Test Echo Burn', 'Test Plain Burn'] } } });
    expect(castable(s, 'Test Echo Burn', 'hand')).toBe(false);
    expect(castable(s, 'Test Plain Burn', 'hand')).toBe(false);
  });
});
