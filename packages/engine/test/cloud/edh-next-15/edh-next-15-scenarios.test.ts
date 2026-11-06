/**
 * Commander lane edh-next, round edh-next-15: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked
 * against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 702.122a            "~ crews Vehicles using its toughness rather than its power" (crew costs only, never a saddle cost)
 *   CR 120.1, 120.3, 608.2h "Each creature deals damage to itself equal to its power." / "Each of those creatures deals damage equal to its power to ~."
 *   CR 119.3, 608.2h       "Target opponent loses N life for each ... You gain that much life." (the life actually lost)
 *   CR 608.2c, 120.3       "~ deals 2 damage to any target. If a player is dealt damage this way, scry 1."
 *   CR 120.1, 603.2        "Whenever ~ deals damage to a creature or opponent, ~ deals that much damage to you."
 *   CR 205.4a, 613.1d      "Enchanted land is snow." (the reading is edh-next-11's; played here for Glittering Frost)
 *   CR 111.2, 110.5b       "You and target opponent each create a tapped Powerstone token."
 *   CR 614.1c, 122.6       "~ enters with a number of loyalty counters on him equal to the number of lands you control."
 *   CR 122.1, 306.5, 608.2c "Put five +1/+1 counters on each creature you control and five loyalty counters on each other planeswalker you control."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { crewSaddleValue } from '../../../src/statics/hooks';
import { act, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';

type Pick = { kind: 'object'; id: ObjectId } | { kind: 'player'; id: 'p1' | 'p2' };

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d).length === 0;
const obj = (id: ObjectId): Pick => ({ kind: 'object', id });
const plr = (id: 'p1' | 'p2'): Pick => ({ kind: 'player', id });

/** Answer the decisions a card asks (costs paid automatically, the given targets and division) and pass priority until the stack is empty. */
function drive(s0: GameState, o: { targets?: Pick[][]; division?: number[] } = {}): { s: GameState; asked: string[] } {
  let s = s0;
  const asked: string[] = [];
  const targets = [...(o.targets ?? [])];
  for (let g = 0; g < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
    const p = s.pending!;
    if (p.kind === 'priority') { s = pass(s); continue; }
    asked.push(`${p.kind}:${(p as { prompt?: string }).prompt ?? ''}`);
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'chooseDivision') s = answer(s, { kind: 'chooseDivision', amounts: o.division! } as DecisionAnswer);
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) } as DecisionAnswer);
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [] });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else throw new Error(`unexpected decision ${p.kind}: ${(p as { prompt?: string }).prompt}`);
  }
  return { s, asked };
}
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}): ReturnType<typeof drive> => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never), o);
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

// ---------------------------------------------------------------------------------------------------------------------------------
// "~ crews Vehicles using its toughness rather than its power." (CR 702.122a)
// ---------------------------------------------------------------------------------------------------------------------------------
const OX = card('Test Ox', 'Creature — Ox', 'Defender\nTest Ox crews Vehicles using its toughness rather than its power.', { pt: ['0', '4'] });
const WALL0 = card('Test Wall Zero', 'Creature — Wall', 'Defender', { pt: ['0', '4'] });
const CART = card('Test Cart', 'Artifact — Vehicle', 'Crew 3', { pt: ['4', '4'] });
const MOUNT = card('Test Mount', 'Creature — Horse Mount', 'Saddle 3', { pt: ['2', '2'] });
const activations = (s: GameState, id: ObjectId) => legal(s, 'p1', 'activate').filter((a) => a.object === id && !a.isMana);

describe('CR 702.122a: "~ crews Vehicles using its toughness rather than its power."', () => {
  it('is fully automated', () => expect(full(OX)).toBe(true));
  it('a 0/4 Ox crews a Crew 3 Vehicle alone (it counts its toughness, 4)', () => {
    const s0 = scenario([], { defs: [OX, CART], p1: { battlefield: ['Test Ox', 'Test Cart'] } });
    const cart = find(s0, 'Test Cart', 'battlefield');
    const ox = find(s0, 'Test Ox', 'battlefield');
    expect(activations(s0, cart).length).toBe(1);
    let s = act(s0, activations(s0, cart)[0]!.action);
    for (let g = 0; s.pending && s.pending.kind !== 'priority' && g < 10; g++) s = s.pending.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: [ox] }) : answer(s, { kind: 'payCost', auto: true });
    s = drive(s).s;
    expect(getChars(s, cart)!.types).toContain('Creature');
  });
  it('negative: a plain 0/4 wall does not crew 3 (it counts its power, 0)', () => {
    const s0 = scenario([], { defs: [WALL0, CART], p1: { battlefield: ['Test Wall Zero', 'Test Cart'] } });
    expect(activations(s0, find(s0, 'Test Cart', 'battlefield'))).toEqual([]);
  });
  it('negative: the rule is for crew costs only: the Ox counts its power (0) for a saddle cost', () => {
    const s0 = scenario([], { defs: [OX, MOUNT], p1: { battlefield: ['Test Ox', 'Test Mount'] } });
    const ox = find(s0, 'Test Ox', 'battlefield');
    const c = getChars(s0, ox)!;
    expect(crewSaddleValue(s0, ox, c, 'crew')).toBe(4);
    expect(crewSaddleValue(s0, ox, c, 'saddle')).toBe(0);
    expect(activations(s0, find(s0, 'Test Mount', 'battlefield'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Each creature deals damage to itself equal to its power." (CR 120.1, 120.3, 608.2h)
// ---------------------------------------------------------------------------------------------------------------------------------
const BLAZE = card('Test Blaze', 'Sorcery', 'Each creature deals damage to itself equal to its power.');
const THREE = card('Test Three', 'Creature — Giant', '', { pt: ['3', '3'] });
const TOUGH = card('Test Tough', 'Creature — Turtle', '', { pt: ['2', '5'] });
const NOPOWER = card('Test No Power', 'Creature — Wall', '', { pt: ['0', '1'] });

describe('CR 120.3, 608.2h: "Each creature deals damage to itself equal to its power."', () => {
  const board = (): GameState => scenario([], { defs: [BLAZE, THREE, TOUGH, NOPOWER], p1: { hand: ['Test Blaze'], battlefield: ['Test Three', 'Test No Power'] }, p2: { battlefield: ['Test Tough'] } });
  it('is fully automated', () => expect(full(BLAZE)).toBe(true));
  it('every creature of every player is damaged by its own power: the 3/3 dies, the 2/5 has 2 damage, the 0/1 none', () => {
    const { s } = cast(board(), 'Test Blaze');
    expect(findAll(s, 'Test Three', 'graveyard', 'p1').length).toBe(1);
    expect(s.objects[find(s, 'Test Tough', 'battlefield', 'p2')]!.damage).toBe(2);
    expect(s.objects[find(s, 'Test No Power', 'battlefield', 'p1')]!.damage).toBe(0);
  });
  it('negative: nothing but creatures is touched (a noncreature permanent has no power to deal)', () => {
    const rod = card('Test Rod', 'Artifact', '');
    const s0 = scenario([], { defs: [BLAZE, TOUGH, rod], p1: { hand: ['Test Blaze'], battlefield: ['Test Rod'] }, p2: { battlefield: ['Test Tough'] } });
    const { s } = cast(s0, 'Test Blaze');
    expect(s.objects[find(s, 'Test Rod', 'battlefield', 'p1')]!.damage).toBe(0);
    expect(life(s, 'p1')).toBe(20);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Each of those creatures deals damage equal to its power to ~." (CR 120.3, 608.2h)
// ---------------------------------------------------------------------------------------------------------------------------------
const EATER = card('Test Eater', 'Creature — Giant', 'When this creature enters, it deals 3 damage divided as you choose among any number of target creatures your opponents control. Each of those creatures deals damage equal to its power to this creature.', { pt: ['2', '9'] });
const TWO = card('Test Two', 'Creature — Elf', '', { pt: ['2', '4'] });

describe('CR 120.3, 608.2h: "Each of those creatures deals damage equal to its power to ~."', () => {
  const board = (): GameState => scenario([], { defs: [EATER, THREE, TWO], p1: { hand: ['Test Eater'] }, p2: { battlefield: ['Test Three', 'Test Two'] } });
  it('is fully automated', () => expect(full(EATER)).toBe(true));
  it('the two creatures it damaged each deal their own power back: 3 + 2 = 5 damage to the Eater', () => {
    const s0 = board();
    const targets = [find(s0, 'Test Three', 'battlefield', 'p2'), find(s0, 'Test Two', 'battlefield', 'p2')];
    const { s } = cast(s0, 'Test Eater', { targets: [targets.map(obj)], division: [1, 2] });
    expect(s.objects[find(s, 'Test Eater', 'battlefield', 'p1')]!.damage).toBe(5);
    expect(targets.map((id) => s.objects[id]!.damage)).toEqual([1, 2]);
  });
  it('negative: with no creature chosen nothing deals damage to it', () => {
    const { s } = cast(board(), 'Test Eater', { targets: [[]] });
    expect(s.objects[find(s, 'Test Eater', 'battlefield', 'p1')]!.damage).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Target opponent loses 1 life for each creature you control. You gain that much life." (CR 119.3, 608.2h)
// ---------------------------------------------------------------------------------------------------------------------------------
const SHRIEK = card('Test Shriek', 'Sorcery', 'Target opponent loses 1 life for each creature you control. You gain that much life.');
const DRAIN = card('Test Drain', 'Sorcery', 'Target opponent loses 3 life. You gain that much life.');

describe('CR 119.3, 608.2h: "Target opponent loses N life ... You gain that much life."', () => {
  it('both are fully automated', () => { expect(full(SHRIEK)).toBe(true); expect(full(DRAIN)).toBe(true); });
  it('the life the opponent lost is the life you gain (three creatures: 3 each way)', () => {
    const s0 = scenario([], { defs: [SHRIEK, THREE, TWO, TOUGH], p1: { hand: ['Test Shriek'], battlefield: ['Test Three', 'Test Two', 'Test Tough'] } });
    const { s } = cast(s0, 'Test Shriek', { targets: [[plr('p2')]] });
    expect(life(s, 'p2')).toBe(17);
    expect(life(s, 'p1')).toBe(23);
  });
  it('a fixed loss works the same (3 lost, 3 gained)', () => {
    const s0 = scenario([], { defs: [DRAIN], p1: { hand: ['Test Drain'] } });
    const { s } = cast(s0, 'Test Drain', { targets: [[plr('p2')]] });
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([23, 17]);
  });
  it('negative: a loss of nothing gains nothing (no creatures: the opponent loses 0 life, so you gain 0)', () => {
    const s0 = scenario([], { defs: [SHRIEK], p1: { hand: ['Test Shriek'] } });
    const { s } = cast(s0, 'Test Shriek', { targets: [[plr('p2')]] });
    expect([life(s, 'p1'), life(s, 'p2')]).toEqual([20, 20]);
  });
  it('negative: "that much" after two losses of life is ambiguous and stays manual', () => {
    const two = card('Test Two Losses', 'Sorcery', 'Target opponent loses 3 life. You lose 1 life. You gain that much life.');
    expect(full(two)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "If a player is dealt damage this way, scry 1." (CR 608.2c, 120.3)
// ---------------------------------------------------------------------------------------------------------------------------------
const FLAME = card('Test Flame', 'Instant', 'Test Flame deals 2 damage to any target. If a player is dealt damage this way, scry 1.');

describe('CR 608.2c, 120.3: "~ deals 2 damage to any target. If a player is dealt damage this way, scry 1."', () => {
  const board = (): GameState => scenario([], { defs: [FLAME, TOUGH], p1: { hand: ['Test Flame'] }, p2: { battlefield: ['Test Tough'] } });
  it('is fully automated', () => expect(full(FLAME)).toBe(true));
  it('damage to a player: 2 damage and a scry', () => {
    const s0 = board();
    const r = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Flame', 'hand', 'p1') } as never), { targets: [[plr('p2')]] });
    expect(life(r.s, 'p2')).toBe(18);
    expect(r.asked.some((a) => /scry|top/i.test(a))).toBe(true);
  });
  it('negative: damage to a creature only is no scry', () => {
    const s0 = board();
    const r = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Flame', 'hand', 'p1') } as never), { targets: [[obj(find(s0, 'Test Tough', 'battlefield', 'p2'))]] });
    expect(r.s.objects[find(r.s, 'Test Tough', 'battlefield', 'p2')]!.damage).toBe(2);
    expect(r.asked.some((a) => /scry|top/i.test(a))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Whenever ~ deals damage to a creature or opponent, ~ deals that much damage to you." (CR 120.1, 603.2)
// ---------------------------------------------------------------------------------------------------------------------------------
const REAVER = card('Test Reaver', 'Creature — Zombie', '{0}: Test Reaver deals 2 damage to target creature or player.\nWhenever this creature deals damage to a creature or opponent, this creature deals that much damage to you.', { pt: ['2', '2'] });

describe('CR 120.1, 603.2: "Whenever ~ deals damage to a creature or opponent, ~ deals that much damage to you."', () => {
  const board = (): GameState => scenario([], { defs: [REAVER, TOUGH], p1: { battlefield: ['Test Reaver'] }, p2: { battlefield: ['Test Tough'] } });
  const ping = (s0: GameState, target: Pick): GameState => {
    const ability = legal(s0, 'p1', 'activate').find((a) => a.object === find(s0, 'Test Reaver', 'battlefield') && !a.isMana)!;
    return drive(act(s0, ability.action), { targets: [[target]] }).s;
  };
  it('is fully automated', () => expect(full(REAVER)).toBe(true));
  it('damage to a creature: Alice is dealt that much damage', () => {
    const s0 = board();
    const s = ping(s0, obj(find(s0, 'Test Tough', 'battlefield', 'p2')));
    expect(life(s, 'p1')).toBe(18);
  });
  it('damage to an opponent: Alice is dealt that much damage', () => {
    const s = ping(board(), { kind: 'player', id: 'p2' });
    expect(life(s, 'p2')).toBe(18);
    expect(life(s, 'p1')).toBe(18);
  });
  it('negative: damage to Alice herself is no opponent: no more damage to her', () => {
    const s = ping(board(), { kind: 'player', id: 'p1' });
    expect(life(s, 'p1')).toBe(18);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Enchanted land is snow." (CR 205.4a, 613.1d)
// ---------------------------------------------------------------------------------------------------------------------------------
const FROST = card('Test Frost', 'Enchantment — Aura', 'Enchant land\nEnchanted land is snow.');

describe('CR 205.4a, 613.1d: "Enchanted land is snow."', () => {
  it('is fully automated', () => expect(full(FROST)).toBe(true));
  const enchanted = (): { s: GameState; a: ObjectId; b: ObjectId } => {
    const s0 = scenario([], { defs: [FROST], p1: { hand: ['Test Frost'], battlefield: ['Plains', 'Plains'] } });
    const [a, b] = findAll(s0, 'Plains', 'battlefield', 'p1') as [ObjectId, ObjectId];
    return { s: drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Frost', 'hand', 'p1') } as never), { targets: [[obj(a)]] }).s, a, b };
  };
  it('the enchanted land gains the supertype Snow; a land that is not enchanted does not', () => {
    const { s, a, b } = enchanted();
    expect(getChars(s, a)!.supertypes).toContain('Snow');
    expect(getChars(s, b)!.supertypes).not.toContain('Snow');
  });
  it('negative: it is a supertype only: the land is still a Plains land', () => {
    const { s, a } = enchanted();
    const c = getChars(s, a)!;
    expect(c.types).toContain('Land');
    expect(c.subtypes).toContain('Plains');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "You and target opponent each create a tapped Powerstone token." (CR 111.2, 110.5b)
// ---------------------------------------------------------------------------------------------------------------------------------
const SPIDER = card('Test Spider', 'Artifact Creature — Spider', 'When this creature enters, you and target opponent each create a tapped Powerstone token.', { pt: ['2', '2'] });

describe('CR 111.2, 110.5b: "You and target opponent each create a tapped Powerstone token."', () => {
  it('is fully automated', () => expect(full(SPIDER)).toBe(true));
  it('each of the two players gets a tapped Powerstone token under their own control', () => {
    const s0 = scenario([], { defs: [SPIDER], p1: { hand: ['Test Spider'] } });
    const { s } = cast(s0, 'Test Spider', { targets: [[plr('p2')]] });
    const mine = Object.values(s.objects).filter((o) => o.kind === 'token' && o.zone === 'battlefield' && o.controller === 'p1');
    const theirs = Object.values(s.objects).filter((o) => o.kind === 'token' && o.zone === 'battlefield' && o.controller === 'p2');
    expect(mine.length).toBe(1);
    expect(theirs.length).toBe(1);
    expect(mine[0]!.tapped && theirs[0]!.tapped).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "~ enters with a number of loyalty counters on him equal to the number of lands you control." (CR 614.1c, 122.6)
// ---------------------------------------------------------------------------------------------------------------------------------
const SLAYER = card('Test Slayer', 'Legendary Planeswalker — Slayer', 'Test Slayer enters with a number of loyalty counters on him equal to the number of lands you control.\n+1: You gain 1 life.', { loyalty: '0' });

describe('CR 614.1c, 122.6: "~ enters with a number of loyalty counters on him equal to the number of lands you control."', () => {
  it('is fully automated', () => expect(full(SLAYER)).toBe(true));
  it('with three lands it enters with three loyalty counters; with one land, one', () => {
    for (const lands of [3, 1]) {
      const s0 = scenario([], { defs: [SLAYER], p1: { hand: ['Test Slayer'], battlefield: Array<string>(lands).fill('Plains') } });
      const { s } = cast(s0, 'Test Slayer');
      expect(s.objects[find(s, 'Test Slayer', 'battlefield', 'p1')]!.counters['loyalty']).toBe(lands);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// "Put five +1/+1 counters on each creature you control and five loyalty counters on each other planeswalker you control." (CR 122.1, 306.5)
// ---------------------------------------------------------------------------------------------------------------------------------
const BANNER = card('Test Banner', 'Planeswalker — Banner', '−1: Put five +1/+1 counters on each creature you control and five loyalty counters on each other planeswalker you control.', { loyalty: '6' });
const OTHERWALKER = card('Test Other Walker', 'Planeswalker — Other', '', { loyalty: '2' });

describe('CR 122.1, 306.5, 608.2c: "Put five +1/+1 counters on each creature you control and five loyalty counters on each other planeswalker you control."', () => {
  it('is fully automated', () => expect(full(BANNER)).toBe(true));
  it('your creatures get five +1/+1 counters, your other planeswalkers five loyalty counters; the source and the opponent\'s permanents get none', () => {
    const s0 = scenario([], { defs: [BANNER, OTHERWALKER, THREE, TOUGH], p1: { battlefield: [{ name: 'Test Banner', counters: { loyalty: 6 } }, { name: 'Test Other Walker', counters: { loyalty: 2 } }, 'Test Three'] }, p2: { battlefield: ['Test Tough'] } });
    const { s } = drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Banner', 'battlefield', 'p1'), ability: 'p:0:0' } as never));
    expect(s.objects[find(s, 'Test Three', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(5);
    expect(s.objects[find(s, 'Test Tough', 'battlefield', 'p2')]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(s.objects[find(s, 'Test Other Walker', 'battlefield', 'p1')]!.counters['loyalty']).toBe(7);
    expect(s.objects[find(s, 'Test Banner', 'battlefield', 'p1')]!.counters['loyalty']).toBe(5); // 6 - 1, no counters from its own ability
  });
});
