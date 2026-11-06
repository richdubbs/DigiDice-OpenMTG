/**
 * Commander lane edh-replace, round edh-replace-2: the "instead" folds of the round, played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Each test is named after the rule it checks and has its negative case. CR cites from memory, unverified where marked
 * (rules/cr/ is not in the cloud checkout).
 *
 *   CR 614.15, 608.2c   "Scry 1. If this is the second time this ability has resolved this turn, draw a card instead."  (one instruction of you by another one)
 *   CR 614.15, 608.2c   "Each opponent sacrifices a creature of their choice. If C, instead each opponent sacrifices half the creatures they control, rounded up."
 *   CR 614.15, 608.2c   "You may put a land card from your hand onto the battlefield tapped. If C, instead you may put a creature or land card ..."
 *   CR 614.15, 118.12a  "Each opponent loses 3 life unless they discard a card. If C, instead each opponent loses 6 life unless they discard two cards."
 *   CR 614.15, 608.2c   "You may pay {G/W}. If you do, put a +1/+1 counter on it. If it's a Unicorn, put two +1/+1 counters on it instead."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, ptNumbers, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { legalActions } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** The decisions that came up while driving, in order (kind), so a test can say which choice the player was asked. */
interface Run { s: GameState; asked: string[] }
/** Answer decisions until priority: yes to every "may"/"pay", payments automatic, object choices from `objects` in order else the first allowed (at least `min`). */
function drive(s0: GameState, o: { objects?: ObjectId[][]; yes?: boolean } = {}): Run {
  let s = s0;
  const asked: string[] = [];
  const objects = o.objects ?? [];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    asked.push(`${p.player}:${p.kind}`);
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: objects.shift() ?? p.options.slice(0, Math.max(1, p.min)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return { s, asked };
}
/** Resolve the stack: pass until it is empty. */
function resolveAll(s0: GameState, o: { objects?: ObjectId[][]; yes?: boolean } = {}): Run {
  let r: Run = { s: s0, asked: [] };
  for (let i = 0; i < 20 && r.s.zones.stack.length > 0; i++) {
    const n = drive(pass(pass(r.s)), o);
    r = { s: n.s, asked: [...r.asked, ...n.asked] };
  }
  return r;
}
/** p1 casts the named card from hand (free) and everything resolves. */
function cast(s0: GameState, name: string, o: { objects?: ObjectId[][]; yes?: boolean } = {}): Run {
  const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  const d = drive(s1, o);
  const r = resolveAll(d.s, o);
  return { s: r.s, asked: [...d.asked, ...r.asked] };
}
const handSize = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;
const IMP = (n: number): CardDef => card(`Test Imp ${n}`, 'Creature — Imp', '', { pt: ['1', '1'] });

describe('CR 614.15, 608.2c: "Scry 1. If this is the second time this ability has resolved this turn, draw a card instead." (one instruction of you replaced by another of you)', () => {
  const GATHERER = card('Test Gossip Elf', 'Creature — Elf', 'Whenever another creature you control enters, scry 1. If this is the second time this ability has resolved this turn, draw a card instead.', { pt: ['1', '1'] });
  const defs = [GATHERER, IMP(1), IMP(2), IMP(3)];
  const setup = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Gossip Elf'], hand: ['Test Imp 1', 'Test Imp 2', 'Test Imp 3'] } });
  it('is automated', () => expect(full(GATHERER)).toBe(true));
  it('the first resolution scries (you look at the top card, nothing is drawn); the second draws a card and scries not; the third scries again', () => {
    const s0 = setup();
    const a = cast(s0, 'Test Imp 1');
    expect(handSize(a.s, 'p1')).toBe(2);
    expect(a.asked.length, a.asked.join()).toBeGreaterThan(0); // the scry decision
    const b = cast(a.s, 'Test Imp 2');
    expect(handSize(b.s, 'p1')).toBe(2 - 1 + 1); // one Imp cast, one card drawn
    expect(b.asked, b.asked.join()).toEqual([]); // no scry decision: the draw replaced the scry
    const c = cast(b.s, 'Test Imp 3');
    expect(handSize(c.s, 'p1')).toBe(handSize(b.s, 'p1') - 1); // third time: scry again, no draw
    expect(c.asked.length, c.asked.join()).toBeGreaterThan(0);
  });
});

describe('CR 614.15, 608.2c: "Each opponent sacrifices a creature of their choice. If C, instead each opponent sacrifices half the creatures they control of their choice, rounded up."', () => {
  const HUNGER = card('Test Famine Rite', 'Instant', "Each opponent sacrifices a creature of their choice. If you control three or more creatures, instead each opponent sacrifices half the creatures they control of their choice, rounded up.");
  const defs = [HUNGER, IMP(1), IMP(2), IMP(3), IMP(4), IMP(5)];
  const mine = (n: number): string[] => ['Test Imp 1', 'Test Imp 2', 'Test Imp 3', 'Test Imp 4', 'Test Imp 5'].slice(0, n);
  const run = (myCreatures: number, theirs: number): GameState => cast(scenario([], { defs, p1: { hand: ['Test Famine Rite'], battlefield: mine(myCreatures) }, p2: { battlefield: mine(theirs).map((n) => ({ name: n })) } }), 'Test Famine Rite').s;
  const theirCount = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').length;
  it('is automated', () => expect(full(HUNGER)).toBe(true));
  it('with the condition false each opponent sacrifices exactly one creature', () => {
    expect(theirCount(run(2, 5))).toBe(4);
  });
  it('with the condition true each opponent sacrifices half of what they control, rounded up (5 -> 2 left; 4 -> 2 left), and the caster loses nothing', () => {
    const s5 = run(3, 5);
    expect(theirCount(s5)).toBe(2);
    expect(s5.zones.battlefield.filter((id) => s5.objects[id]!.controller === 'p1').length).toBe(3);
    expect(theirCount(run(3, 4))).toBe(2);
    expect(theirCount(run(3, 0))).toBe(0);
  });
});

describe('CR 614.15, 118.12a: "Each opponent loses 3 life unless they discard a card. If C, instead each opponent loses 6 life unless they discard two cards."', () => {
  const COURT = card('Test Greed Court', 'Sorcery', 'Each opponent loses 3 life unless they discard a card. If you control three or more creatures, instead each opponent loses 6 life unless they discard two cards.');
  const defs = [COURT, IMP(1), IMP(2), IMP(3), IMP(4), IMP(5)];
  const play = (myCreatures: number, pays: boolean): GameState =>
    cast(scenario([], { defs, p1: { hand: ['Test Greed Court'], battlefield: ['Test Imp 1', 'Test Imp 2', 'Test Imp 3', 'Test Imp 4', 'Test Imp 5'].slice(0, myCreatures) }, p2: { hand: ['Test Imp 4', 'Test Imp 5', 'Test Imp 1'] } }), 'Test Greed Court', { yes: pays }).s;
  it('is automated except the experimental template cap (the step itself is not manual)', () => expect(JSON.stringify(COURT.faces)).not.toContain('"op":"manual"'));
  it('the condition false: the opponent who does not discard loses 3; the one who discards a card keeps their life', () => {
    expect(life(play(2, false), 'p2')).toBe(20 - 3);
    const paid = play(2, true);
    expect(life(paid, 'p2')).toBe(20);
    expect(handSize(paid, 'p2')).toBe(2);
  });
  it('the condition true: the opponent who does not discard loses 6; the one who pays discards TWO cards and keeps their life', () => {
    expect(life(play(3, false), 'p2')).toBe(20 - 6);
    const paid = play(3, true);
    expect(life(paid, 'p2')).toBe(20);
    expect(handSize(paid, 'p2')).toBe(1);
  });
});

describe('CR 614.15, 608.2c: "You may put a land card from your hand onto the battlefield tapped. If C, instead you may put a creature or land card from your hand onto the battlefield tapped."', () => {
  const COMPOSER = card('Test Spring Bard', 'Creature — Satyr', 'Whenever another creature you control enters, you may put a land card from your hand onto the battlefield tapped. If you control three or more creatures, instead you may put a creature or land card from your hand onto the battlefield tapped.', { pt: ['1', '1'] });
  const defs = [COMPOSER, IMP(1), IMP(2), IMP(3), IMP(4)];
  const play = (myCreatures: string[]): GameState =>
    cast(scenario([], { defs, p1: { hand: ['Test Imp 1', 'Test Imp 4', 'Plains'], battlefield: ['Test Spring Bard', ...myCreatures] } }), 'Test Imp 1').s;
  const onField = (s: GameState, name: string): number => findAll(s, name, 'battlefield', 'p1').length;
  it('is automated', () => expect(full(COMPOSER)).toBe(true));
  it('the condition false: only a land can be put (the Imp stays in hand, the Plains enters tapped)', () => {
    const s = play([]);
    expect(onField(s, 'Plains')).toBe(1);
    expect(s.objects[findAll(s, 'Plains', 'battlefield', 'p1')[0]!]!.tapped).toBe(true);
    expect(findAll(s, 'Test Imp 4', 'hand', 'p1')).toHaveLength(1);
  });
  it('the condition true: a creature card can be chosen too (it enters, and is tapped)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Imp 1', 'Test Imp 4'], battlefield: ['Test Spring Bard', 'Test Imp 2', 'Test Imp 3'] } });
    const imp4 = find(s0, 'Test Imp 4', 'hand', 'p1');
    const s = cast(s0, 'Test Imp 1', { objects: [[imp4]] }).s;
    const now = findAll(s, 'Test Imp 4', 'battlefield', 'p1'); // a new object (CR 400.7)
    expect(now).toHaveLength(1);
    expect(s.objects[now[0]!]!.tapped).toBe(true);
  });
});

describe('CR 614.15, 608.2c: "You may pay {G/W}. If you do, put a +1/+1 counter on it. If it\'s a Unicorn, put two +1/+1 counters on it instead."', () => {
  const EMIEL = card('Test Blessed Mage', 'Creature — Human', "Whenever another creature you control enters, you may pay {G/W}. If you do, put a +1/+1 counter on it. If it's a Unicorn, put two +1/+1 counters on it instead.", { pt: ['1', '1'] });
  const UNI = card('Test Unicorn', 'Creature — Unicorn', '', { pt: ['1', '1'] });
  const defs = [EMIEL, UNI, IMP(1)];
  const play = (name: string, pays: boolean): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs, p1: { hand: [name], battlefield: ['Test Blessed Mage', 'Plains'] } });
    const r = cast(s0, name, { yes: pays });
    return { s: r.s, id: findAll(r.s, name, 'battlefield', 'p1')[0]! };
  };
  it('is automated', () => expect(full(EMIEL)).toBe(true));
  it('a Unicorn gets two counters, any other creature one (paid either way)', () => {
    const u = play('Test Unicorn', true);
    expect(counters(u.s, u.id)).toBe(2);
    const i = play('Test Imp 1', true);
    expect(counters(i.s, i.id)).toBe(1);
  });
  it('not paying gives no counters at all, even to a Unicorn (the replacement applies only where the counters would be put)', () => {
    const u = play('Test Unicorn', false);
    expect(counters(u.s, u.id)).toBe(0);
    const i = play('Test Imp 1', false);
    expect(counters(i.s, i.id)).toBe(0);
  });
});

describe('CR 614.1a, 614.6, 120.3: "If a permanent dealt damage this way would die this turn, exile it instead."', () => {
  const ZAP = card('Test Scorch Bolt', 'Instant', '~ deals 1 damage to any target. If a permanent dealt damage this way would die this turn, exile it instead.');
  const KILL = card('Test Plain Doom', 'Instant', 'Destroy target creature.');
  const BEAR = card('Test Tough Bear', 'Creature — Bear', '', { pt: ['2', '3'] });
  const defs = [ZAP, KILL, IMP(1), IMP(2), BEAR];
  const target = (id: ObjectId) => ({ kind: 'object' as const, id });
  /** p1 casts `name` at `tgt` (choosing it as the only target) and the stack resolves. */
  function castAt(s0: GameState, name: string, tgt: ObjectId): GameState {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
    for (let g = 0; g < 20 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending;
      if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [target(tgt)] });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return resolveAll(s).s;
  }
  const inZone = (s: GameState, name: string, zone: 'graveyard' | 'exile'): number =>
    (zone === 'exile' ? s.zones.exile : s.zones.graveyard.p2 ?? []).filter((id) => s.defs[s.objects[id]!.defId]!.name === name && s.objects[id]!.zone === zone).length;
  it('is automated', () => expect(full(ZAP)).toBe(true));
  it('a creature the spell dealt lethal damage to is exiled instead of dying', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Scorch Bolt'] }, p2: { battlefield: ['Test Imp 1'] } });
    const s = castAt(s0, 'Test Scorch Bolt', find(s0, 'Test Imp 1', 'battlefield', 'p2'));
    expect(inZone(s, 'Test Imp 1', 'exile')).toBe(1);
    expect(inZone(s, 'Test Imp 1', 'graveyard')).toBe(0);
  });
  it('a creature that survived the damage is exiled if it dies later this turn; one the spell did not damage goes to the graveyard', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Scorch Bolt', 'Test Plain Doom', 'Test Plain Doom'] }, p2: { battlefield: ['Test Tough Bear', 'Test Imp 2'] } });
    const bear = find(s0, 'Test Tough Bear', 'battlefield', 'p2');
    const imp = find(s0, 'Test Imp 2', 'battlefield', 'p2');
    const s1 = castAt(s0, 'Test Scorch Bolt', bear);
    expect(s1.objects[bear]!.zone).toBe('battlefield');
    const s2 = castAt(s1, 'Test Plain Doom', bear);
    expect(inZone(s2, 'Test Tough Bear', 'exile')).toBe(1);
    expect(inZone(s2, 'Test Tough Bear', 'graveyard')).toBe(0);
    const s3 = castAt(s2, 'Test Plain Doom', imp); // never dealt damage by the spell
    expect(inZone(s3, 'Test Imp 2', 'graveyard')).toBe(1);
    expect(inZone(s3, 'Test Imp 2', 'exile')).toBe(0);
  });
  it('it applies this turn only: a creature dealt damage this way that dies on a later turn goes to the graveyard', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Scorch Bolt', 'Test Plain Doom'] }, p2: { battlefield: ['Test Tough Bear'] } });
    const bear = find(s0, 'Test Tough Bear', 'battlefield', 'p2');
    const s1 = castAt(s0, 'Test Scorch Bolt', bear);
    const s2 = pass(advanceTo(s1, 2, 'upkeep')); // p2's upkeep: p1 gets priority
    expect(s2.pending?.player).toBe('p1');
    const s3 = castAt(s2, 'Test Plain Doom', bear);
    expect(inZone(s3, 'Test Tough Bear', 'graveyard')).toBe(1);
    expect(inZone(s3, 'Test Tough Bear', 'exile')).toBe(0);
  });
});

/** p1 attacks p2 with `attackers` (all unblocked) and the combat damage step is dealt and everything it triggers resolves; the state is the end of combat. */
function attack(s0: GameState, attackers: ObjectId[], o: { objects?: ObjectId[][]; yes?: boolean } = {}): GameState {
  let s = s0;
  for (let g = 0; g < 60 && s.pending?.kind !== 'declareAttackers'; g++) s = pass(s);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' as const })) });
  for (let g = 0; g < 80 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; g++) {
    const d = s.pending;
    if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d !== null && d !== undefined && d.kind !== 'priority') s = drive(s, o).s;
    else s = pass(s);
  }
  return s;
}
const stats = (s: GameState, id: ObjectId): { power: number | null; toughness: number | null } => ptNumbers(getChars(s, id));

describe('CR 120.3, 603.2c, 510.2: "Whenever one or more creatures you control with trample deal combat damage to a player, create an X/X ... token with trample, where X is the amount of damage those creatures dealt to that player."', () => {
  const CRASHER = card('Test Stampede Beast', 'Creature — Beast', 'Trample\nWhenever one or more creatures you control with trample deal combat damage to a player, create an X/X green Dinosaur Beast creature token with trample, where X is the amount of damage those creatures dealt to that player.', { pt: ['3', '3'] });
  const TRAMPLER = card('Test Trample Imp', 'Creature — Imp', 'Trample', { pt: ['2', '2'] });
  const PLAIN = card('Test Plain Ox', 'Creature — Ox', '', { pt: ['4', '4'] });
  const defs = [CRASHER, TRAMPLER, PLAIN];
  const tokens = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
  it('is automated', () => expect(full(CRASHER)).toBe(true));
  it('the token is as big as the damage the trampling creatures dealt together (3 + 2 = 5), with trample', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Stampede Beast', 'Test Trample Imp'] }, p2: {} });
    const s = attack(s0, [find(s0, 'Test Stampede Beast', 'battlefield', 'p1'), find(s0, 'Test Trample Imp', 'battlefield', 'p1')]);
    expect(life(s, 'p2')).toBe(20 - 5);
    const t = tokens(s);
    expect(t).toHaveLength(1);
    expect(stats(s, t[0]!)).toEqual({ power: 5, toughness: 5 });
  });
  it('a creature without trample does not count: 3 from the Beast, 4 from the Ox -> a 3/3 token', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Stampede Beast', 'Test Plain Ox'] }, p2: {} });
    const s = attack(s0, [find(s0, 'Test Stampede Beast', 'battlefield', 'p1'), find(s0, 'Test Plain Ox', 'battlefield', 'p1')]);
    expect(life(s, 'p2')).toBe(20 - 7);
    expect(stats(s, tokens(s)[0]!)).toEqual({ power: 3, toughness: 3 });
  });
  it('no trampling creature deals damage: no token', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Stampede Beast', 'Test Plain Ox'] }, p2: {} });
    const s = attack(s0, [find(s0, 'Test Plain Ox', 'battlefield', 'p1')]);
    expect(tokens(s)).toHaveLength(0);
  });
});

describe('CR 120.3, 603.2c: "Whenever one or more Dragons you control deal combat damage to a player, you may put a permanent card with mana value less than or equal to that damage from your hand onto the battlefield."', () => {
  const SCOURGE = card('Test Brood Whelp', 'Creature — Dragon', 'Whenever one or more Dragons you control deal combat damage to a player, you may put a permanent card with mana value less than or equal to that damage from your hand onto the battlefield.', { pt: ['3', '3'] });
  const SMALL = card('Test Cheap Elk', 'Creature — Elk', '', { pt: ['1', '1'], cost: '{2}' });
  const BIG = card('Test Big Elk', 'Creature — Elk', '', { pt: ['1', '1'], cost: '{4}' });
  const defs = [SCOURGE, SMALL, BIG];
  it('is automated', () => expect(full(SCOURGE)).toBe(true));
  it('the permanent card may have a mana value up to the damage dealt (3): the {2} Elk can be put in, the {4} Elk is not offered', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Brood Whelp'], hand: ['Test Cheap Elk', 'Test Big Elk'] }, p2: {} });
    const small = find(s0, 'Test Cheap Elk', 'hand', 'p1');
    const big = find(s0, 'Test Big Elk', 'hand', 'p1');
    let s = s0;
    for (let g = 0; g < 60 && s.pending?.kind !== 'declareAttackers'; g++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Brood Whelp', 'battlefield', 'p1'), defender: 'p2' }] });
    let offered: string[] | null = null;
    for (let g = 0; g < 80 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; g++) {
      const d = s.pending;
      if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d?.kind === 'chooseObjects') { offered = [...d.options]; s = answer(s, { kind: 'chooseObjects', ids: [small] }); }
      else if (d?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else s = pass(s);
    }
    expect(offered, 'a choice was asked').not.toBeNull();
    expect(offered).toContain(small);
    expect(offered).not.toContain(big);
    expect(findAll(s, 'Test Cheap Elk', 'battlefield', 'p1')).toHaveLength(1);
    expect(findAll(s, 'Test Big Elk', 'hand', 'p1')).toHaveLength(1);
  });
});

describe('CR 608.2c, 120.3: "~ deals 2 damage to it. If a Dinosaur is dealt damage this way, ~ gets +2/+0 until end of turn."', () => {
  const RAPTOR = card('Test Needling Raptor', 'Creature — Dinosaur', 'Whenever another creature you control enters, ~ deals 2 damage to it. If a Dinosaur is dealt damage this way, ~ gets +2/+0 until end of turn.', { pt: ['3', '3'] });
  const SAUR = card('Test Plain Saur', 'Creature — Dinosaur', '', { pt: ['1', '9'] });
  const OX = card('Test Plain Ox', 'Creature — Ox', '', { pt: ['1', '9'] });
  const defs = [RAPTOR, SAUR, OX];
  it('is automated', () => expect(full(RAPTOR)).toBe(true));
  it('a Dinosaur that enters is dealt 2 damage and the Raptor gets +2/+0; another creature is dealt 2 and the Raptor does not grow', () => {
    const run = (name: string): { s: GameState; raptor: ObjectId; entered: ObjectId } => {
      const s0 = scenario([], { defs, p1: { battlefield: ['Test Needling Raptor'], hand: [name] } });
      const s = cast(s0, name).s;
      return { s, raptor: find(s, 'Test Needling Raptor', 'battlefield', 'p1'), entered: find(s, name, 'battlefield', 'p1') };
    };
    const a = run('Test Plain Saur');
    expect(a.s.objects[a.entered]!.damage).toBe(2);
    expect(stats(a.s, a.raptor).power).toBe(5);
    const b = run('Test Plain Ox');
    expect(b.s.objects[b.entered]!.damage).toBe(2);
    expect(stats(b.s, b.raptor).power).toBe(3);
  });
});

describe('CR 120.1, 608.2h: "Whenever an opponent casts a noncreature spell, ~ deals damage equal to its power to that player."', () => {
  const ARSON = card('Test Glee Imp', 'Creature — Imp', 'Whenever an opponent casts a noncreature spell, ~ deals damage equal to its power to that player.', { pt: ['3', '3'] });
  const SPELL = card('Test Idle Charm', 'Instant', 'You gain 1 life.');
  const CREATURE = card('Test Idle Ox', 'Creature — Ox', 'Flash', { pt: ['1', '1'] });
  const defs = [ARSON, SPELL, CREATURE];
  it('is automated', () => expect(full(ARSON)).toBe(true));
  it('the Imp\'s power (3) is dealt to the opponent who cast a noncreature spell, not to its controller; a creature spell does nothing', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Glee Imp'] }, p2: { hand: ['Test Idle Charm', 'Test Idle Ox'] } });
    const a = resolveAll(drive(act(pass(s0), { type: 'cast', player: 'p2', card: find(s0, 'Test Idle Charm', 'hand', 'p2') })).s).s;
    expect(life(a, 'p2')).toBe(20 + 1 - 3);
    expect(life(a, 'p1')).toBe(20);
    const b = resolveAll(drive(act(pass(s0), { type: 'cast', player: 'p2', card: find(s0, 'Test Idle Ox', 'hand', 'p2') })).s).s;
    expect(life(b, 'p2')).toBe(20); // a creature spell does not trigger it
  });
  it('CR 608.2h: if the Imp is gone when the trigger resolves, its power as it last existed (3) is dealt', () => {
    const DOOM = card('Test Plain Doom', 'Instant', 'Destroy target creature.');
    const s0 = scenario([], { defs: [...defs, DOOM], p1: { battlefield: ['Test Glee Imp'], hand: ['Test Plain Doom'] }, p2: { hand: ['Test Idle Charm'] } });
    let s = act(pass(s0), { type: 'cast', player: 'p2', card: find(s0, 'Test Idle Charm', 'hand', 'p2') });
    s = drive(s).s; // p2 has priority with the Charm and the trigger on the stack
    s = pass(s); // p2 passes; p1 may respond
    expect(s.pending?.player).toBe('p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Plain Doom', 'hand', 'p1') });
    for (let g = 0; g < 10 && s.pending && s.pending.kind !== 'priority'; g++) {
      const p = s.pending;
      if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Glee Imp', 'battlefield', 'p1') }] });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    s = resolveAll(s).s;
    expect(findAll(s, 'Test Glee Imp', 'battlefield', 'p1')).toHaveLength(0);
    expect(life(s, 'p2')).toBe(20 + 1 - 3);
  });
});

describe('CR 615.1a, 611.2a, 510.2: "Prevent all combat damage that would be dealt to you and planeswalkers you control this turn."', () => {
  const BAIT = card('Test Fog Bait', 'Instant', 'Prevent all combat damage that would be dealt to you and planeswalkers you control this turn.');
  const OX = card('Test Plain Ox', 'Creature — Ox', '', { pt: ['4', '4'] });
  const PINGER = card('Test Pinger Imp', 'Creature — Imp', '{0}: This creature deals 2 damage to any target.', { pt: ['1', '1'] });
  const defs = [BAIT, OX, PINGER];
  it('is automated', () => expect(full(BAIT)).toBe(true));
  it('combat damage to the caster is prevented this turn, noncombat damage to the caster is not; the opponent still takes combat damage', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Plain Ox', 'Test Pinger Imp'] }, p2: { hand: ['Test Fog Bait'], battlefield: ['Test Pinger Imp'] } });
    const bait = (s: GameState): GameState => resolveAll(drive(act(pass(s), { type: 'cast', player: 'p2', card: find(s, 'Test Fog Bait', 'hand', 'p2') })).s).s;
    const s1 = bait(s0);
    const s2 = attack(s1, [find(s1, 'Test Plain Ox', 'battlefield', 'p1')]);
    expect(life(s2, 'p2')).toBe(20); // the 4 combat damage was prevented
    // a noncombat 2 damage to p2 is dealt (p1's Pinger Imp), and the opponent's own combat damage to p1 is not prevented
    const pinger = find(s2, 'Test Pinger Imp', 'battlefield', 'p1');
    const act1 = legalActions(s2, 'p1').find((a) => a.kind === 'activate' && a.object === pinger)!;
    let s3 = act(s2, act1.action);
    for (let g = 0; g < 10 && s3.pending && s3.pending.kind !== 'priority'; g++) {
      const p = s3.pending;
      if (p.kind === 'chooseTargets') s3 = answer(s3, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      else if (p.kind === 'payCost') s3 = answer(s3, { kind: 'payCost', auto: true });
      else break;
    }
    expect(life(resolveAll(s3).s, 'p2')).toBe(18);
  });
  it('"Untap all attacking creatures and goad them": every attacker is goaded, one with vigilance (already untapped) too, and one that was tapped is untapped', () => {
    const BAIT2 = card('Test Fog Bait Two', 'Instant', 'Prevent all combat damage that would be dealt to you and planeswalkers you control this turn. Untap all attacking creatures and goad them.');
    const WATCH = card('Test Vigil Ox', 'Creature — Ox', 'Vigilance', { pt: ['2', '2'] });
    const defs2 = [BAIT2, OX, WATCH];
    const s0 = scenario([], { defs: defs2, p1: { battlefield: ['Test Plain Ox', 'Test Vigil Ox'] }, p2: { hand: ['Test Fog Bait Two'] } });
    let s = s0;
    for (let g = 0; g < 60 && s.pending?.kind !== 'declareAttackers'; g++) s = pass(s);
    const ox = find(s, 'Test Plain Ox', 'battlefield', 'p1');
    const vig = find(s, 'Test Vigil Ox', 'battlefield', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: ox, defender: 'p2' }, { attacker: vig, defender: 'p2' }] });
    expect(s.objects[ox]!.tapped).toBe(true);
    expect(s.objects[vig]!.tapped).toBe(false);
    s = resolveAll(drive(act(pass(s), { type: 'cast', player: 'p2', card: find(s, 'Test Fog Bait Two', 'hand', 'p2') })).s).s;
    expect(s.objects[ox]!.tapped).toBe(false);
    expect(s.objects[ox]!.goaded?.map((g) => g.by)).toEqual(['p2']);
    expect(s.objects[vig]!.goaded?.map((g) => g.by)).toEqual(['p2']);
  });
  it('without the spell the same attack deals its damage', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Plain Ox'] }, p2: {} });
    expect(life(attack(s0, [find(s0, 'Test Plain Ox', 'battlefield', 'p1')]), 'p2')).toBe(16);
  });
});

describe('CR 615.1a, 120.3, 611.2a: "Prevent all damage that black and/or red sources would deal to creatures you control this turn."', () => {
  const SURGE = card('Test Warding Surge', 'Instant', 'Prevent all damage that black and/or red sources would deal to creatures you control this turn.');
  const BLACK = card('Test Black Pinger', 'Creature — Imp', '{0}: This creature deals 2 damage to target creature.', { pt: ['1', '1'], colors: ['B'] });
  const GREEN = card('Test Green Pinger', 'Creature — Elf', '{0}: This creature deals 2 damage to target creature.', { pt: ['1', '1'], colors: ['G'] });
  const RED = card('Test Red Pinger', 'Creature — Goblin', '{0}: This creature deals 2 damage to target creature.', { pt: ['1', '1'], colors: ['R'] });
  const WALL = card('Test Stout Wall', 'Creature — Wall', '', { pt: ['0', '9'] });
  const defs = [SURGE, BLACK, GREEN, RED, WALL];
  it('is automated', () => expect(full(SURGE)).toBe(true));
  it('2 damage from a black or a red source to a creature of the caster is prevented, from a green source it is dealt; the opponent\'s own creatures are not covered', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Warding Surge'], battlefield: ['Test Stout Wall'] }, p2: { battlefield: ['Test Black Pinger', 'Test Green Pinger', 'Test Red Pinger', 'Test Stout Wall'] } });
    const s1 = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Warding Surge', 'hand', 'p1') })).s).s;
    const hit = (s: GameState, src: string, victim: ObjectId): number => {
      const s2 = pass(s); // p2 gets priority
      const a = legalActions(s2, 'p2').find((x) => x.kind === 'activate' && x.object === find(s2, src, 'battlefield', 'p2'))!;
      let t = act(s2, a.action);
      for (let g = 0; g < 10 && t.pending && t.pending.kind !== 'priority'; g++) {
        const p = t.pending;
        if (p.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: victim }] });
        else if (p.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
        else break;
      }
      return resolveAll(t).s.objects[victim]!.damage;
    };
    const mine = find(s1, 'Test Stout Wall', 'battlefield', 'p1');
    const theirs = find(s1, 'Test Stout Wall', 'battlefield', 'p2');
    expect(hit(s1, 'Test Black Pinger', mine)).toBe(0);
    expect(hit(s1, 'Test Red Pinger', mine)).toBe(0);
    expect(hit(s1, 'Test Green Pinger', mine)).toBe(2);
    expect(hit(s1, 'Test Black Pinger', theirs)).toBe(2);
  });
  it('ruling 2023-04-14: only the permanents you controlled as it resolved gain hexproof; a creature that enters later is targetable but its damage from black sources is still prevented', () => {
    const FLASH = card('Test Flash Ox', 'Creature — Ox', 'Flash', { pt: ['1', '9'] });
    const FULL = card('Test Warding Surge Full', 'Instant', 'You and permanents you control gain hexproof until end of turn. Prevent all damage that black and/or red sources would deal to creatures you control this turn.');
    expect(full(FULL)).toBe(true);
    const s0 = scenario([], { defs: [...defs, FLASH, FULL], p1: { hand: ['Test Warding Surge Full', 'Test Flash Ox'], battlefield: ['Test Stout Wall'] }, p2: { battlefield: ['Test Black Pinger', 'Test Green Pinger'] } });
    const s1 = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Warding Surge Full', 'hand', 'p1') })).s).s;
    const s2 = resolveAll(drive(act(s1, { type: 'cast', player: 'p1', card: find(s1, 'Test Flash Ox', 'hand', 'p1') })).s).s;
    const s3 = pass(s2); // p2 gets priority
    const canTarget = (src: string, victim: ObjectId): boolean => {
      const a = legalActions(s3, 'p2').find((x) => x.kind === 'activate' && x.object === find(s3, src, 'battlefield', 'p2'))!;
      let t = act(s3, a.action);
      if (t.pending?.kind !== 'chooseTargets') return false;
      try {
        answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: victim }] });
        return true;
      } catch {
        return false; // "not a legal target" (hexproof, CR 702.11b)
      }
    };
    const wall = find(s3, 'Test Stout Wall', 'battlefield', 'p1');
    const ox = find(s3, 'Test Flash Ox', 'battlefield', 'p1');
    expect(canTarget('Test Green Pinger', wall)).toBe(false); // hexproof (resolved with it)
    expect(canTarget('Test Green Pinger', ox)).toBe(true); // entered later: no hexproof
  });
});

describe('CR 603.7, 603.4, 510.2: "Target creature gains trample until end of turn. Whenever that creature deals combat damage this turn, if this spell was kicked, you gain life equal to that damage." (a side effect of "that damage": Vigorous Charge)', () => {
  const CHARGE = card('Test Vigor Surge', 'Instant', 'Kicker {0}\nTarget creature gains trample until end of turn. Whenever that creature deals combat damage this turn, if this spell was kicked, you gain life equal to that damage.');
  const DUELIST = card('Test Twin Ox', 'Creature — Ox', 'Double strike', { pt: ['2', '2'] });
  const defs = [CHARGE, DUELIST];
  it('is automated', () => expect(full(CHARGE)).toBe(true));
  it('kicked: every combat damage event of the creature gains its damage (double strike: 2 + 2); unkicked: nothing', () => {
    for (const [kick, gained] of [[true, 4], [false, 0]] as const) {
      const s0 = scenario([], { defs, p1: { hand: ['Test Vigor Surge'], battlefield: ['Test Twin Ox'] }, p2: {} });
      const ox = find(s0, 'Test Twin Ox', 'battlefield', 'p1');
      let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Vigor Surge', 'hand', 'p1') });
      for (let g = 0; g < 20 && s.pending && s.pending.kind !== 'priority'; g++) {
        const p = s.pending;
        if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: kick });
        else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: ox }] });
        else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
        else break;
      }
      s = resolveAll(s).s;
      const a = attack(s, [ox]);
      expect(life(a, 'p2'), `kicked ${kick}`).toBe(20 - 4);
      expect(life(a, 'p1'), `kicked ${kick}`).toBe(20 + gained);
    }
  });
});

describe('CR 608.2c, 701.26b: "Untap all creatures you control. They gain flying until end of turn." names every creature, tapped or not (effects/handlers/zones-status.ts#untap)', () => {
  const RALLY = card('Test Rally Cry', 'Instant', 'Untap all creatures you control. They gain flying until end of turn.');
  const OX = card('Test Plain Ox', 'Creature — Ox', '', { pt: ['4', '4'] });
  const defs = [RALLY, OX];
  it('a tapped creature is untapped and gains flying, and so does one that was untapped already; the opponent\'s creature gains nothing', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Rally Cry'], battlefield: [{ name: 'Test Plain Ox', tapped: true }, 'Test Plain Ox'] }, p2: { battlefield: ['Test Plain Ox'] } });
    const s = cast(s0, 'Test Rally Cry').s;
    const mine = findAll(s, 'Test Plain Ox', 'battlefield', 'p1');
    expect(mine).toHaveLength(2);
    for (const id of mine) {
      expect(s.objects[id]!.tapped).toBe(false);
      expect(getChars(s, id).keywords.some((k) => k.keyword === 'flying'), id).toBe(true);
    }
    const theirs = find(s, 'Test Plain Ox', 'battlefield', 'p2');
    expect(getChars(s, theirs).keywords.some((k) => k.keyword === 'flying')).toBe(false);
  });
});
