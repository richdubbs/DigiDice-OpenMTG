/**
 * Commander concept lane turns-phases, round edh-d-71 (coordinator D): the behavior of what the round added, played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names, design 6.10). Each test has its negative case. CR cites are from memory (no rules/cr in cloud sessions) and listed as unverified in the record.
 *
 *   CR 503.1, 500.9      "At the beginning of enchanted player's first upkeep each turn, that player gets an additional upkeep step after this step." (the first upkeep, never an added one)
 *   CR 502.3, 500.9      "Whenever ~ becomes untapped during your untap step, you get an additional upkeep step after this step." (the added upkeep follows the upkeep the trigger resolves in)
 *   CR 701.3, 608.2c     "... sacrifice it and attach this Aura to a creature you control. If you do, untap all creatures you control and after this phase, there is an additional combat phase."
 *   CR 702.16e, 115.1, 615.12  "target opponent takes an extra turn after this one. Until your next turn, you and planeswalkers you control gain protection from that player."
 *   CR 118.12, 119.4, 101.4  "When you cast this spell, any player may pay half their life, rounded up. If a player does, counter ~." (each player in turn is offered the payment, also after one paid)
 *   CR 602.2b, 608.2h    "{4}{U}{U}, Exile this enchantment: Draw a card for each verse counter on this enchantment. If it had seven or more verse counters on it, take an extra turn after this one."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
    ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** Answers every decision other than priority and the combat declarations (first option, yes). */
function drive(s0: GameState, yes: boolean[] = [], targets: ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers' && s.pending.kind !== 'declareBlockers'; guard++) {
    const p = s.pending;
    let a: DecisionAnswer;
    if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'chooseTargets') a = { kind: 'chooseTargets', targets: targets.shift() ?? [] };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: p.options.slice(0, p.min) };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: yes.shift() ?? true };
    else if (p.kind === 'order') a = { kind: 'order', ids: p.items.map((x) => x.id) };
    else throw new Error(`unexpected decision ${p.kind}`);
    s = answer(s, a);
  }
  return s;
}
function resolveAll(s0: GameState, yes: boolean[] = [], targets: ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][] = []): GameState {
  let s = drive(s0, yes, targets);
  for (let i = 0; i < 16 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = drive(pass(pass(s)), yes, targets);
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['2', '3'] });

describe('CR 503.1, 500.9: "At the beginning of enchanted player\'s first upkeep each turn, that player gets an additional upkeep step after this step." (eff.edhd71.extraStep.upkeep.thatPlayerGets)', () => {
  const HAZE = card('Test Haze', 'Enchantment — Aura', "Enchant player\nAt the beginning of enchanted player's first upkeep each turn, that player gets an additional upkeep step after this step.", { colors: ['U'] });
  const cast = (): GameState => {
    const s0 = scenario([], { defs: [HAZE], p1: { hand: ['Test Haze'] } });
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Haze', 'hand', 'p1') } as never);
    const s2 = s1.pending?.kind === 'chooseTargets' ? answer(s1, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }) : s1;
    return resolveAll(s2.pending?.kind === 'payCost' ? answer(s2, { kind: 'payCost', auto: true }) : s2);
  };
  it('is automated', () => expect(full(HAZE)).toBe(true));
  it("the enchanted player's turn has two upkeep steps (the added one does not trigger a third); the Aura's controller's turn has one", () => {
    let s = cast();
    expect(s.objects[find(s, 'Test Haze', 'battlefield', 'p1')]!.attachedTo).toBe('p2');
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.turn.upkeeps).toBe(2);
    s = advanceTo(s, 3, 'main1');
    expect(s.turn.activePlayer).toBe('p1');
    expect(s.turn.upkeeps).toBe(1);
  });
});

describe('CR 502.3, 603.2, 500.9: "Whenever ~ becomes untapped during your untap step, you get an additional upkeep step after this step." (eff.edhd71.extraStep.upkeep.youGet)', () => {
  const DOC = card('Test Doctor', 'Creature — Time Lord', 'Haste\nWhenever ~ becomes untapped during your untap step, you get an additional upkeep step after this step.', { pt: ['3', '2'] });
  const UNTAPPER = card('Test Untapper', 'Sorcery', 'Untap target creature.');
  it('is automated', () => expect(full(DOC)).toBe(true));
  it('a tapped Doctor untaps in its controller\'s untap step: that turn has two upkeep steps, the added one after the upkeep the trigger resolved in', () => {
    const s0 = scenario([], { defs: [DOC], p1: { battlefield: [{ name: 'Test Doctor', tapped: true }] } });
    let s = advanceTo(s0, 2, 'main1'); // the opponent's turn: the Doctor stays tapped, one upkeep
    expect(s.turn.upkeeps).toBe(1);
    expect(s.objects[find(s, 'Test Doctor', 'battlefield', 'p1')]!.tapped).toBe(true);
    s = advanceTo(s, 3, 'main1');
    expect(s.objects[find(s, 'Test Doctor', 'battlefield', 'p1')]!.tapped).toBe(false);
    expect(s.turn.upkeeps).toBe(2);
  });
  it('negative: a Doctor that is already untapped has nothing to trigger; one untapped by a spell in a main phase does not trigger either', () => {
    const s0 = scenario([], { defs: [DOC, UNTAPPER], p1: { hand: ['Test Untapper'], battlefield: [{ name: 'Test Doctor', tapped: true }] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Untapper', 'hand', 'p1') } as never);
    s = s.pending?.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s0, 'Test Doctor', 'battlefield', 'p1') }] }) : s;
    s = resolveAll(s);
    expect(s.objects[find(s, 'Test Doctor', 'battlefield', 'p1')]!.tapped).toBe(false);
    s = advanceTo(s, 3, 'main1');
    expect(s.turn.upkeeps).toBe(1);
  });
});

describe("CR 502.3: the Doctor's trigger is for YOUR untap step only", () => {
  const DOC = card('Test Doctor', 'Creature — Time Lord', 'Haste\nWhenever ~ becomes untapped during your untap step, you get an additional upkeep step after this step.', { pt: ['3', '2'] });
  const MUSE = card('Test Muse', 'Creature — Elf', "Untap all permanents you control during each other player's untap step.", { pt: ['3', '3'] });
  it("negative: untapped in an opponent's untap step (a Seedborn Muse wording) it does not trigger", () => {
    expect(full(MUSE)).toBe(true);
    const s0 = scenario([], { defs: [DOC, MUSE], p1: { battlefield: [{ name: 'Test Doctor', tapped: true }, 'Test Muse'] } });
    const s = advanceTo(s0, 2, 'main1');
    expect(s.objects[find(s, 'Test Doctor', 'battlefield', 'p1')]!.tapped).toBe(false);
    expect(s.turn.upkeeps).toBe(1);
  });
});

describe('CR 701.3, 608.2c, 500.8: "When enchanted creature deals combat damage to a player, sacrifice it and attach this Aura to a creature you control. If you do, untap all creatures you control and after this phase, there is an additional combat phase."', () => {
  const FURY = card('Test Fury', 'Enchantment — Aura', 'Enchant creature you control\nWhen enchanted creature deals combat damage to a player, sacrifice it and attach this Aura to a creature you control. If you do, untap all creatures you control and after this phase, there is an additional combat phase.', { cost: '{2}{R}{R}', colors: ['R'] });
  /** Attack with every offered creature in every combat of turn 1; returns the state at the end of turn 1 and the candidates offered at each declaration. */
  const play = (others: string[]): { s: GameState; offered: ObjectId[][] } => {
    const s0 = scenario([], { defs: [FURY, BEAR, OX], p1: { battlefield: ['Test Bear', ...others] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const aura = put(s0, 'p1', 'battlefield', 'Test Fury'); // attached before any state-based action check (CR 704.5m)
    s0.objects[aura]!.attachedTo = bear;
    let s = s0;
    const offered: ObjectId[][] = [];
    for (let guard = 0; guard < 600 && s.turn.number === 1 && !s.result; guard++) {
      const d = s.pending;
      if (d?.kind === 'declareAttackers') {
        const c = d.candidates.map((x) => x.id);
        offered.push([...c].sort());
        s = answer(s, { kind: 'declareAttackers', attacks: (offered.length === 1 ? c : []).map((id) => ({ attacker: id, defender: 'p2' })) } as unknown as DecisionAnswer);
      } else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d?.kind === 'priority') s = s.zones.stack.length > 0 ? resolveAll(s) : pass(s);
      else if (d) s = drive(s);
      else break;
      if (offered.length === 2 || (offered.length === 1 && s.turn.step === 'main2')) break;
    }
    return { s, offered };
  };
  it('is automated', () => expect(full(FURY)).toBe(true));
  it('the enchanted creature is sacrificed, the Aura moves to the other creature, which untaps, and a second combat phase is offered (the other creature can attack again)', () => {
    const { s, offered } = play(['Test Ox']);
    const ox = find(s, 'Test Ox', 'battlefield', 'p1');
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(0);
    expect(s.objects[find(s, 'Test Fury', 'battlefield', 'p1')]!.attachedTo).toBe(ox);
    expect(offered).toHaveLength(2);
    expect(offered[1]).toEqual([ox]);
  });
  it('negative: with no other creature there is nothing to attach to, so no creature untaps and there is no additional combat phase; the Aura goes to the graveyard', () => {
    const { s, offered } = play([]);
    expect(offered).toHaveLength(1);
    expect(findAll(s, 'Test Fury', 'graveyard', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 602.2b, 608.2h, 122.1, 500.7: "{4}{U}{U}, Exile this enchantment: Draw a card for each verse counter on this enchantment. If it had seven or more verse counters on it, take an extra turn after this one." (as it last existed)', () => {
  const CALLING = card('Test Calling', 'Enchantment', 'Whenever you scry, put a verse counter on this enchantment.\n{4}{U}{U}, Exile this enchantment: Draw a card for each verse counter on this enchantment. If it had seven or more verse counters on it, take an extra turn after this one. Activate only as a sorcery.', { cost: '{1}{U}', colors: ['U'] });
  const run = (verses: number): GameState => {
    const s0 = scenario(['Island'], { defs: [CALLING], p1: { battlefield: [{ name: 'Test Calling', counters: { verse: verses } }, ...Array(6).fill('Island')] } });
    const src = find(s0, 'Test Calling', 'battlefield', 'p1');
    return resolveAll(act(s0, { type: 'activate', player: 'p1', source: src, ability: 'p:0:1' } as never));
  };
  const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
  it('is automated', () => expect(full(CALLING)).toBe(true));
  it('seven counters: seven cards drawn (the counters it had), and an extra turn is taken', () => {
    const s0 = scenario(['Island'], { defs: [CALLING], p1: { battlefield: [{ name: 'Test Calling', counters: { verse: 7 } }, ...Array(6).fill('Island')] } });
    const before = hand(s0, 'p1');
    const s = run(7);
    expect(hand(s, 'p1') - before).toBe(7);
    expect(s.turn.extraTurns).toEqual(['p1']);
    expect(findAll(s, 'Test Calling', 'exile', 'p1')).toHaveLength(1);
  });
  it('negative: six counters: six cards drawn and no extra turn', () => {
    const s0 = scenario(['Island'], { defs: [CALLING], p1: { battlefield: [{ name: 'Test Calling', counters: { verse: 6 } }, ...Array(6).fill('Island')] } });
    const before = hand(s0, 'p1');
    const s = run(6);
    expect(hand(s, 'p1') - before).toBe(6);
    expect(s.turn.extraTurns).toEqual([]);
  });
});

describe('CR 118.12, 119.4, 101.4, 603.3: "When you cast this spell, any player may pay half their life, rounded up. If a player does, counter ~." (eff.edhd71.anyPlayerMay.payHalfLife)', () => {
  const EXTORT = card('Test Extortion', 'Sorcery', 'When you cast this spell, any player may pay half their life, rounded up. If a player does, counter Test Extortion.\nTake an extra turn after this one.', { cost: '{B}{B}{B}{B}', colors: ['B'] });
  const cast = (yes: boolean[], lives?: [number, number]): GameState => {
    const s0 = scenario(['Swamp'], { defs: [EXTORT], p1: { hand: ['Test Extortion'], battlefield: Array(4).fill('Swamp') } });
    if (lives) { s0.players[0]!.life = lives[0]; s0.players[1]!.life = lives[1]; }
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Extortion', 'hand', 'p1') } as never);
    return resolveAll(s1, yes);
  };
  const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
  it('is automated', () => expect(full(EXTORT)).toBe(true));
  it('nobody pays: the spell resolves and an extra turn is taken', () => {
    const s = cast([false, false]);
    expect(s.turn.extraTurns).toEqual(['p1']);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it("an opponent pays half their life rounded up (7 -> 4): the spell is countered, no extra turn; the caster, offered first, declined", () => {
    const s = cast([false, true], [20, 7]);
    expect(s.turn.extraTurns).toEqual([]);
    expect(lifeOf(s, 'p2')).toBe(3);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(findAll(s, 'Test Extortion', 'graveyard', 'p1')).toHaveLength(1);
  });
  it('the other players still get the option after one paid: both pay, the spell is countered once', () => {
    const s = cast([true, true], [20, 20]);
    expect(lifeOf(s, 'p1')).toBe(10);
    expect(lifeOf(s, 'p2')).toBe(10);
    expect(s.turn.extraTurns).toEqual([]);
  });
});

describe('CR 702.16e, 115.1, 303.4, 615.12, 500.7: "...target opponent takes an extra turn after this one. Until your next turn, you and planeswalkers you control gain protection from that player." (eff.edhd71.youAndWalkers.protectionFromPlayer)', () => {
  const FROLIC = card('Test Frolicker', 'Creature — Otter', 'Flying\nWhen this creature enters, if you cast it, target opponent takes an extra turn after this one. Until your next turn, you and planeswalkers you control gain protection from that player.', { pt: ['2', '2'] });
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Test', '', { loyalty: '4' });
  const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.');
  const FLAME = card('Test Flame', 'Instant', 'Test Flame deals 2 damage to each player.');
  const SWEEP = card('Test Sweep', 'Instant', 'Test Sweep deals 2 damage to each planeswalker.');
  const DEFS = [FROLIC, WALKER, BOLT, FLAME, SWEEP, BEAR];
  /** p1 casts the Frolicker (its trigger targets the only opponent); p2's extra turn begins; returns the state at the start of that turn's first main phase. */
  const extra = (): GameState => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Frolicker'], battlefield: ['Test Bear', { name: 'Test Walker', counters: { loyalty: 4 } }] }, p2: { hand: ['Test Bolt', 'Test Flame', 'Test Sweep'] } });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Frolicker', 'hand', 'p1') } as never), [], [[{ kind: 'player', id: 'p2' }]]);
    expect(s.turn.extraTurns).toEqual(['p2']);
    s = advanceTo(s, 2, 'main1');
    expect(s.turn.activePlayer).toBe('p2');
    return s;
  };
  it('is automated', () => expect(full(FROLIC)).toBe(true));
  it("during the opponent's extra turn the opponent's spells can't target you or your planeswalker, but can target your other permanents", () => {
    const s = extra();
    const walker = find(s, 'Test Walker', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const tryTarget = (t: { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId }): boolean => {
      const c = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Bolt', 'hand', 'p2') } as never);
      if (c.pending?.kind !== 'chooseTargets') return false;
      const legal = JSON.stringify((c.pending as unknown as { groups?: unknown; options?: unknown }));
      return legal.includes(t.kind === 'player' ? `"${t.id}"` : `"${t.id}"`);
    };
    expect(tryTarget({ kind: 'player', id: 'p1' })).toBe(false);
    expect(tryTarget({ kind: 'object', id: walker })).toBe(false);
    expect(tryTarget({ kind: 'object', id: bear })).toBe(true);
    expect(tryTarget({ kind: 'player', id: 'p2' })).toBe(true);
  });
  it('damage from sources the opponent controls is prevented for you and your planeswalker (an untargeted spell): you lose nothing, the opponent loses 2', () => {
    let s = extra();
    s = resolveAll(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Flame', 'hand', 'p2') } as never));
    expect(s.players.find((x) => x.id === 'p1')!.life).toBe(20);
    expect(s.players.find((x) => x.id === 'p2')!.life).toBe(18);
  });
  it("damage the opponent's untargeted spell deals to a planeswalker you control is prevented too", () => {
    let s = extra();
    s = resolveAll(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Sweep', 'hand', 'p2') } as never));
    expect(s.objects[find(s, 'Test Walker', 'battlefield', 'p1')]!.counters['loyalty']).toBe(4);
  });
  it('control: without the protection the same spell does put 2 damage on the planeswalker (loyalty 4 -> 2)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 4 } }] }, p2: { hand: ['Test Sweep'] } });
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Sweep', 'hand', 'p2') } as never));
    expect(s.objects[find(s, 'Test Walker', 'battlefield', 'p1')]!.counters['loyalty']).toBe(2);
  });
  it('negative: it lasts until your next turn: once your turn begins the opponent can target you again', () => {
    let s = extra();
    s = advanceTo(s, 3, 'main1'); // the opponent's regular turn after its extra turn: the protection lasts through it too
    expect(s.turn.activePlayer).toBe('p2');
    expect(JSON.stringify(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Bolt', 'hand', 'p2') } as never).pending)).not.toContain('"p1"');
    s = advanceTo(s, 4, 'upkeep');
    expect(s.turn.activePlayer).toBe('p1');
    s = pass(s); // p1 passes in its upkeep; p2 has priority
    const c = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Bolt', 'hand', 'p2') } as never);
    expect(c.pending?.kind).toBe('chooseTargets');
    expect(JSON.stringify(c.pending)).toContain('"p1"');
  });
});
