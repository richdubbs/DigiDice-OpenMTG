/**
 * std-ru (card wave 2, slice s5): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 701.20a, 608.2c  "You may reveal a <card> from among them. You may put it onto the battlefield if it's your turn. If you don't put it onto the battlefield,
 *                       put it into your hand." (eff.stdrx31.dig.reveal.fromAmong, eff.stdru.may.put.bf.ifCond): onto the battlefield on your turn, else into your hand
 *   CR 508.1b, 301.5    "As long as ~ is attached to a creature, ~ can't be attacked and has "..."" (sta.stdru.aslong.cantBeAttacked.has): not attackable while
 *                       attached, attackable when not; the granted trigger counts the combat damage during your turn only (CR 603.2, 510.2)
 *   CR 607.2a, 614.1a   an "exile it instead" replacement exiles the cards "exiled with ~" (the linked permission reads them; a card exiled otherwise is not one)
 *   CR 118.9, 202.3     "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost": cast for life, no mana; only during your turn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass } from '../../m3/scenario';
import { scenario } from '../../m3/scenario';
import { passUntil, toDeclareAttackers } from '../../m4/helpers';
import { attackWith, card, counters, full, resolveAll, settle } from '../cmd3/helpers';

const SCOUT = card('Test Scout', 'Creature — Mouse Scout',
  "{0}: Look at the top three cards of your library. You may reveal a creature card with mana value 3 or less from among them. You may put it onto the battlefield if it's your turn. If you don't put it onto the battlefield, put it into your hand. Put the rest on the bottom of your library in a random order.",
  ['1', '1']);
const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const GIANT = card('Test Giant', 'Creature — Giant', '', ['5', '5'], '{4}{R}');
const SPARK = compileCard({
  name: 'Test Spark', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Artifact Planeswalker — Equipment', colors: [], keywords: [], loyalty: '4',
  oracle_text: 'As long as Test Spark is attached to a creature, Test Spark can\'t be attacked and has "Whenever equipped creature deals combat damage during your turn, put that many loyalty counters on Test Spark."\n+1: Attach Test Spark to up to one target creature you control.',
} as OracleCard);
const RAIDER = card('Test Raider', 'Creature — Goblin', '', ['3', '3']);
const DEVOURER = card('Test Devourer', 'Creature — Demon',
  "If a nonland card would be put into a graveyard from anywhere, exile it instead.\nDuring your turn, you may play lands and cast spells from among cards exiled with ~. If you cast a spell this way, pay life equal to its mana value rather than paying its mana cost.",
  ['6', '6']);
const SIPHON = card('Test Siphon', 'Sorcery', 'Target player mills two cards.', undefined, '{0}');
const PURGE = card('Test Purge', 'Instant', 'Exile target card from a graveyard.', undefined, '{0}');
const SURGE = card('Test Surge', 'Sorcery', 'You gain X life.', undefined, '{X}{R}');
const DEFS = [SCOUT, CUB, GIANT, SPARK, RAIDER, DEVOURER, SIPHON, PURGE, SURGE];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const zoneOf = (s: GameState, id: ObjectId | undefined): string | undefined => (id === undefined ? undefined : s.objects[id]?.zone);
const activate = (s: GameState, label: RegExp, player = 'p1'): GameState => {
  const a = legalActions(s, player).find((x) => x.kind === 'activate' && label.test(x.label));
  if (!a) throw new Error(`no activation ${label} for ${player}: ${legalActions(s, player).map((x) => x.label).join('; ')}`);
  return act(s, a.action);
};

describe('CR 701.20a, 608.2c: reveal one card from among them, then onto the battlefield if it is your turn, else into your hand', () => {
  const dig = (s0: GameState, yes: boolean, player = 'p1'): { s: GameState; cub: ObjectId } => {
    const cub = find(s0, 'Test Cub', 'library', 'p1');
    let s = activate(s0, /Test Scout/, player);
    s = resolveAll(s, { objects: [cub], yes });
    return { s, cub };
  };
  it('on your turn, the revealed creature card may be put onto the battlefield; the rest go to the bottom', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Scout'], library: ['Test Cub', 'Test Giant', 'Plains'] }, defs: DEFS });
    const { s, cub } = dig(s0, true);
    const moved = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Cub');
    expect(moved, 'the Cub entered').toBeDefined();
    expect(s.objects[moved!]!.controller).toBe('p1');
    expect(zoneOf(s, cub)).not.toBe('library');
    // the Giant (mana value 5) was never a candidate: it went to the bottom with the Plains
    const lib = s.zones.library['p1']!;
    expect(lib.slice(-2).map((id) => s.objects[id]!.defId).sort()).toEqual(['Plains', 'Test Giant']);
  });
  it('declined on your turn: the card goes into your hand (CR 608.2c: "if you don\'t put it onto the battlefield")', () => {
    const s0 = scenario(['Plains'], { p1: { battlefield: ['Test Scout'], library: ['Test Cub', 'Test Giant', 'Plains'] }, defs: DEFS });
    const { s } = dig(s0, false);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Cub')).toBe(false);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Cub')).toBe(true);
  });
  it("on an opponent's turn the card is never put onto the battlefield: it goes into your hand", () => {
    let s0 = scenario(['Plains'], { p1: { battlefield: ['Test Scout'], library: ['Test Cub', 'Test Giant', 'Plains'] }, defs: DEFS });
    s0 = advanceTo(s0, 2, 'main1');
    s0 = passUntil(s0, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1', 'priority for p1 on turn 2');
    const { s } = dig(s0, true);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Cub')).toBe(false);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Cub')).toBe(true);
  });
});

describe('CR 508.1b, 301.5: "As long as ~ is attached to a creature, ~ can\'t be attacked and has "...""', () => {
  const attackOptions = (s: GameState, attacker: ObjectId): string[] => {
    const d = s.pending as unknown as { candidates?: { id: string; defenders: string[] }[] };
    return d.candidates?.find((o) => o.id === attacker)?.defenders ?? [];
  };
  const board = (attached: boolean): GameState => {
    let s = scenario(['Plains'], { p1: { battlefield: [{ name: 'Test Spark', counters: { loyalty: 4 } }, 'Test Cub'] }, p2: { battlefield: ['Test Raider'] }, defs: DEFS });
    if (attached) {
      const cub = find(s, 'Test Cub', 'battlefield');
      s = resolveAll(settle(activate(s, /\+1/), { targets: [{ kind: 'object', id: cub }] }), { targets: [{ kind: 'object', id: cub }] });
    }
    return s;
  };
  it('attached to a creature, it is not among the defenders the opponent\'s creature may attack', () => {
    let s = board(true);
    const spark = find(s, 'Test Spark', 'battlefield');
    expect(s.objects[spark]!.attachedTo).toBeDefined();
    s = advanceTo(s, 2, 'main1');
    s = toDeclareAttackers(s);
    const raider = find(s, 'Test Raider', 'battlefield');
    const opts = attackOptions(s, raider);
    expect(opts).toContain('p1');
    expect(opts).not.toContain(spark);
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [{ attacker: raider, defender: spark }] })).toThrow();
  });
  it('CR 603.2: not during an opponent\'s turn (the equipped creature deals combat damage as a blocker: no counters)', () => {
    let s = board(true);
    const spark = find(s, 'Test Spark', 'battlefield');
    const before = counters(s, spark, 'loyalty');
    s = advanceTo(s, 2, 'main1');
    s = toDeclareAttackers(s);
    const raider = find(s, 'Test Raider', 'battlefield');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: raider, defender: 'p1' }] });
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Test Cub', 'battlefield'), attacker: raider }] });
    s = resolveAll(passUntil(s, (x) => x.zones.stack.length > 0 || x.turn.step === 'endCombat', 'the end of combat'));
    expect(counters(s, spark, 'loyalty')).toBe(before);
  });
  it('not attached, it may be attacked', () => {
    let s = board(false);
    const spark = find(s, 'Test Spark', 'battlefield');
    s = advanceTo(s, 2, 'main1');
    s = toDeclareAttackers(s);
    expect(attackOptions(s, find(s, 'Test Raider', 'battlefield'))).toContain(spark);
  });
  it('CR 603.2, 510.2: the equipped creature\'s combat damage during your turn puts that many loyalty counters on it', () => {
    let s = board(true);
    const spark = find(s, 'Test Spark', 'battlefield');
    const before = counters(s, spark, 'loyalty');
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(attackWith(s, [find(s, 'Test Cub', 'battlefield')]));
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    s = resolveAll(passUntil(s, (x) => x.zones.stack.length > 0 || x.turn.step === 'endCombat', 'the damage trigger'));
    expect(counters(s, spark, 'loyalty')).toBe(before + 2);
  });
});

describe('CR 607.2a, 614.1a, 118.9: the cards an "exile it instead" replacement exiled, played during your turn for life', () => {
  const milled = (): { s: GameState; cub: ObjectId } => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Devourer'], hand: ['Test Siphon'] }, p2: { library: ['Test Cub', 'Test Giant'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Siphon', 'hand') }), { targets: [{ kind: 'player', id: 'p2' }] }), { targets: [{ kind: 'player', id: 'p2' }] });
    const cub = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Cub')!;
    return { s, cub };
  };
  it('the opponent\'s milled cards are exiled instead, and during your turn you may cast one for life equal to its mana value, with no mana', () => {
    const { s: s0, cub } = milled();
    expect(cub, 'the Cub was exiled instead of milled').toBeDefined();
    expect((s0.zones.graveyard['p2'] ?? []).length).toBe(0);
    const casts = legalActions(s0, 'p1').filter((a) => a.kind === 'cast' && a.object === cub);
    expect(casts.length).toBe(1);
    const before = life(s0, 'p1');
    const s = resolveAll(settle(act(s0, casts[0]!.action)));
    expect(life(s, 'p1')).toBe(before - 2); // CR 202.3: {1}{G} is mana value 2
    const bear = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Cub');
    expect(bear).toBeDefined();
    expect(s.objects[bear!]!.controller).toBe('p1');
  });
  it('CR 107.3b, 202.3e (audit-fix-1): a spell with {X} is cast with X = 0, for life equal to its mana value with X = 0', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Devourer'], hand: ['Test Siphon'] }, p2: { library: ['Test Surge', 'Test Giant'] }, defs: DEFS });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Siphon', 'hand') }), { targets: [{ kind: 'player', id: 'p2' }] }), { targets: [{ kind: 'player', id: 'p2' }] });
    const surge = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Surge')!;
    const before = life(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: surge });
    expect(s.pending?.kind).not.toBe('chooseNumber'); // audit-fix-1, CR 107.3b: the alternative cost has no {X}, so X is 0 and not announced
    s = resolveAll(settle(s));
    expect(life(s, 'p1')).toBe(before - 1); // paid 1 life ({0}{R} on the stack is mana value 1), then gained 0
  });
  it('not during an opponent\'s turn', () => {
    const { s: s0, cub } = milled();
    let s = advanceTo(s0, 2, 'main1');
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1', 'priority for p1 on turn 2');
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === cub)).toBe(false);
  });
  it('a card exiled by another effect is not one of the cards exiled with ~ (CR 607.2a)', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Devourer'], hand: ['Test Purge'] }, p2: { graveyard: ['Test Giant'] }, defs: DEFS });
    const giant = find(s, 'Test Giant', 'graveyard', 'p2');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Purge', 'hand') }), { targets: [{ kind: 'object', id: giant }] }), { targets: [{ kind: 'object', id: giant }] });
    const exiled = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Giant');
    expect(exiled).toBeDefined();
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === exiled)).toBe(false);
  });
  it('without enough life the spell is not offered (CR 119.4, 118.3)', () => {
    const { s: s0, cub } = milled();
    const s = { ...s0, players: s0.players.map((p) => (p.id === 'p1' ? { ...p, life: 1 } : p)) } as GameState;
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === cub)).toBe(false);
    void pass;
  });
});
