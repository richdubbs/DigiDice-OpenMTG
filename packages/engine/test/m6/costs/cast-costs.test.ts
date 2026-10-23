/**
 * M6-5a (m6 design 3.8, 5; push package K1): additional and alternative costs as data, end to end on the game path. Each kicker, multikicker, entwine,
 * buyback and evoke card here gets its cost from the keyword library's `additionalCost` / `alternativeCost` statics (CR 118.8-118.9, 601.2b), which the
 * engine now advertises (`static:additionalCost`, `static:alternativeCost`, `feature:replace.cause`), so the cards are compiled `full` and play as written.
 */
import { describe, expect, it } from 'vitest';
import { announceCond } from '../../../src/actions/announce-cond';
import { getChars, hasKeyword, type GameState } from '../../../src/index';
import {
  answer, castMethodsOffered, castWith, drive, find, gamePath, handSize, namesIn, no, pass, resolveAll, resolveTop, scenario, stackNames, synthetic, target, topPaid, yes,
} from './support';

const forests = (n: number): string[] => Array(n).fill('Forest') as string[];
const islands = (n: number): string[] => Array(n).fill('Island') as string[];
const counters = (s: GameState, id: string, kind = '+1/+1'): number => s.objects[id]!.counters?.[kind] ?? 0;

/** A sorcery with two kicker costs (CR 702.33f: "Kicker {A} and/or {B}" is two kicker costs; two printed kicker lines are the same two costs, CR 702.33b). */
const TWIN = synthetic('Test Twin Kicker', 'Sorcery', '{R}', 'Kicker {1}\nKicker {2}\nDraw a card.');

describe('CR 702.33: kicker counts (the M6-5a fix of actions/cast.ts)', () => {
  const board = (): GameState => scenario(['Mountain', 'Grizzly Bears'], { p1: { hand: ['Test Twin Kicker'], battlefield: Array(6).fill('Mountain') as string[], library: Array(5).fill('Grizzly Bears') as string[] }, defs: [TWIN] });

  it('the two kicker lines expand to two additionalCost statics named "kicker" and "kicker:2" (CR 702.33f, keywords/expand.ts $ordinal)', () => {
    expect(TWIN.automation.level).toBe('full');
    const s = board();
    const names = getChars(s, find(s, 'Test Twin Kicker', 'hand')).abilities.flatMap((a) => (a.def.kind === 'static' ? a.def.effects : [])).map((e) => (e as { name?: string }).name);
    expect(names).toEqual(['kicker', 'kicker:2']);
  });

  it('CR 702.33d: paying only the second kicker makes it kicked', () => {
    const s = castWith(board(), 'Test Twin Kicker', [no, yes]);
    expect(topPaid(s)).toMatchObject({ kicked: 1, additional: ['kicker:2'] });
    const env = { s, player: 'p1' as const, sourceId: s.zones.stack[0]!, costsPaid: topPaid(s) };
    expect(announceCond(env, { cond: 'wasCast', kicked: true })).toBe(true);
    expect(announceCond(env, { cond: 'wasCast', kicked: 'kicker:2' })).toBe(true);
    expect(announceCond(env, { cond: 'wasCast', kicked: 'kicker' })).toBe(false); // CR 702.33f: "its {1} kicker" names the first cost only
    expect(s.log.some((l) => /casts Test Twin Kicker kicked\./.test(l.text))).toBe(true);
  });

  it('CR 702.33d: kickCount = 2 with both kickers (read through costsPaid.kicked until the q:kickCount evaluator exists)', () => {
    const s = castWith(board(), 'Test Twin Kicker', [yes, yes]);
    expect(topPaid(s)).toMatchObject({ kicked: 2, additional: ['kicker', 'kicker:2'] });
    expect(topPaid(s).manaSpent).toHaveLength(4); // {R} + {1} + {2}
  });

  it('CR 702.33f: the second kicker is asked by its own name ("second kicker"), with the kicker labels', () => {
    let s = castWith(board(), 'Test Twin Kicker', [no]);
    expect(s.pending).toMatchObject({ kind: 'yesNo', prompt: expect.stringContaining('second kicker'), yesLabel: 'Kick it', rules: expect.arrayContaining(['CR 702.33a']) });
    s = drive(answer(s, no));
    expect(topPaid(s).kicked).toBeUndefined();
  });

  it('CR 702.33c-d: multikicker paid three times counts three kicks, remembered by the permanent (Everflowing Chalice, CR 400.7d)', () => {
    let s = scenario(['Everflowing Chalice', 'Mountain'], { p1: { hand: ['Everflowing Chalice'], battlefield: Array(8).fill('Mountain') as string[] } });
    s = castWith(s, 'Everflowing Chalice');
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 4 }); // {0} plus up to four payments of {2} from eight lands
    s = drive(answer(s, { kind: 'chooseNumber', n: 3 }));
    expect(topPaid(s)).toMatchObject({ kicked: 3, additional: ['kicker', 'kicker', 'kicker'] });
    s = resolveTop(s);
    // M6-5: "enters with a charge counter on it for each time it was kicked" (rep.m6.enters.counter.kicked, q:kickCount) puts them on as it enters
    const chalice = find(s, 'Everflowing Chalice', 'battlefield');
    expect(s.objects[chalice]!.cast?.costsPaid.kicked).toBe(3);
    expect(counters(s, chalice, 'charge')).toBe(3);
  });

  it('CR 707.10: a copy of a kicked spell is kicked (Twincast copies the costs paid, not the cast)', () => {
    let s = scenario(['Mountain', 'Island', 'Grizzly Bears', 'Twincast'], {
      p1: { hand: ['Test Twin Kicker', 'Twincast'], battlefield: [...Array(6).fill('Mountain') as string[], 'Island', 'Island'], library: Array(5).fill('Grizzly Bears') as string[] }, defs: [TWIN],
    });
    s = castWith(s, 'Test Twin Kicker', [no, yes]);
    const original = s.zones.stack[0]!;
    s = castWith(s, 'Twincast', [target(original)]);
    s = resolveTop(s); // Twincast resolves: the copy is on the stack above the original
    const copy = s.zones.stack[s.zones.stack.length - 1]!;
    expect(copy).not.toBe(original);
    expect(s.objects[copy]!.stack).toMatchObject({ isCopy: true, costsPaid: { kicked: 1, additional: ['kicker:2'] } });
  });
});

describe('CR 702.33a, 614.1c: Kavu Titan', () => {
  const board = (): GameState => scenario(['Kavu Titan', 'Forest'], { p1: { hand: ['Kavu Titan'], battlefield: forests(5) } });

  it('compiles full on the game path (keyword:kicker is advertised)', () => {
    expect(gamePath('Kavu Titan').automation.level).toBe('full');
  });

  it('kicked: it enters with three +1/+1 counters and has trample', () => {
    const s = resolveTop(castWith(board(), 'Kavu Titan', [yes]));
    const titan = find(s, 'Kavu Titan', 'battlefield');
    expect(counters(s, titan)).toBe(3);
    expect(hasKeyword(getChars(s, titan), 'trample')).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(5);
  });

  it('not kicked: a 2/2 with no counters and no trample', () => {
    const s = resolveTop(castWith(board(), 'Kavu Titan', [no]));
    const titan = find(s, 'Kavu Titan', 'battlefield');
    expect(counters(s, titan)).toBe(0);
    expect(hasKeyword(getChars(s, titan), 'trample')).toBe(false);
  });

  it('CR 601.2b, 118.3: with only two lands the kicker is not offered and the log says so', () => {
    const s = castWith(scenario(['Kavu Titan', 'Forest'], { p1: { hand: ['Kavu Titan'], battlefield: forests(2) } }), 'Kavu Titan');
    expect(s.pending?.kind).not.toBe('yesNo');
    expect(s.log.some((l) => l.text.includes("can't pay the kicker cost"))).toBe(true);
  });
});

describe('CR 702.27a: buyback returns the spell to its owner\'s hand only as it resolves (Capsize, feature:replace.cause)', () => {
  const board = (lands = 6): GameState => scenario(['Capsize', 'Island', 'Hill Giant', 'Counterspell'], {
    p1: { hand: ['Capsize'], battlefield: islands(lands) }, p2: { hand: ['Counterspell'], battlefield: ['Hill Giant', 'Island', 'Island'] },
  });

  it('compiles full on the game path', () => {
    expect(gamePath('Capsize').automation.level).toBe('full');
  });

  it('buyback paid: the target returns to its owner\'s hand and Capsize returns to its owner\'s hand', () => {
    const s0 = board();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = castWith(s0, 'Capsize', [yes, target(giant)]);
    expect(topPaid(s).additional).toEqual(['buyback']);
    s = resolveTop(s);
    expect(namesIn(s, 'hand', 'p1')).toEqual(['Capsize']);
    expect(namesIn(s, 'graveyard', 'p1')).toEqual([]);
    expect(namesIn(s, 'hand', 'p2')).toContain('Hill Giant');
  });

  it('buyback not paid: Capsize goes to the graveyard', () => {
    const s0 = board();
    const s = resolveTop(castWith(s0, 'Capsize', [no, target(find(s0, 'Hill Giant', 'battlefield'))]));
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(['Capsize']);
    expect(namesIn(s, 'hand', 'p1')).toEqual([]);
  });

  it('CR 702.27a, 701.6a: a countered buyback spell goes to the graveyard (the move has the cause "counter", not "resolve")', () => {
    const s0 = board();
    let s = castWith(s0, 'Capsize', [yes, target(find(s0, 'Hill Giant', 'battlefield'))]);
    s = pass(s);
    s = castWith(s, 'Counterspell', [target(s.zones.stack[0]!)], undefined, 'p2');
    s = resolveAll(s);
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(['Capsize']);
    expect(namesIn(s, 'hand', 'p1')).toEqual([]);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Hill Giant')).toBe(true);
  });

  it('CR 608.2b: a buyback spell whose only target is gone doesn\'t resolve and goes to the graveyard (cause "fizzle")', () => {
    const s0 = scenario(['Capsize', 'Island', 'Hill Giant'], { p1: { hand: ['Capsize', 'Capsize'], battlefield: islands(12) }, p2: { battlefield: ['Hill Giant'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = castWith(s0, 'Capsize', [yes, target(giant)]);
    s = castWith(s, 'Capsize', [yes, target(giant)]); // the second copy resolves first and bounces the Giant
    s = resolveAll(s);
    expect(namesIn(s, 'hand', 'p1')).toEqual(['Capsize']); // the one that resolved
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(['Capsize']); // the one that did not
  });
});

describe('CR 702.42a: entwine (Barbed Lightning)', () => {
  const board = (lands: number): GameState => scenario(['Barbed Lightning', 'Mountain', 'Hill Giant'], { p1: { hand: ['Barbed Lightning'], battlefield: Array(lands).fill('Mountain') as string[] }, p2: { battlefield: ['Hill Giant'] } });

  it('compiles full on the game path', () => {
    expect(gamePath('Barbed Lightning').automation.level).toBe('full');
  });

  it('entwine paid: both modes are chosen, 3 damage to the creature and 3 to the player', () => {
    const s0 = board(5);
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = castWith(s0, 'Barbed Lightning', [yes]);
    expect(topPaid(s).additional).toEqual(['entwine']);
    expect(s.pending).toMatchObject({ kind: 'chooseTargets' }); // no mode choice: entwined, both modes are chosen (CR 702.42a, 601.2b)
    s = drive(s, [target(giant), target('p2')]);
    expect(s.objects[s.zones.stack[0]!]!.stack!.modes).toEqual([0, 1]);
    const life = s.players.find((p) => p.id === 'p2')!.life;
    s = resolveTop(s);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(life - 3);
    expect(namesIn(s, 'graveyard', 'p2')).toEqual(['Hill Giant']);
  });

  it('CR 601.2b, 118.3: without the mana for entwine, one mode is chosen as usual', () => {
    const s = castWith(board(3), 'Barbed Lightning');
    expect(s.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 1, rules: ['CR 601.2b', 'CR 700.2'] });
  });
});

describe('CR 702.74a: evoke (Mulldrifter)', () => {
  const board = (): GameState => scenario(['Mulldrifter', 'Island', 'Grizzly Bears'], { p1: { hand: ['Mulldrifter'], battlefield: islands(3), library: Array(5).fill('Grizzly Bears') as string[] } });

  it('compiles full; the evoke cost is offered as a cast method', () => {
    expect(gamePath('Mulldrifter').automation.level).toBe('full');
    const s = board();
    expect(castMethodsOffered(s, find(s, 'Mulldrifter', 'hand'))).toEqual(['evoke']); // three lands: {4}{U} can't be paid, {2}{U} can
  });

  it('cast for its evoke cost: it is sacrificed when it enters, and its enters trigger still draws two cards', () => {
    const s0 = board();
    let s = castWith(s0, 'Mulldrifter', [], 'evoke');
    expect(topPaid(s).alternative).toBe('evoke');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(3); // {2}{U}
    s = resolveTop(s);
    expect(stackNames(s)).toHaveLength(2); // the draw trigger and the evoke sacrifice trigger (CR 603.3b: their controller orders them)
    s = resolveAll(s);
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(['Mulldrifter']);
    expect(handSize(s, 'p1')).toBe(handSize(s0, 'p1') - 1 + 2);
  });

  it('cast normally: it stays (the evoke trigger\'s intervening "if" is false, CR 603.4)', () => {
    const s0 = scenario(['Mulldrifter', 'Island', 'Grizzly Bears'], { p1: { hand: ['Mulldrifter'], battlefield: islands(5), library: Array(5).fill('Grizzly Bears') as string[] } });
    let s = resolveTop(castWith(s0, 'Mulldrifter'));
    s = resolveAll(s);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Mulldrifter')).toBe(true);
    expect(handSize(s, 'p1')).toBe(2);
  });
});

describe('CR 118.8, 601.2b: a mandatory additional cost (Village Rites)', () => {
  it('a creature is sacrificed as the spell is cast; without a creature it can\'t be cast', () => {
    expect(gamePath('Village Rites').automation.level).toBe('full');
    const s0 = scenario(['Village Rites', 'Plains', 'Swamp', 'Grizzly Bears'], { p1: { hand: ['Village Rites'], battlefield: ['Swamp', 'Grizzly Bears'], library: Array(4).fill('Grizzly Bears') as string[] } });
    let s = castWith(s0, 'Village Rites');
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(['Grizzly Bears']); // paid before it resolves (CR 601.2h)
    s = resolveTop(s);
    expect(handSize(s, 'p1')).toBe(2);
    const none = scenario(['Village Rites', 'Swamp'], { p1: { hand: ['Village Rites'], battlefield: ['Swamp'] } });
    expect(castMethodsOffered(none, find(none, 'Village Rites', 'hand'))).toEqual([]);
  });
});

describe('CR 118.9, 601.2b: "You may [cost] rather than pay this spell\'s mana cost" (templates cm.alternative*)', () => {
  const board = (): GameState => scenario(['Force of Will', 'Island', 'Lightning Bolt', 'Mountain', 'Counterspell'], {
    p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, p2: { hand: ['Force of Will', 'Counterspell'] },
  });

  it('Force of Will compiles full, to an alternativeCost static', () => {
    const def = gamePath('Force of Will');
    expect(def.automation.level).toBe('full');
    expect(def.automation.unsupported).toEqual([]);
    expect(def.faces[0]!.abilities[0]).toMatchObject({ kind: 'static', effects: [{ s: 'alternativeCost', name: 'alternative', cost: { other: [{ kind: 'payLife', amount: 1 }, { kind: 'exileFrom', zone: 'hand' }] } }] });
  });

  it('with no land, Force of Will is cast for 1 life and a blue card exiled from hand, and counters the spell', () => {
    let s = castWith(board(), 'Lightning Bolt', [target('p2')]);
    s = pass(s);
    expect(castMethodsOffered(s, find(s, 'Force of Will', 'hand', 'p2'), 'p2')).toEqual(['alternative']); // no mana: only the alternative cost
    s = castWith(s, 'Force of Will', [target(s.zones.stack[0]!)], 'alternative', 'p2');
    expect(namesIn(s, 'exile', 'p2')).toEqual(['Counterspell']);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
    s = resolveAll(s);
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(['Lightning Bolt']);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
  });

  it('CR 118.9: Gush is cast by returning two Islands, and draws two cards', () => {
    expect(gamePath('Gush').automation.unsupported).toEqual([]);
    const s0 = scenario(['Gush', 'Island', 'Grizzly Bears'], { p1: { hand: ['Gush'], battlefield: islands(2), library: Array(4).fill('Grizzly Bears') as string[] } });
    let s = castWith(s0, 'Gush', [], 'alternative');
    expect(namesIn(s, 'hand', 'p1')).toEqual(['Island', 'Island']);
    s = resolveTop(s);
    expect(handSize(s, 'p1')).toBe(4);
  });

  it('CR 118.9, 118.9d, 601.2f: an alternative cost and a mandatory additional cost are paid together', () => {
    const def = synthetic('Test Costly Bolt', 'Instant', '{4}{R}', 'As an additional cost to cast this spell, discard a card.\nYou may pay 2 life rather than pay this spell\'s mana cost.\nDraw a card.');
    expect(def.automation.unsupported).toEqual([]);
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Costly Bolt', 'Grizzly Bears'], library: Array(3).fill('Grizzly Bears') as string[] }, defs: [def] });
    let s = castWith(s0, 'Test Costly Bolt', [], 'alternative');
    expect(namesIn(s, 'graveyard', 'p1')).toEqual(['Grizzly Bears']);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(18);
    s = resolveTop(s);
    expect(handSize(s, 'p1')).toBe(1);
  });

  it('CR 601.2f: Thalia\'s increase applies to an alternative cost (Force of Will for 1 life, a blue card and {1})', () => {
    const fow = (lands: number): GameState => scenario(['Force of Will', 'Island', 'Lightning Bolt', 'Mountain', 'Counterspell', 'Thalia, Guardian of Thraben'], {
      p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain', 'Mountain', 'Thalia, Guardian of Thraben'] }, p2: { hand: ['Force of Will', 'Counterspell'], battlefield: islands(lands) },
    });
    // No land: 1 life and a blue card are not enough any more, the {1} from Thalia can't be paid (CR 601.2f, 601.2h)
    const none = pass(castWith(fow(0), 'Lightning Bolt', [target('p2')]));
    expect(castMethodsOffered(none, find(none, 'Force of Will', 'hand', 'p2'), 'p2')).toEqual([]);
    let s = pass(castWith(fow(1), 'Lightning Bolt', [target('p2')]));
    expect(castMethodsOffered(s, find(s, 'Force of Will', 'hand', 'p2'), 'p2')).toEqual(['alternative']);
    s = castWith(s, 'Force of Will', [target(s.zones.stack[0]!)], 'alternative', 'p2');
    expect(topPaid(s)).toMatchObject({ alternative: 'alternative' });
    expect(topPaid(s).manaSpent).toHaveLength(1); // the {1} of Thalia, paid on top of the alternative cost
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(19);
    expect(namesIn(s, 'exile', 'p2')).toEqual(['Counterspell']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.tapped)).toHaveLength(1);
  });

  it('CR 601.2f: a kicker cost is added before cost increases apply (a kicked sorcery under Thalia costs mana cost + kicker + {1})', () => {
    const KICK = synthetic('Test Kicked Sorcery', 'Sorcery', '{R}', 'Kicker {1}\nDraw a card.');
    const board = (lands: number): GameState => scenario(['Mountain', 'Grizzly Bears', 'Thalia, Guardian of Thraben'], {
      p1: { hand: ['Test Kicked Sorcery'], battlefield: ['Thalia, Guardian of Thraben', ...Array(lands).fill('Mountain') as string[]], library: Array(3).fill('Grizzly Bears') as string[] }, defs: [KICK],
    });
    const two = castWith(board(2), 'Test Kicked Sorcery'); // {R} + {1} (Thalia) is payable, {R} + {1} + {1} is not: kicker not offered
    expect(two.pending?.kind).not.toBe('yesNo');
    expect(topPaid(two).kicked).toBeUndefined();
    expect(topPaid(two).manaSpent).toHaveLength(2);
    const three = castWith(board(3), 'Test Kicked Sorcery', [yes]);
    expect(topPaid(three)).toMatchObject({ kicked: 1, additional: ['kicker'] });
    expect(topPaid(three).manaSpent).toHaveLength(3); // {R} + kicker {1} + Thalia {1}
  });

  it('CR 601.2f: a generic reduction applies to the total cost including the kicker (a kicked {R} sorcery with kicker {1} costs {R} under a {1} reduction)', () => {
    const KICK = synthetic('Test Kicked Sorcery', 'Sorcery', '{R}', 'Kicker {1}\nDraw a card.');
    const REDUCER = synthetic('Test Reducer', 'Artifact', '{2}', 'Sorcery spells you cast cost {1} less to cast.');
    expect(REDUCER.automation.level).toBe('full');
    const s0 = scenario(['Mountain', 'Grizzly Bears'], {
      p1: { hand: ['Test Kicked Sorcery'], battlefield: ['Test Reducer', 'Mountain'], library: Array(3).fill('Grizzly Bears') as string[] }, defs: [KICK, REDUCER],
    });
    const s = castWith(s0, 'Test Kicked Sorcery', [yes]); // one Mountain pays {R} + {1} - {1}: the reduction is taken from the kicker's generic mana
    expect(topPaid(s)).toMatchObject({ kicked: 1, additional: ['kicker'] });
    expect(topPaid(s).manaSpent).toHaveLength(1);
  });

  it('CR 107.3a, 118.9: X in an alternative cost\'s filter ("exile a green card with mana value X") is announced, and only payable values are offered', () => {
    const def = synthetic('Test Shoal', 'Instant', '{X}{G}{G}', 'You may exile a green card with mana value X from your hand rather than pay this spell\'s mana cost.\nYou gain X life.');
    expect(def.automation.level).toBe('full');
    const s0 = scenario(['Grizzly Bears', 'Llanowar Elves', 'Lightning Bolt'], { p1: { hand: ['Test Shoal', 'Grizzly Bears', 'Llanowar Elves', 'Lightning Bolt'] }, defs: [def] });
    let s = castWith(s0, 'Test Shoal', [], 'alternative');
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 1, max: 2 }); // Llanowar Elves (1) or Grizzly Bears (2); Lightning Bolt is red
    s = drive(answer(s, { kind: 'chooseNumber', n: 2 }));
    expect(namesIn(s, 'exile', 'p1')).toEqual(['Grizzly Bears']);
    s = resolveTop(s);
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
  });
});
