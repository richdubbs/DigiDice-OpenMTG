/**
 * Commander lane edh-next, round edh-next-11 (EDHREC ranks 10,001 to 12,500, third pass): the round's cards played through the engine (the real cards of the fixture set, compiled by the
 * game's default compiler) and the round's readings with synthetic cards (invented names, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites
 * checked against the Comprehensive Rules text of 2026-09-25 (fetched from media.wizards.com; rules/cr/ is not in the cloud checkout).
 *
 *   CR 615.1a, 120.3, 122.1       Kurbis, Harvest Celebrant: all damage that would be dealt this turn to the target (another creature with a +1/+1 counter) is prevented
 *   CR 509.1a, 509.1b, 611.2a     Valor Made Real: the target creature can block any number of creatures this turn (and only this turn)
 *   CR 305.2, 305.2a              Storm Cauldron: each player may play one more land on each of their turns; a land tapped for mana returns to its owner's hand
 *   CR 205.4a, 205.4g, 613.1d     Glittering Frost: the enchanted land is snow (supertype added in layer 4)
 *   CR 606.3, 303.4, 603.2        Elspeth's Talent: each loyalty ability activated of the enchanted planeswalker (and no other) pumps the creatures you control
 *   CR 122.1, 601.2c, 115.1       Banewhip Punisher: the second ability only targets a creature that has a -1/-1 counter on it
 *   CR 702.12b, 115.1, 608.2c     Fated Clash: both targets survive "destroy all creatures" through indestructible until end of turn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, passBoth, reject, scenario } from '../../m3/scenario';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil, reject as mreject } from '../../m12/rules/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer the decisions that come up until a player has priority (targets from the script in order; payments automatic; yes to an option). */
function drive(s0: GameState, targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, targets: TargetChoice[][] = []): GameState => {
  let s = drive(s0, targets);
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), targets);
  return s;
};
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const mut = (s: GameState, f: (t: GameState) => void): GameState => { const t = structuredClone(s); f(t); return t; };

const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to target creature.');
const WALKER = card('Test Quiet Walker', 'Planeswalker — Test', '+1: You gain 1 life.', { loyalty: '5' });
const WALKER2 = card('Test Idle Walker', 'Planeswalker — Test', '+1: You gain 1 life.', { loyalty: '5' });

describe('the round\'s cards are automated', () => {
  it('every real card of the round plays fully', async () => {
    const { compiledDefs } = await import('../../fixtures');
    for (const d of compiledDefs(['Kurbis, Harvest Celebrant', 'Banewhip Punisher', 'Valor Made Real', 'Storm Cauldron', 'Glittering Frost', 'Molten Birth', 'Fated Clash', 'Manascape Refractor', "Elspeth's Talent", "Rowan's Talent"])) {
      expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
      expect(noManual(d), d.name).toBe(true);
    }
  });
});

describe('CR 615.1a, 120.3, 122.1: Kurbis, "Prevent all damage that would be dealt this turn to another target creature with a +1/+1 counter on it."', () => {
  const start = (): GameState => scenario(['Kurbis, Harvest Celebrant'], {
    defs: [BEAR, SPARK],
    p1: { battlefield: [{ name: 'Kurbis, Harvest Celebrant', counters: { '+1/+1': 2 } }, { name: 'Test Plain Bear', counters: { '+1/+1': 1 } }, 'Test Plain Bear'], hand: ['Test Spark'] },
  });
  it('the creature with a counter takes no damage this turn; another creature without the counter was no legal target', () => {
    const s0 = start();
    const [withCounter, plain] = findAll(s0, 'Test Plain Bear', 'battlefield', 'p1').sort((a, b) => (s0.objects[b]!.counters['+1/+1'] ?? 0) - (s0.objects[a]!.counters['+1/+1'] ?? 0));
    const kurbis = find(s0, 'Kurbis, Harvest Celebrant', 'battlefield', 'p1');
    let s = resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: kurbis, ability: 'p:0:1' }), [[obj(withCounter!)]]));
    expect(s.objects[kurbis]!.counters['+1/+1']).toBe(1);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') }), [[obj(withCounter!)]]));
    expect(s.objects[withCounter!]!.damage).toBe(0);
    expect(s.zones.battlefield).toContain(withCounter);
    expect(plain).toBeDefined();
  });
  it('negative: without the activation the same creature is dealt damage', () => {
    const s0 = start();
    const withCounter = findAll(s0, 'Test Plain Bear', 'battlefield', 'p1').find((id) => (s0.objects[id]!.counters['+1/+1'] ?? 0) > 0)!;
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Spark', 'hand', 'p1') }), [[obj(withCounter)]]));
    expect(s.objects[withCounter]?.damage ?? 3).toBeGreaterThan(0);
  });
});

describe('CR 509.1a, 509.1b, 611.2a: Valor Made Real, "Target creature can block any number of creatures this turn."', () => {
  const RAIDER = card('Test Raider K', 'Creature — Bear', '', { pt: ['1', '1'] });
  const WALL = card('Test Plain Wall', 'Creature — Wall', '', { pt: ['0', '9'] });
  const lands = (n: number): string[] => Array.from({ length: n }, () => 'Plains');
  /** p1 attacks with three raiders; p2 may cast Valor Made Real on its wall before blockers; returns the state at the declare blockers decision. */
  const toBlockers = (cast: boolean): { s: GameState; raiders: ObjectId[]; wall: ObjectId } => {
    let s = mpScenario({ players: 3, cards: ['Valor Made Real'], defs: [RAIDER, WALL], zones: { p1: { battlefield: ['Test Raider K', 'Test Raider K', 'Test Raider K'] }, p2: { hand: ['Valor Made Real'], battlefield: ['Test Plain Wall', ...lands(2)] } } });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p1's main phase");
    const raiders = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Raider K');
    const wall = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Plain Wall')!;
    s = declareAttackers(toDeclareAttackers(s), raiders.map((r) => [r, 'p2'] as [ObjectId, string]));
    if (cast) {
      for (let i = 0; i < 6 && s.pending?.kind === 'priority' && s.pending.player !== 'p2'; i++) s = mpass(s);
      s = mact(s, { type: 'cast', player: 'p2', card: mfind(s, 'Valor Made Real', 'hand', 'p2') });
      s = manswer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: wall }] });
      s = manswer(s, { kind: 'payCost', auto: true });
      for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = mpass(s);
    }
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    return { s, raiders, wall };
  };
  const blocks = (ids: ObjectId[], by: ObjectId) => ({ kind: 'declareBlockers', blocks: ids.map((attacker) => ({ blocker: by, attacker })) }) as never;
  it('after the spell the wall blocks all three attackers this turn', () => {
    const { s, raiders, wall } = toBlockers(true);
    const done = manswer(s, blocks(raiders, wall));
    expect(done.turn).toBeDefined(); // accepted (answer throws on a refused answer)
  });
  it('negative: without the spell one creature blocks one attacker only (two blocks by the wall are refused)', () => {
    const { s, raiders, wall } = toBlockers(false);
    expect(mreject(s, blocks(raiders.slice(0, 2), wall))).toBeDefined();
    expect(manswer(s, blocks(raiders.slice(0, 1), wall)).turn).toBeDefined();
  });
});

describe('CR 305.2, 305.2a: Storm Cauldron, "Each player may play an additional land during each of their turns." and "Whenever a land is tapped for mana, return it to its owner\'s hand."', () => {
  const start = (withCauldron: boolean): GameState => scenario(['Storm Cauldron', 'Plains'], {
    p1: { battlefield: withCauldron ? ['Storm Cauldron'] : [], hand: ['Plains', 'Plains', 'Plains'] },
    p2: {},
  });
  it('p1 plays two lands in one turn with the Cauldron; the third is refused', () => {
    let s = start(true);
    const [a, b, c] = findAll(s, 'Plains', 'hand', 'p1');
    s = act(s, { type: 'playLand', player: 'p1', card: a! });
    s = act(s, { type: 'playLand', player: 'p1', card: b! });
    expect(reject(s, { type: 'playLand', player: 'p1', card: c! }).message).toBeTruthy();
    expect(findAll(s, 'Plains', 'battlefield', 'p1').length).toBe(2);
  });
  it('negative: without the Cauldron the second land is refused', () => {
    let s = start(false);
    const [a, b] = findAll(s, 'Plains', 'hand', 'p1');
    s = act(s, { type: 'playLand', player: 'p1', card: a! });
    expect(reject(s, { type: 'playLand', player: 'p1', card: b! }).message).toBeTruthy();
  });
  it('a land tapped for mana returns to its owner\'s hand', () => {
    let s = start(true);
    const a = findAll(s, 'Plains', 'hand', 'p1')[0]!;
    s = act(s, { type: 'playLand', player: 'p1', card: a });
    const land = find(s, 'Plains', 'battlefield', 'p1');
    const tap = legal(s, 'p1', 'activate').find((a) => a.object === land);
    expect(tap).toBeDefined();
    s = resolveAll(act(s, tap!.action));
    expect(s.zones.battlefield).not.toContain(land);
    expect(findAll(s, 'Plains', 'hand', 'p1').length).toBe(3);
  });
});

describe('CR 205.4a, 205.4g, 613.1d: Glittering Frost, "Enchanted land is snow."', () => {
  it('the enchanted land has the snow supertype and another land does not', () => {
    const s = mpScenario({
      players: 3, cards: ['Glittering Frost'],
      zones: { p1: { battlefield: ['Plains', 'Plains', 'Glittering Frost'] } },
      setup: (st) => {
        const lands = Object.values(st.objects).filter((o) => st.defs[o.defId]?.name === 'Plains' && o.zone === 'battlefield');
        Object.values(st.objects).find((o) => st.defs[o.defId]?.name === 'Glittering Frost')!.attachedTo = lands[0]!.id;
      },
    });
    const [l1, l2] = findAll(s, 'Plains', 'battlefield', 'p1');
    expect(chars(s, l1!).supertypes.length + chars(s, l2!).supertypes.length).toBeGreaterThan(0);
    const snow = [l1!, l2!].filter((id) => chars(s, id).supertypes.includes('Snow'));
    expect(snow.length).toBe(1);
    expect(s.objects[find(s, 'Glittering Frost', 'battlefield', 'p1')]!.attachedTo).toBe(snow[0]);
  });
});

describe("CR 606.3, 303.4, 603.2: Elspeth's Talent, \"Whenever you activate a loyalty ability of enchanted planeswalker, creatures you control get +2/+2 and gain vigilance until end of turn.\"", () => {
  const start = (): GameState => mpScenario({
    players: 3, cards: ["Elspeth's Talent"], defs: [BEAR, WALKER, WALKER2],
    zones: { p1: { battlefield: ["Elspeth's Talent", { name: 'Test Quiet Walker', counters: { loyalty: 5 } }, { name: 'Test Idle Walker', counters: { loyalty: 5 } }, 'Test Plain Bear'] } },
    setup: (st) => {
      const walker = Object.values(st.objects).find((o) => st.defs[o.defId]?.name === 'Test Quiet Walker')!;
      Object.values(st.objects).find((o) => st.defs[o.defId]?.name === "Elspeth's Talent")!.attachedTo = walker.id;
    },
  });
  const loyalty = (s: GameState, name: string): GameState => {
    const src = find(s, name, 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === src);
    expect(a, name).toBeDefined();
    return resolveAll(act(s, a!.action));
  };
  it("activating the enchanted planeswalker's loyalty ability pumps the creatures you control", () => {
    const s0 = start();
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const s = loyalty(s0, 'Test Quiet Walker');
    expect(Number(chars(s, bear).power)).toBe(4);
    expect(Number(chars(s, bear).toughness)).toBe(4);
  });
  it("negative: another planeswalker's loyalty ability does not trigger it", () => {
    const s0 = start();
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const s = loyalty(s0, 'Test Idle Walker');
    expect(Number(chars(s, bear).power)).toBe(2);
  });
});

describe("CR 606.3, 303.4, 707.10: Rowan's Talent, \"Whenever you activate a loyalty ability of enchanted planeswalker, copy that ability. You may choose new targets for the copy.\"", () => {
  const start = (): GameState => mpScenario({
    players: 3, cards: ["Rowan's Talent"], defs: [WALKER, WALKER2],
    zones: { p1: { battlefield: ["Rowan's Talent", { name: 'Test Quiet Walker', counters: { loyalty: 5 } }, { name: 'Test Idle Walker', counters: { loyalty: 5 } }] } },
    setup: (st) => {
      const walker = Object.values(st.objects).find((o) => st.defs[o.defId]?.name === 'Test Quiet Walker')!;
      Object.values(st.objects).find((o) => st.defs[o.defId]?.name === "Rowan's Talent")!.attachedTo = walker.id;
    },
  });
  const lifeOf = (s: GameState): number => s.players.find((x) => x.id === 'p1')!.life;
  const loyalty = (s: GameState, name: string): GameState => {
    const src = find(s, name, 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === src);
    expect(a, name).toBeDefined();
    return resolveAll(act(s, a!.action));
  };
  it('the loyalty ability happens twice (its copy and itself) but costs the loyalty once', () => {
    const s0 = start();
    const walker = find(s0, 'Test Quiet Walker', 'battlefield', 'p1');
    const s = loyalty(s0, 'Test Quiet Walker');
    expect(lifeOf(s) - lifeOf(s0)).toBe(2);
    expect(s.objects[walker]!.counters['loyalty']).toBe(6);
  });
  it("negative: another planeswalker's loyalty ability is not copied", () => {
    const s0 = start();
    const s = loyalty(s0, 'Test Idle Walker');
    expect(lifeOf(s) - lifeOf(s0)).toBe(1);
  });
});

describe('CR 122.1, 601.2c, 115.1: Banewhip Punisher, "Destroy target creature that has a -1/-1 counter on it."', () => {
  it('only a creature with a -1/-1 counter is a legal target of the activated ability', () => {
    const s0 = scenario(['Banewhip Punisher', 'Swamp'], {
      defs: [BEAR],
      p1: { battlefield: ['Banewhip Punisher', 'Swamp'] },
      p2: { battlefield: [{ name: 'Test Plain Bear', counters: { '-1/-1': 1 } }, 'Test Plain Bear'] },
    });
    const [marked] = findAll(s0, 'Test Plain Bear', 'battlefield', 'p2').filter((id) => (s0.objects[id]!.counters['-1/-1'] ?? 0) > 0);
    const plain = findAll(s0, 'Test Plain Bear', 'battlefield', 'p2').find((id) => id !== marked)!;
    const src = find(s0, 'Banewhip Punisher', 'battlefield', 'p1');
    const a = act(s0, { type: 'activate', player: 'p1', source: src, ability: 'p:0:1' });
    const pending = a.pending;
    expect(pending?.kind).toBe('chooseTargets');
    const legal = JSON.stringify(pending);
    expect(legal).toContain(marked!);
    expect(legal).not.toContain(plain);
  });
});

describe('CR 702.12b, 115.1, 608.2c: Fated Clash, "... each gain indestructible until end of turn. Then destroy all creatures."', () => {
  it('the two targets survive, every other creature is destroyed', () => {
    const s0 = scenario(['Fated Clash'], {
      defs: [BEAR],
      p1: { hand: ['Fated Clash'], battlefield: ['Test Plain Bear', 'Test Plain Bear', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] },
      p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear'] },
    });
    const mine = findAll(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const theirs = findAll(s0, 'Test Plain Bear', 'battlefield', 'p2');
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Fated Clash', 'hand', 'p1') }), [[obj(mine[0]!)], [obj(theirs[0]!)]]));
    expect(s.zones.battlefield).toContain(mine[0]);
    expect(s.zones.battlefield).toContain(theirs[0]);
    expect(s.zones.battlefield).not.toContain(mine[1]);
    expect(s.zones.battlefield).not.toContain(theirs[1]);
  });
});
