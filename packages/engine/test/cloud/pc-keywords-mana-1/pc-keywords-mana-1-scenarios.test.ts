/**
 * pc-keywords-mana-1 (precon lane keywords-mana): the round's capabilities played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks. CR cites written from memory in a cloud session (no rules/cr/): unverified.
 *
 *   CR 702.96a-b   overload: cast for its overload cost the spell has no targets and says "each" where it said "target"
 *   CR 702.96a     the spell cast for its mana cost is unchanged: one chosen target
 *   CR 702.96b     an overloaded spell is not targeted: hexproof does not stop it
 *   CR 702.96a     "target player" becomes "each player"
 *   CR 702.96a     "counter target spell you don't control" becomes "counter each spell you don't control"
 *   fail closed    a spell whose "target" is used as a value (a quantity) is not offered for overload
 *   CR 111.10t     Junk token: {T}, sacrifice it, exile the top card of your library, play it this turn, sorcery speed only
 *   CR 106.6, 205.2a  "Spend this mana only to cast instant, sorcery, Demon, and Spirit spells": a list of card types and subtypes
 *   CR 122.1, 605.1a  "Add {U} for each counter on ~": every kind of counter on the source, counted as the mana is added
 *   CR 106.1, 122.1   "Choose a color. Add one mana of that color for each charge counter on ~": the counters of that kind only
 *   CR 205.3i, 608.2c "If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead": a land of each description, both needed
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { overloadProgram } from '../../../src/effects/overload';
import { act, cast, drive, find, lands, next, pass, resolveAll, scenario, target } from '../../m6/dfc/support';
import { activate } from '../../m5/cr-examples/helpers';
import { labels, legal, put } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string | null; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost === null ? '' : o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d);
const tapped = (s: GameState, id: string): boolean => s.objects[id]!.tapped === true;
const castOverload = (s: GameState, name: string, answers: DecisionAnswer[] = []): GameState =>
  drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1'), method: 'overload' }), answers);

describe('CR 702.96a-b: overload turns "target" into "each" and the spell is not targeted', () => {
  const FREEZE = card('Test Mass Freeze', 'Instant', "Tap target creature you don't control.\nOverload {1}{U}", { cost: '{U}' });
  const BEAR = card('Test Hexproof Bear', 'Creature — Bear', 'Hexproof', { pt: ['2', '2'], cost: '{1}{G}' });
  const board = (): GameState => scenario(['Island', 'Grizzly Bears', 'Hill Giant'], {
    defs: [FREEZE, BEAR],
    p1: { hand: ['Test Mass Freeze'], battlefield: [...lands('Island', 3), 'Grizzly Bears'] },
    p2: { battlefield: ['Hill Giant', 'Test Hexproof Bear', 'Grizzly Bears'] },
  });
  it('the keyword is understood: the card compiles full', () => {
    expect(full(FREEZE)).toBe(true);
  });
  it('cast for its mana cost, one chosen target is tapped and nothing else', () => {
    const s0 = board();
    const giant = find(s0, 'Hill Giant', 'battlefield', 'p2');
    const s = resolveAll(cast(s0, 'Test Mass Freeze', [target(giant)]));
    expect(tapped(s, giant)).toBe(true);
    expect(tapped(s, find(s, 'Test Hexproof Bear', 'battlefield', 'p2'))).toBe(false);
    expect(tapped(s, find(s, 'Grizzly Bears', 'battlefield', 'p1'))).toBe(false);
  });
  it('cast for its overload cost, no target is asked and every creature you do not control is tapped, hexproof or not; yours is not', () => {
    const s0 = board();
    const s1 = castOverload(s0, 'Test Mass Freeze');
    expect(s1.pending?.kind).not.toBe('chooseTargets');
    expect(s1.zones.stack.length).toBe(1);
    expect(s1.objects[s1.zones.stack[0]!]!.stack!.targets.flat()).toEqual([]);
    const s = resolveAll(s1);
    expect(tapped(s, find(s, 'Hill Giant', 'battlefield', 'p2'))).toBe(true);
    expect(tapped(s, find(s, 'Test Hexproof Bear', 'battlefield', 'p2'))).toBe(true);
    expect(tapped(s, find(s, 'Grizzly Bears', 'battlefield', 'p2'))).toBe(true);
    expect(tapped(s, find(s, 'Grizzly Bears', 'battlefield', 'p1'))).toBe(false);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped === true && s.objects[id]!.controller === 'p2').length).toBe(3);
  });
  it('the overload cost is paid instead of the mana cost: with only one land it is refused', () => {
    const s0 = scenario(['Island', 'Grizzly Bears'], { defs: [FREEZE], p1: { hand: ['Test Mass Freeze'], battlefield: ['Island'] }, p2: { battlefield: ['Grizzly Bears'] } });
    expect(applyAction(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mass Freeze', 'hand', 'p1'), method: 'overload' }).error).toBeDefined();
  });
});

describe('CR 702.96a: "target player" becomes "each player"; a damage spell hits each creature you do not control', () => {
  const RAKE = card('Test Mind Sweep', 'Sorcery', 'Target player discards a card.\nOverload {1}{B}', { cost: '{B}' });
  const ZAP = card('Test Zap Sweep', 'Instant', "Test Zap Sweep deals 1 damage to target creature you don't control.\nOverload {1}{R}", { cost: '{R}' });
  it('every player discards (the caster too), not only one', () => {
    expect(full(RAKE)).toBe(true);
    const s0 = scenario(['Swamp', 'Island'], { defs: [RAKE], p1: { hand: ['Test Mind Sweep', 'Island'], battlefield: lands('Swamp', 2) }, p2: { hand: ['Island', 'Island'] } });
    let s = castOverload(s0, 'Test Mind Sweep');
    for (let i = 0; i < 40 && !(s.pending?.kind === 'priority' && s.zones.stack.length === 0 && i > 0); i++) {
      if (s.pending?.kind === 'chooseObjects') { s = drive(s, [{ kind: 'chooseObjects', ids: [s.zones.hand[s.pending.player as 'p1' | 'p2']![0]!] } as DecisionAnswer]); }
      else s = pass(s);
    }
    expect(s.zones.hand.p1!.length).toBe(0);
    expect(s.zones.hand.p2!.length).toBe(1);
  });
  it('each creature you do not control is damaged; with no overload one creature only', () => {
    expect(full(ZAP)).toBe(true);
    const mk = (): GameState => scenario(['Mountain', 'Grizzly Bears', 'Hill Giant'], { defs: [ZAP], p1: { hand: ['Test Zap Sweep'], battlefield: [...lands('Mountain', 2), 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant', 'Grizzly Bears'] } });
    const s0 = mk();
    const dmg = (s: GameState, id: string): number => s.objects[id]!.damage ?? 0;
    const s = resolveAll(castOverload(s0, 'Test Zap Sweep'));
    expect(dmg(s, find(s, 'Hill Giant', 'battlefield', 'p2'))).toBe(1);
    expect(dmg(s, find(s, 'Grizzly Bears', 'battlefield', 'p2'))).toBe(1);
    expect(dmg(s, find(s, 'Grizzly Bears', 'battlefield', 'p1'))).toBe(0);
    const giant = find(s0, 'Hill Giant', 'battlefield', 'p2');
    const t = resolveAll(cast(s0, 'Test Zap Sweep', [target(giant)]));
    expect(dmg(t, giant)).toBe(1);
    expect(dmg(t, find(t, 'Grizzly Bears', 'battlefield', 'p2'))).toBe(0);
  });
});

describe('CR 702.96a: "counter target spell you don\'t control" becomes "counter each spell you don\'t control"', () => {
  const SWEEP = card('Test Spell Sweep', 'Instant', "Counter target spell you don't control.\nOverload {1}{U}", { cost: '{U}' });
  const ZAP1 = card('Test Opp Zap', 'Instant', 'Test Opp Zap deals 1 damage to each opponent.', { cost: '{0}' });
  const ZAP2 = card('Test Opp Bolt', 'Instant', 'Test Opp Bolt deals 2 damage to each opponent.', { cost: '{0}' });
  it('both spells of the opponent are countered and the caster\'s own spell is not', () => {
    expect(full(SWEEP)).toBe(true);
    let s = scenario(['Island'], { defs: [SWEEP, ZAP1, ZAP2], p1: { hand: ['Test Spell Sweep'], battlefield: lands('Island', 3) }, p2: { hand: ['Test Opp Zap', 'Test Opp Bolt'] } });
    // the opponent puts two spells on the stack while the caster passes priority back and forth
    s = pass(s);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Opp Zap', 'hand', 'p2') }), []);
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Opp Bolt', 'hand', 'p2') }), []);
    expect(s.zones.stack.length).toBe(2);
    s = pass(s);
    const r = applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spell Sweep', 'hand', 'p1'), method: 'overload' });
    expect(r.error).toBeUndefined();
    s = resolveAll(drive(r.state));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(20);
    expect(s.zones.graveyard.p2!.length).toBe(2);
  });
});

describe('fail closed: a manual spell or a granted ability with a target is not offered for overload', () => {
  it('a spell with a manual line, and a spell granting an ability that has its own target, are refused for overload', () => {
    const MANUAL = card('Test Odd Tap', 'Instant', "Tap target creature you don't control. Frobnicate the zork.\nOverload {1}{U}", { cost: '{U}' });
    const GRANT = card('Test Grant Ping', 'Instant', 'Target creature you control gains "{T}: This creature deals 1 damage to target creature." until end of turn.\nOverload {3}{U}', { cost: '{U}' });
    for (const d of [MANUAL, GRANT]) {
      const s = scenario(['Island', 'Grizzly Bears'], { defs: [d], p1: { hand: [d.name], battlefield: [...lands('Island', 5), 'Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] } });
      expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, d.name, 'hand', 'p1'), method: 'overload' }).error, d.name).toBeDefined();
    }
  });
});

describe('fail closed: a "target" read as a value is not rewritten', () => {
  it('overloadProgram answers null for a program that uses a target in a quantity, a count, or a counted-up spec; and rewrites a plain one', () => {
    const plain = { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } }], steps: [{ op: 'tap', what: { ref: 'target', id: 't0' } }] };
    const out = overloadProgram(plain as never);
    expect(out).not.toBeNull();
    expect(out!.targets).toEqual([]);
    expect(JSON.stringify(out!.steps)).toContain('"ref":"each"');
    expect(JSON.stringify(out!.steps)).not.toContain('"ref":"target"');
    const asValue = { ...plain, steps: [{ op: 'damage', amount: { q: 'stat', stat: 'power', of: { ref: 'target', id: 't0' } }, to: { ref: 'you' } }] };
    expect(overloadProgram(asValue as never)).toBeNull();
    const upTo = { ...plain, targets: [{ ...plain.targets[0]!, min: 0, max: 2 }] };
    expect(overloadProgram(upTo as never)).toBeNull();
    const divided = { ...plain, targets: [{ ...plain.targets[0]!, divide: { what: 'damage', total: 3 } }] };
    expect(overloadProgram(divided as never)).toBeNull();
    const anyTarget = { ...plain, targets: [{ id: 't0', kind: 'anyTarget', min: 1, max: 1, text: 'any target' }] };
    expect(overloadProgram(anyTarget as never)).toBeNull();
    const counterNotOwn = { targets: [{ id: 't0', kind: 'spell', min: 1, max: 1, text: 'target spell' }], steps: [{ op: 'counter', what: { ref: 'target', id: 't0' } }] };
    expect(overloadProgram(counterNotOwn as never)).toBeNull();
  });
});

const pool = (s: GameState): string => JSON.stringify(s.players.find((x) => x.id === 'p1')!.manaPool.map((u) => u.type).sort());
const tapMana = (s: GameState, id: string, answers: DecisionAnswer[] = []): GameState => {
  const la = legal(s, 'p1', 'activate').find((a) => a.isMana && a.object === id);
  expect(la, 'the mana ability is offered').toBeDefined();
  return drive(act(s, la!.action), answers);
};

describe('CR 111.10t: the Junk token', () => {
  const HEAP = card('Test Scrap Heap', 'Sorcery', 'Create a Junk token.', { cost: '{0}' });
  const board = (): GameState => scenario(['Forest'], { defs: [HEAP], p1: { hand: ['Test Scrap Heap'], library: Array(25).fill('Forest') as string[] }, p2: {} });
  it('the card that creates it is full, and the token is a Junk artifact', () => {
    expect(full(HEAP)).toBe(true);
    const s = resolveAll(cast(board(), 'Test Scrap Heap'));
    const junk = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Junk Token');
    expect(junk).toBeDefined();
  });
  it('tapped and sacrificed at sorcery speed, it exiles the top card of your library and that card can be played this turn, not the turn after', () => {
    let s = resolveAll(cast(board(), 'Test Scrap Heap'));
    const junk = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Junk Token')!;
    s = tweak(s, (x) => { x.objects[junk]!.controlledSinceTurn = 0; }); // not summoning sick for the {T} cost (artifact: only creatures are)
    const libBefore = s.zones.library.p1!.length;
    s = resolveAll(activate(s, junk));
    expect(s.zones.battlefield).not.toContain(junk); // sacrificed
    expect(s.zones.library.p1!.length).toBe(libBefore - 1);
    const exiled = s.zones.exile.find((id) => s.objects[id]!.owner === 'p1');
    expect(exiled).toBeDefined();
    expect(legal(s, 'p1', 'playLand').some((a) => a.object === exiled)).toBe(true); // may play that card this turn
    let later = s;
    for (let i = 0; i < 600 && !(later.turn.number === 3 && later.turn.step === 'main1' && later.pending?.kind === 'priority' && later.pending.player === 'p1'); i++) {
      later = later.pending && later.pending.kind !== 'priority' && later.pending.kind !== 'declareAttackers' && later.pending.kind !== 'declareBlockers' ? drive(later) : next(later);
    }
    expect(later.turn.number).toBe(3);
    expect(later.zones.exile).toContain(exiled);
    expect(legal(later, 'p1', 'playLand').some((a) => a.object === exiled)).toBe(false); // "this turn" is over
  });
  it('not at instant speed: with a spell on the stack the activation is not offered (Activate only as a sorcery)', () => {
    const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.', { cost: '{0}' });
    const s0 = resolveAll(cast(scenario(['Forest'], { defs: [HEAP, SPARK], p1: { hand: ['Test Scrap Heap', 'Test Spark'], library: Array(25).fill('Forest') as string[] } }), 'Test Scrap Heap'));
    const junk = s0.zones.battlefield.find((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Junk Token')!;
    expect(legal(s0, 'p1', 'activate').some((a) => !a.isMana && a.object === junk)).toBe(true);
    const s1 = cast(s0, 'Test Spark');
    expect(s1.zones.stack.length).toBe(1);
    expect(legal(s1, 'p1', 'activate').some((a) => !a.isMana && a.object === junk)).toBe(false);
  });
});

describe('CR 106.6, 205.2a: "Spend this mana only to cast instant, sorcery, Demon, and Spirit spells"', () => {
  const FONT = card('Test Soul Font', 'Land', '{T}: Add {C}. Spend this mana only to cast instant, sorcery, Demon, and Spirit spells.', { cost: null });
  const DEMON = card('Test Pit Demon', 'Creature — Demon', '', { pt: ['2', '2'], cost: '{1}' });
  const SPIRIT = card('Test Wisp Spirit', 'Creature — Spirit', '', { pt: ['1', '1'], cost: '{1}' });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}' });
  const SPELL = card('Test Quick Zap', 'Instant', 'You gain 1 life.', { cost: '{1}' });
  const CHARM = card('Test Idle Charm', 'Artifact', '', { cost: '{1}' });
  it('compiles into one restriction (card types and subtypes), never manual', () => {
    expect(full(FONT)).toBe(true);
    const step = (FONT.faces[0]!.abilities[0] as unknown as { effect: { steps: { restriction?: unknown }[] } }).effect.steps.find((x) => x.restriction)!;
    expect(step.restriction).toEqual({ spells: { anyOf: [{ types: ['Instant', 'Sorcery'] }, { subtypes: ['Demon', 'Spirit'] }] } });
  });
  it('pays for an instant, a Demon spell and a Spirit spell, not for a Bear or a non-Spirit artifact', () => {
    const s = scenario([], { defs: [FONT, DEMON, SPIRIT, BEAR, SPELL, CHARM], p1: { hand: ['Test Quick Zap', 'Test Pit Demon', 'Test Wisp Spirit', 'Test Plain Bear', 'Test Idle Charm'], battlefield: ['Test Soul Font', 'Test Soul Font', 'Test Soul Font', 'Test Soul Font', 'Test Soul Font'] } });
    const l = labels(s, 'p1');
    for (const n of ['Test Quick Zap', 'Test Pit Demon', 'Test Wisp Spirit']) expect(l, n).toContain(`Cast ${n}`);
    for (const n of ['Test Plain Bear', 'Test Idle Charm']) expect(l, n).not.toContain(`Cast ${n}`);
  });
});

describe('CR 122.1, 605.1a: "Add {U} for each counter on ~"', () => {
  const BOT = card('Test Tin Helper', 'Artifact Creature — Robot', '{T}: Add {U} for each counter on ~.', { pt: ['1', '1'], cost: '{0}' });
  it('adds one mana for every counter of every kind on it, counted as the mana is added', () => {
    expect(full(BOT)).toBe(true);
    const s0 = scenario([], { defs: [BOT], p1: { battlefield: [{ name: 'Test Tin Helper', counters: { time: 2, '+1/+1': 1 } }] } });
    const s = tapMana(s0, find(s0, 'Test Tin Helper', 'battlefield', 'p1'));
    expect(pool(s)).toBe(JSON.stringify(['U', 'U', 'U']));
  });
  it('with no counters it adds nothing', () => {
    const s0 = scenario([], { defs: [BOT], p1: { battlefield: ['Test Tin Helper'] } });
    const s = tapMana(s0, find(s0, 'Test Tin Helper', 'battlefield', 'p1'));
    expect(pool(s)).toBe('[]');
  });
});

describe('CR 106.1, 122.1: "Choose a color. Add one mana of that color for each charge counter on ~"', () => {
  const HORN = card('Test Charge Horn', 'Artifact', '{T}: Choose a color. Add one mana of that color for each charge counter on ~.', { cost: '{0}' });
  it('adds that many mana of the chosen color, counting only charge counters', () => {
    expect(full(HORN)).toBe(true);
    const s0 = scenario([], { defs: [HORN], p1: { battlefield: [{ name: 'Test Charge Horn', counters: { charge: 3, time: 2 } }] } });
    const s = tapMana(s0, find(s0, 'Test Charge Horn', 'battlefield', 'p1'), [{ kind: 'chooseColor', color: 'G' } as DecisionAnswer]);
    expect(pool(s)).toBe(JSON.stringify(['G', 'G', 'G']));
  });
});

describe('CR 205.3i, 608.2c: "If you control an Urza\'s Power-Plant and an Urza\'s Tower, add {C}{C} instead"', () => {
  const MINE = card('Test Mine', 'Land — Urza\'s Mine', "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead.", { cost: null });
  const TOWER = card('Test Tower', 'Land — Urza\'s Tower', '{T}: Add {C}.', { cost: null });
  const PLANT = card('Test Plant', 'Land — Urza\'s Power-Plant', '{T}: Add {C}.', { cost: null });
  const run = (others: string[]): string => {
    const s0 = scenario([], { defs: [MINE, TOWER, PLANT], p1: { battlefield: ['Test Mine', ...others] } });
    return pool(tapMana(s0, find(s0, 'Test Mine', 'battlefield', 'p1')));
  };
  it('compiles full', () => expect(full(MINE)).toBe(true));
  it('with a Power-Plant and a Tower the land adds two, with only one of them, or two Towers, one', () => {
    expect(run(['Test Plant', 'Test Tower'])).toBe(JSON.stringify(['C', 'C']));
    expect(run([])).toBe(JSON.stringify(['C']));
    expect(run(['Test Tower'])).toBe(JSON.stringify(['C']));
    expect(run(['Test Tower', 'Test Tower'])).toBe(JSON.stringify(['C']));
  });
});
