/**
 * FAST5 T39 (T-ROLE): the shapes of parser/templates/zz-fast5/t39.json (Monster, Young Hero and Sorcerer Role tokens attached to an object, "for each ...
 * create a Wicked / Cursed Role token attached to that ...", "for each of those creatures, create a Monster Role token attached to it", "each gain") and the
 * engine additions they need (the "enchanted creatures you control" description, a reflexive trigger that refers to a target of the sentence before it),
 * played through applyAction with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 111.10k, 111.10n, 111.10r, 303.4f   a Role token enters attached to the object the effect names; a Role with nothing to enchant is not created (303.4g, 303.4i)
 *   CR 303.7a                              a second Role of the same controller on a permanent: the older one is put into its owner's graveyard
 *   CR 603.4, 111.10r                      the Young Hero Role: "if its toughness is 3 or less" is checked as the creature attacks and as the trigger resolves
 *   CR 603.12, 608.2c                      "Create a Monster Role token attached to target creature you control. When you do, that creature fights ..."
 *   CR 303.4b, 613.4c                      "Enchanted creatures you control get +1/+1" (an Aura of any controller makes a permanent enchanted)
 *   CR 608.2f, 111.10q, 111.10j            "for each ..., create a Wicked / Cursed Role token attached to that ..."; "for each of those creatures"
 *   CR 400.7, 303.4f                       "Return target creature card ... Create a Young Hero Role token attached to it": the returned creature is a new object
 */
import { describe, expect, it } from 'vitest';
import { compileCard, charsOfObject, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', type_line: type, oracle_text: text, mana_cost: cost, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard as never);
}
/** The abilities of a card that are manual or hold a manual step. */
const manualParts = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities).filter((a) => a.kind === 'manual' || JSON.stringify(a).includes('"op":"manual"')).map((a) => a.text);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pt = (s: GameState, id: ObjectId): string => { const c = charsOfObject(s, s.objects[id]!); return `${c.power}/${c.toughness}`; };
const roles = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.defs[s.objects[id]!.defId]!.faces[0]!.subtypes.includes('Role'));
const rolesOn = (s: GameState, host: ObjectId): string[] => roles(s).filter((id) => s.objects[id]!.attachedTo === host).map((id) => s.defs[s.objects[id]!.defId]!.name);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

/** Answer the decisions that come up: costs automatically, each target choice from the queue in order, yes/no with `yes`; stop at priority. */
function settle(s0: GameState, targets: TargetChoice[][] = [], yes = true): GameState {
  let s = s0;
  const queue = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: queue.shift() ?? [] });
    else if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: s.pending.items.map((i) => i.id) }); // CR 608.2f: the order of a "for each"
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty; triggers put on the stack on the way choose from the queue. */
function resolveAll(s0: GameState, targets: TargetChoice[][] = [], yes = true): GameState {
  let s = settle(s0, targets, yes);
  const queue = [...targets];
  for (let guard = 0; guard < 40; guard++) {
    if (s.zones.stack.length === 0 && s.pending?.kind === 'priority') return s;
    s = settle(s.pending?.kind === 'priority' ? pass(s) : s, queue, yes);
  }
  throw new Error(`the stack did not empty: ${JSON.stringify(s.pending)} ${s.zones.stack.length} ${s.log.slice(-4).map((l) => l.text).join(' / ')}`);
}
const castFirst = (s0: GameState, name: string, targets: TargetChoice[][] = [], yes = true): GameState =>
  resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), targets.slice(0, 1), yes), targets.slice(1), yes);

const BEAR = 'Grizzly Bears';

describe('CR 111.10k, 303.4f: "Create a Monster Role token attached to target creature you control"', () => {
  const CHARM = card('Test Brute Charm', 'Sorcery', 'Create a Monster Role token attached to target creature you control.');
  it('the card is automated; the Role enters attached to the target: +1/+1 and trample', () => {
    expect(manualParts(CHARM)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Brute Charm'], battlefield: [BEAR] }, defs: [CHARM] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const s = castFirst(s0, 'Test Brute Charm', [[obj(bears)]]);
    expect(rolesOn(s, bears)).toEqual(['Monster']);
    expect(pt(s, bears)).toBe('3/3');
    expect(charsOfObject(s, s.objects[bears]!).keywords.some((k) => k.keyword === 'trample')).toBe(true);
  });
  it('CR 303.7a: a newer Role of the same controller on the creature puts the older one into the graveyard (a token ceases to exist): +1/+1 once', () => {
    const SPARK = card('Test Spark Charm', 'Sorcery', 'Create a Sorcerer Role token attached to target creature you control.');
    const s0 = scenario([BEAR], { p1: { hand: ['Test Brute Charm', 'Test Spark Charm'], battlefield: [BEAR] }, defs: [CHARM, SPARK] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    let s = castFirst(s0, 'Test Brute Charm', [[obj(bears)]]);
    s = castFirst(s, 'Test Spark Charm', [[obj(bears)]]);
    expect(rolesOn(s, bears)).toEqual(['Sorcerer']);
    expect(pt(s, bears)).toBe('3/3');
    expect(charsOfObject(s, s.objects[bears]!).keywords.some((k) => k.keyword === 'trample')).toBe(false);
  });
});

describe('CR 111.10r, 603.4: the Young Hero Role, "up to one target creature you control"', () => {
  const CUT = card('Test Hero Cut', 'Sorcery', 'Create a Young Hero Role token attached to up to one target creature you control.');
  it('CR 303.4g: with no target chosen no Role is created', () => {
    expect(manualParts(CUT)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Hero Cut'], battlefield: [BEAR] }, defs: [CUT] });
    expect(roles(castFirst(s0, 'Test Hero Cut', [[]]))).toEqual([]);
  });
  it('the creature attacks with toughness 3 or less: a +1/+1 counter; with toughness 4 the intervening "if" is false and nothing happens (CR 603.4)', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Hero Cut'], battlefield: [BEAR] }, defs: [CUT] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    let s = castFirst(s0, 'Test Hero Cut', [[obj(bears)]]);
    expect(rolesOn(s, bears)).toEqual(['Young Hero']);
    expect(pt(s, bears)).toBe('2/2');
    const attack = (x: GameState): GameState => {
      let t = declareAttackers(toDeclareAttackers(x), [[bears]]);
      t = passUntil(t, (y) => y.pending?.kind === 'declareBlockers' || y.turn.step === 'combatDamage', 'blockers or damage', 20);
      return t;
    };
    s = attack(s);
    // the trigger resolved: 2/2 -> 3/3 (toughness was 2)
    s = resolveAll(s);
    expect(pt(s, bears)).toBe('3/3');
    // toughness 4 as the creature attacks: the trigger does not trigger / does nothing
    const big = tweak(s0, (t) => { t.objects[find(t, BEAR, 'battlefield', 'p1')]!.counters['+1/+1'] = 2; });
    let t = castFirst(big, 'Test Hero Cut', [[obj(find(big, BEAR, 'battlefield', 'p1'))]]);
    expect(pt(t, bears)).toBe('4/4');
    t = resolveAll(attack(t));
    expect(pt(t, bears)).toBe('4/4');
  });
});

describe('CR 603.12, 608.2c: "Create a Monster Role token attached to target creature you control. When you do, that creature fights up to one target creature you don\'t control."', () => {
  const CURSE = card('Test Fang Curse', 'Sorcery', 'Create a Monster Role token attached to target creature you control. When you do, that creature fights up to one target creature you don\'t control.');
  it('is automated; the Role is created, then the trigger asks for its own target and the enchanted creature (now 3/3) fights it', () => {
    expect(manualParts(CURSE)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Fang Curse'], battlefield: [BEAR] }, p2: { battlefield: [BEAR] }, defs: [CURSE] });
    const mine = find(s0, BEAR, 'battlefield', 'p1');
    const theirs = find(s0, BEAR, 'battlefield', 'p2');
    const s = castFirst(s0, 'Test Fang Curse', [[obj(mine)], [obj(theirs)]]);
    expect(rolesOn(s, mine)).toEqual(['Monster']);
    // the enchanted Bears are 3/3: they deal 3 to the opposing 2/2 Bears (dies) and take 2 back (CR 701.14)
    expect(findAll(s, BEAR, 'battlefield', 'p2').length).toBe(0);
    expect(s.objects[mine]!.damage).toBe(2);
  });
  it('"up to one": choosing no target for the trigger, the Role stays and nothing fights', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Fang Curse'], battlefield: [BEAR] }, p2: { battlefield: [BEAR] }, defs: [CURSE] });
    const mine = find(s0, BEAR, 'battlefield', 'p1');
    const s = castFirst(s0, 'Test Fang Curse', [[obj(mine)], []]);
    expect(rolesOn(s, mine)).toEqual(['Monster']);
    expect(findAll(s, BEAR, 'battlefield', 'p2').length).toBe(1);
    expect(s.objects[mine]!.damage).toBe(0);
  });
});

describe('CR 603.12, 118.12: "you may pay {1}. When you do, create a Sorcerer Role token attached to target creature you control"', () => {
  const BARD = card('Test Hall Bard', 'Creature — Human Bard', 'When ~ enters, you may pay {1}. When you do, create a Sorcerer Role token attached to target creature you control.', '{0}', ['1', '1']);
  it('is automated and has no manual part', () => {
    expect(manualParts(BARD)).toEqual([]);
  });
  it('paying: the trigger targets a creature you control and the Role is attached (+1/+1)', () => {
    const s0 = scenario([BEAR, 'Mountain'], { p1: { hand: ['Test Hall Bard'], battlefield: [BEAR, 'Mountain'] }, defs: [BARD] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const s = castFirst(s0, 'Test Hall Bard', [[], [obj(bears)]], true);
    expect(rolesOn(s, bears)).toEqual(['Sorcerer']);
    expect(pt(s, bears)).toBe('3/3');
  });
  it('declining: nothing is created', () => {
    const s0 = scenario([BEAR, 'Mountain'], { p1: { hand: ['Test Hall Bard'], battlefield: [BEAR, 'Mountain'] }, defs: [BARD] });
    const s = castFirst(s0, 'Test Hall Bard', [[]], false);
    expect(roles(s)).toEqual([]);
  });
});

describe('CR 111.10n, 303.4f: "you may pay {2}. If you do, create a Sorcerer Role token attached to it" (the creature itself)', () => {
  const SAGE = card('Test Quiet Sage', 'Creature — Human Wizard', 'When ~ enters, you may pay {2}. If you do, create a Sorcerer Role token attached to it.', '{0}', ['1', '1']);
  it('paying {2}: the Sage is enchanted by the Role (2/2); declining: no Role', () => {
    expect(manualParts(SAGE)).toEqual([]);
    const s0 = scenario(['Mountain'], { p1: { hand: ['Test Quiet Sage'], battlefield: ['Mountain', 'Mountain'] }, defs: [SAGE] });
    const yes = castFirst(s0, 'Test Quiet Sage', [], true);
    const sage = find(yes, 'Test Quiet Sage', 'battlefield', 'p1');
    expect(rolesOn(yes, sage)).toEqual(['Sorcerer']);
    expect(pt(yes, sage)).toBe('2/2');
    expect(roles(castFirst(s0, 'Test Quiet Sage', [], false))).toEqual([]);
  });
});

describe('CR 303.4b, 613.4c: "Enchanted creatures you control get +1/+1"', () => {
  const LORD = card('Test Aura Lord', 'Creature — Human Knight', 'Enchanted creatures you control get +1/+1.', '{0}', ['2', '2']);
  it('is automated; an Aura of any controller on a creature you control makes it enchanted; other creatures are not affected', () => {
    expect(manualParts(LORD)).toEqual([]);
    expect(JSON.stringify(LORD.faces[0]!.abilities[0])).toContain('"enchanted":true');
    let s = scenario([BEAR, 'Pacifism', 'Hill Giant'], { p1: { battlefield: ['Test Aura Lord', BEAR, 'Hill Giant'] }, p2: { battlefield: [BEAR] }, defs: [LORD] });
    const myBears = find(s, BEAR, 'battlefield', 'p1');
    const theirBears = find(s, BEAR, 'battlefield', 'p2');
    const giant = find(s, 'Hill Giant', 'battlefield', 'p1');
    const lord = find(s, 'Test Aura Lord', 'battlefield', 'p1');
    expect([pt(s, myBears), pt(s, theirBears), pt(s, giant), pt(s, lord)]).toEqual(['2/2', '2/2', '3/3', '2/2']);
    // an opponent's Pacifism on my Bears and on their Bears
    s = tweak(s, (t) => {
      const a = `o${t.counters.object++}`;
      const b = `o${t.counters.object++}`;
      for (const [id, host, owner] of [[a, myBears, 'p2'], [b, theirBears, 'p1']] as const) {
        t.objects[id] = { ...t.objects[myBears]!, id, cardId: `c${t.counters.card++}`, defId: 'Pacifism', owner, controller: owner, attachedTo: host, counters: {}, timestamp: t.counters.timestamp++ };
        t.zones.battlefield.push(id);
      }
    });
    expect(pt(s, myBears)).toBe('3/3');
    expect(pt(s, theirBears)).toBe('2/2');
    expect(pt(s, giant)).toBe('3/3');
    expect(pt(s, lord)).toBe('2/2');
  });
});

describe('CR 608.2f, 111.10q: "Then for each Rat you control, create a Wicked Role token attached to that Rat"', () => {
  const WITCH = card('Test Drain Witch', 'Creature — Human Warlock', 'When ~ enters, create a 1/1 black Rat creature token with "This creature can\'t block." Then for each Rat you control, create a Wicked Role token attached to that Rat.', '{0}', ['3', '3']);
  it('is automated; every Rat you control (the new one and one already there) gets its own Wicked Role: 2/2 each; the other creatures get none', () => {
    expect(manualParts(WITCH)).toEqual([]);
    const RAT = card('Test Old Rat', 'Creature — Rat', '', '{0}', ['1', '1']);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Drain Witch'], battlefield: ['Test Old Rat', BEAR] }, p2: { battlefield: ['Test Old Rat'] }, defs: [WITCH, RAT] });
    const s = castFirst(s0, 'Test Drain Witch', []);
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && charsOfObject(s, s.objects[id]!).subtypes.includes('Rat'));
    expect(mine).toHaveLength(2);
    for (const rat of mine) {
      expect(rolesOn(s, rat)).toEqual(['Wicked']);
      expect(pt(s, rat)).toBe('2/2');
    }
    expect(rolesOn(s, find(s, BEAR, 'battlefield', 'p1'))).toEqual([]);
    expect(roles(s)).toHaveLength(2); // the opponent's Rat gets none
  });
  it('CR 111.10q: when a Wicked Role is put into a graveyard from the battlefield each opponent loses 1 life', () => {
    const SPARK = card('Test Spark Charm', 'Sorcery', 'Create a Sorcerer Role token attached to target creature you control.');
    const s0 = scenario([BEAR], { p1: { hand: ['Test Drain Witch', 'Test Spark Charm'], battlefield: [] }, defs: [WITCH, SPARK] });
    let s = castFirst(s0, 'Test Drain Witch', []);
    const rat = s.zones.battlefield.find((id) => charsOfObject(s, s.objects[id]!).subtypes.includes('Rat'))!;
    expect(rolesOn(s, rat)).toEqual(['Wicked']);
    s = castFirst(s, 'Test Spark Charm', [[obj(rat)]]); // a newer Role replaces it (CR 303.7a)
    expect(rolesOn(s, rat)).toEqual(['Sorcerer']);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
});

describe('CR 608.2f, 111.10j: "For each creature your opponents control, create a Cursed Role token attached to that creature"', () => {
  const ANTICS = card('Test Odd Antics', 'Sorcery', 'For each creature your opponents control, create a Cursed Role token attached to that creature.');
  it('every creature of the opponent becomes 1/1; mine do not', () => {
    expect(manualParts(ANTICS)).toEqual([]);
    const s0 = scenario(['Hill Giant', BEAR], { p1: { hand: ['Test Odd Antics'], battlefield: ['Hill Giant'] }, p2: { battlefield: ['Hill Giant', BEAR] }, defs: [ANTICS] });
    const s = castFirst(s0, 'Test Odd Antics');
    const theirs = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    expect(theirs.map((id) => pt(s, id))).toEqual(['1/1', '1/1']);
    expect(pt(s, find(s, 'Hill Giant', 'battlefield', 'p1'))).toBe('3/3');
    expect(roles(s)).toHaveLength(2);
  });
});

describe('CR 608.2f, 111.10k: "One or two target creatures each gain haste until end of turn. For each of those creatures, create a Monster Role token attached to it."', () => {
  const BRUTES = card('Test Brute Rush', 'Sorcery', 'One or two target creatures each gain haste until end of turn. For each of those creatures, create a Monster Role token attached to it.');
  it('is automated; each chosen creature gets haste and its own Role', () => {
    expect(manualParts(BRUTES)).toEqual([]);
    const s0 = scenario([BEAR, 'Hill Giant'], { p1: { hand: ['Test Brute Rush'], battlefield: [BEAR, 'Hill Giant'] }, defs: [BRUTES] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const giant = find(s0, 'Hill Giant', 'battlefield', 'p1');
    const s = castFirst(s0, 'Test Brute Rush', [[obj(bears), obj(giant)]]);
    expect(rolesOn(s, bears)).toEqual(['Monster']);
    expect(rolesOn(s, giant)).toEqual(['Monster']);
    expect([pt(s, bears), pt(s, giant)]).toEqual(['3/3', '4/4']);
    expect(charsOfObject(s, s.objects[bears]!).keywords.some((k) => k.keyword === 'haste')).toBe(true);
  });
  it('with one target, only that creature gets a Role', () => {
    const s0 = scenario([BEAR, 'Hill Giant'], { p1: { hand: ['Test Brute Rush'], battlefield: [BEAR, 'Hill Giant'] }, defs: [BRUTES] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    const s = castFirst(s0, 'Test Brute Rush', [[obj(bears)]]);
    expect(roles(s)).toHaveLength(1);
    expect(rolesOn(s, bears)).toEqual(['Monster']);
  });
});

describe('CR 400.7, 303.4f: "Return target creature card ... to the battlefield. Create a Young Hero Role token attached to it."', () => {
  const RETURN = card('Test Proud Return', 'Sorcery', 'Return target creature card with mana value 3 or less from your graveyard to the battlefield. Create a Young Hero Role token attached to it.');
  it('is automated; the Role is attached to the creature that returned (a new object)', () => {
    expect(manualParts(RETURN)).toEqual([]);
    const s0 = scenario([BEAR], { p1: { hand: ['Test Proud Return'], graveyard: [BEAR] }, defs: [RETURN] });
    const inYard = find(s0, BEAR, 'graveyard', 'p1');
    const s = castFirst(s0, 'Test Proud Return', [[obj(inYard)]]);
    const back = find(s, BEAR, 'battlefield', 'p1');
    expect(rolesOn(s, back)).toEqual(['Young Hero']);
  });
});

describe('CR 303.4g, 303.4i: a Role whose host is gone is not created', () => {
  const CHARM = card('Test Brute Charm', 'Sorcery', 'Create a Monster Role token attached to target creature you control.');
  it('the target is removed before the spell resolves: the spell is countered on resolution (CR 608.2b) and no Role exists', () => {
    const s0 = scenario([BEAR], { p1: { hand: ['Test Brute Charm'], battlefield: [BEAR] }, defs: [CHARM] });
    const bears = find(s0, BEAR, 'battlefield', 'p1');
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Brute Charm', 'hand', 'p1') }), [[obj(bears)]]);
    s = tweak(s, (t) => { t.zones.battlefield = t.zones.battlefield.filter((id) => id !== bears); t.objects[bears]!.zone = 'graveyard'; t.zones.graveyard['p1']!.push(bears); });
    s = resolveAll(s);
    expect(roles(s)).toEqual([]);
  });
});

describe('the cards of the legal actions stay available (sanity)', () => {
  it('legal() is callable on a scenario with a T39 card', () => {
    const CHARM = card('Test Brute Charm', 'Sorcery', 'Create a Monster Role token attached to target creature you control.');
    const s = scenario([BEAR], { p1: { hand: ['Test Brute Charm'], battlefield: [BEAR] }, defs: [CHARM] });
    expect(legal(s, 'p1', 'cast').length).toBeGreaterThan(0);
  });
});
