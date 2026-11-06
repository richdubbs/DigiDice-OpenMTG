/**
 * Commander lane edh-next, round edh-next-47: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 605.3b, 118.3, 608.2h  a mana ability whose amount reads the sacrificed creature's mana value (Illuminor Szeras, Soldevi Adnate)
 *   CR 105.2, 205.2a          "a black or artifact creature" as a sacrifice cost (Soldevi Adnate)
 *   CR 700.6, 608.2h, 603.4   "if it was historic" (Curator's Ward)
 *   CR 400.3, 603.2c          "a creature card is put into a graveyard from a library" (Dreadhound)
 *   CR 400.3, 603.6a          "a land you control enters from anywhere other than your hand" (The Lost and the Damned)
 *   CR 603.4, 207.2c          "if you had another creature enter the battlefield under your control last turn" (Ephara, God of the Polis)
 *   CR 701.9a, 603.4          "if an opponent discarded a card this turn" (Tinybones, Trinket Thief)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type Color, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, pool, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
const resolveAll = (s0: GameState, yes = true): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 60 && s.pending !== null && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); g++) {
    const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number };
    if (d.kind === 'priority') s = settle(pass(s));
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) } as DecisionAnswer);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes } as DecisionAnswer);
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] } as DecisionAnswer);
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.options ?? []).slice(0, Math.max(1, d.min ?? 1)) } as DecisionAnswer);
    else s = settle(s);
  }
  return s;
};
const cast = (s: GameState, name: string): GameState => resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never)));
const handCount = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const onBf = (s: GameState, n: string): boolean => s.zones.battlefield.some((id) => nameOf(s, id) === n);
const FILLER = (n: number): string[] => Array.from({ length: n }, () => 'Test Filler');
const FILLER_CARD = card('Test Filler', 'Sorcery', '');

describe('CR 605.3b, 118.3, 608.2h: a mana ability reads the mana value of the creature its cost sacrificed', () => {
  const ADNATE = card('Test Mourner', 'Creature — Human Cleric', '{T}, Sacrifice a black or artifact creature: Add an amount of {B} equal to the sacrificed creature\'s mana value.', { pt: ['1', '1'] });
  const SZERAS = card('Test Reaper', 'Artifact Creature — Necron', '{T}, Sacrifice another creature: Add an amount of {B} equal to the sacrificed creature\'s mana value.', { pt: ['1', '1'] });
  const BLACK3 = card('Test Black Three', 'Creature — Zombie', '', { cost: '{2}{B}', colors: ['B'], pt: ['2', '2'] });
  const GREEN2 = card('Test Green Two', 'Creature — Elf', '', { cost: '{1}{G}', colors: ['G'], pt: ['2', '2'] });
  const GOLEM4 = card('Test Golem Four', 'Artifact Creature — Golem', '', { cost: '{4}', pt: ['3', '3'] });
  const DEFS = [ADNATE, SZERAS, BLACK3, GREEN2, GOLEM4];
  const manaAct = (s: GameState, src: string) => legal(s, 'p1', 'activate').find((x) => x.object === find(s, src, 'battlefield', 'p1') && x.isMana === true);
  const run = (s: GameState, src: string, victim: string): GameState => {
    const a = manaAct(s, src);
    if (a === undefined) throw new Error('not offered');
    let t = act(s, a.action);
    for (let g = 0; g < 5 && t.pending !== null && t.pending.kind !== 'priority'; g++) {
      const d = t.pending as unknown as { kind: string; options?: ObjectId[] };
      if (d.kind === 'chooseObjects') t = answer(t, { kind: 'chooseObjects', ids: [find(s, victim, 'battlefield', 'p1')] } as DecisionAnswer);
      else break;
    }
    return t;
  };
  it('are automated', () => {
    expect(noManual(ADNATE)).toEqual([]);
    expect(noManual(SZERAS)).toEqual([]);
  });
  it('sacrificing a mana value 3 creature adds BBB, a mana value 4 artifact creature adds BBBB (last known information, CR 608.2h), and the sacrificed creature is gone', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Reaper', 'Test Black Three'] } });
    const t = run(s, 'Test Reaper', 'Test Black Three');
    expect(pool(t, 'p1')).toBe('BBB');
    expect(onBf(t, 'Test Black Three')).toBe(false);
    const s2 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Reaper', 'Test Golem Four'] } });
    expect(pool(run(s2, 'Test Reaper', 'Test Golem Four'), 'p1')).toBe('BBBB');
  });
  it('"another creature": with no other creature the ability can\'t be activated (the source can\'t sacrifice itself, CR 118.3)', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Reaper'] } });
    expect(manaAct(s, 'Test Reaper')).toBeUndefined();
  });
  it('"a black or artifact creature": a black creature and an artifact creature can be sacrificed, a green non-artifact creature can\'t', () => {
    const black = scenario([], { defs: DEFS, p1: { battlefield: ['Test Mourner', 'Test Black Three'] } });
    expect(pool(run(black, 'Test Mourner', 'Test Black Three'), 'p1')).toBe('BBB');
    const art = scenario([], { defs: DEFS, p1: { battlefield: ['Test Mourner', 'Test Golem Four'] } });
    expect(pool(run(art, 'Test Mourner', 'Test Golem Four'), 'p1')).toBe('BBBB');
    const green = scenario([], { defs: DEFS, p1: { battlefield: ['Test Green Two'] } });
    const g2 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Mourner', 'Test Green Two'] } });
    expect(green.zones.battlefield.length).toBe(1);
    expect(manaAct(g2, 'Test Mourner')).toBeUndefined();
  });
  it('a black Mourner can sacrifice itself (it is a black creature): {T}, sacrifice, adds BB for its mana value 2', () => {
    const SELF = card('Test Black Mourner', 'Creature — Human Cleric', '{T}, Sacrifice a black or artifact creature: Add an amount of {B} equal to the sacrificed creature\'s mana value.', { cost: '{1}{B}', colors: ['B'], pt: ['1', '1'] });
    const s = scenario([], { defs: [SELF], p1: { battlefield: ['Test Black Mourner'] } });
    expect(pool(run(s, 'Test Black Mourner', 'Test Black Mourner'), 'p1')).toBe('BB');
  });
  it('the Mourner itself (a green-less, non-artifact Cleric) is not a legal sacrifice either: with only itself, nothing is offered', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Mourner'] } });
    expect(manaAct(s, 'Test Mourner')).toBeUndefined();
  });
});

describe('CR 700.6, 608.2h, 603.4: "if it was historic"', () => {
  const WARD = card('Test Chronicle', 'Enchantment', 'Whenever a creature you control dies, if it was historic, draw a card.');
  const LEGEND = card('Test Legend', 'Legendary Creature — Elf', '', { pt: ['1', '1'] });
  const PLAIN = card('Test Plain', 'Creature — Elf', '', { pt: ['1', '1'] });
  const KILL = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  it('is automated', () => { expect(noManual(WARD)).toEqual([]); });
  const kill = (victim: string): GameState => {
    const s = scenario([], { defs: [WARD, LEGEND, PLAIN, KILL, FILLER_CARD], p1: { hand: ['Test Smite'], battlefield: ['Test Chronicle', victim], library: FILLER(3) } });
    const t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') } as never));
    let u = t;
    for (let g = 0; g < 40 && u.pending !== null && !(u.pending.kind === 'priority' && u.zones.stack.length === 0); g++) {
      const d = u.pending as unknown as { kind: string };
      if (d.kind === 'chooseTargets') u = answer(u, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, victim, 'battlefield', 'p1') }] } as DecisionAnswer);
      else if (d.kind === 'priority') u = settle(pass(u));
      else u = settle(u);
    }
    return u;
  };
  it('a legendary creature that dies (read as it last existed) draws a card; a plain creature does not', () => {
    const before = scenario([], { defs: [WARD, LEGEND, PLAIN, KILL, FILLER_CARD], p1: { hand: ['Test Smite'], battlefield: ['Test Chronicle', 'Test Legend'], library: FILLER(3) } });
    expect(handCount(kill('Test Legend'), 'p1')).toBe(handCount(before, 'p1') - 1 + 1);
    expect(handCount(kill('Test Plain'), 'p1')).toBe(handCount(before, 'p1') - 1);
  });
});

describe('CR 400.3, 603.2c: "a creature card is put into a graveyard from a library"', () => {
  const HOUND = card('Test Hound', 'Creature — Dog', 'Whenever a creature card is put into a graveyard from a library, each opponent loses 1 life.', { pt: ['1', '1'] });
  const MILL = card('Test Mill', 'Sorcery', 'Target player mills two cards.');
  const GRUB = card('Test Grub', 'Creature — Insect', '', { pt: ['1', '1'] });
  const RUNE = card('Test Rune', 'Artifact', '');
  const DISC = card('Test Discard', 'Sorcery', 'Discard a card.');
  const DEFS = [HOUND, MILL, GRUB, RUNE, DISC];
  it('is automated', () => { expect(noManual(HOUND)).toEqual([]); });
  it('milling two creature cards from either library costs each opponent 1 life per card; milling an artifact does not; a creature card discarded from a hand does not', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Mill'], battlefield: ['Test Hound'] }, p2: { library: ['Test Grub', 'Test Grub', 'Test Rune'] } });
    const t = cast(s, 'Test Mill');
    expect(life(t, 'p2')).toBe(life(s, 'p2') - 2);
    const s2 = scenario([], { defs: DEFS, p1: { hand: ['Test Mill'], battlefield: ['Test Hound'] }, p2: { library: ['Test Rune', 'Test Rune', 'Test Grub'] } });
    expect(life(cast(s2, 'Test Mill'), 'p2')).toBe(life(s2, 'p2'));
    const s3 = scenario([], { defs: DEFS, p1: { hand: ['Test Discard', 'Test Grub'], battlefield: ['Test Hound'] } });
    expect(life(cast(s3, 'Test Discard'), 'p2')).toBe(life(s3, 'p2'));
  });
});

describe('CR 400.3, 603.6a: "a land you control enters from anywhere other than your hand"', () => {
  const LOST = card('Test Spawner', 'Enchantment', 'Whenever a land you control enters from anywhere other than your hand, you gain 1 life.');
  const DIG = card('Test Dig', 'Sorcery', 'Return target land card from your graveyard to the battlefield.');
  const MOOR = card('Test Moor', 'Land', '');
  it('is automated', () => { expect(noManual(LOST)).toEqual([]); });
  it('a land returned from the graveyard gains 1 life; a land played from the hand does not', () => {
    const s = scenario([], { defs: [LOST, DIG, MOOR], p1: { hand: ['Test Dig'], graveyard: ['Test Moor'], battlefield: ['Test Spawner'] } });
    let t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dig', 'hand', 'p1') } as never));
    for (let g = 0; g < 40 && t.pending !== null && !(t.pending.kind === 'priority' && t.zones.stack.length === 0); g++) {
      const d = t.pending as unknown as { kind: string };
      if (d.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Moor', 'graveyard', 'p1') }] } as DecisionAnswer);
      else if (d.kind === 'priority') t = settle(pass(t));
      else t = settle(t);
    }
    expect(life(t, 'p1')).toBe(life(s, 'p1') + 1);
    const h = scenario([], { defs: [LOST, MOOR], p1: { hand: ['Test Moor'], battlefield: ['Test Spawner'] } });
    const play = legal(h, 'p1', 'playLand')[0]!;
    expect(life(resolveAll(act(h, play.action)), 'p1')).toBe(life(h, 'p1'));
  });
});

describe('CR 111.1, 603.6a: a land token you create enters from no zone, so it enters "from anywhere other than your hand" (review finding)', () => {
  const LOST = card('Test Spawner', 'Enchantment', 'Whenever a land you control enters from anywhere other than your hand, you gain 1 life.');
  const COPY = card('Test Echo', 'Sorcery', 'Create a token that\'s a copy of target land you control.');
  const MOOR = card('Test Moor', 'Land', '');
  it('a token copy of a land gains 1 life', () => {
    const s = scenario([], { defs: [LOST, COPY, MOOR], p1: { hand: ['Test Echo'], battlefield: ['Test Spawner', 'Test Moor'] } });
    let t = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Echo', 'hand', 'p1') } as never));
    for (let g = 0; g < 40 && t.pending !== null && !(t.pending.kind === 'priority' && t.zones.stack.length === 0); g++) {
      const d = t.pending as unknown as { kind: string };
      if (d.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Moor', 'battlefield', 'p1') }] } as DecisionAnswer);
      else if (d.kind === 'priority') t = settle(pass(t));
      else t = settle(t);
    }
    expect(life(t, 'p1')).toBe(life(s, 'p1') + 1);
  });
});

describe('CR 603.4, 207.2c: "if you had another creature enter the battlefield under your control last turn"', () => {
  const GOD = card('Test Patron', 'Enchantment', 'At the beginning of each upkeep, if you had another creature enter the battlefield under your control last turn, you gain 1 life.');
  const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'] });
  it('is automated', () => { expect(noManual(GOD)).toEqual([]); });
  it('a creature cast on turn 1 gives life at the turn 2 upkeep, and no more at the turn 3 upkeep (last turn is then turn 2)', () => {
    const s = scenario([], { defs: [GOD, CUB, FILLER_CARD], p1: { hand: ['Test Cub'], battlefield: ['Test Patron'], library: FILLER(6) }, p2: { library: FILLER(6) } });
    const base = life(s, 'p1');
    const cast1 = cast(s, 'Test Cub');
    const t2 = resolveAll(advanceTo(cast1, 2, 'upkeep'));
    expect(life(t2, 'p1')).toBe(base + 1);
    const t3 = resolveAll(advanceTo(t2, 3, 'upkeep'));
    expect(life(t3, 'p1')).toBe(base + 1);
  });
  it('negative: with no creature entering on turn 1, the turn 2 upkeep gives nothing', () => {
    const s = scenario([], { defs: [GOD, CUB, FILLER_CARD], p1: { battlefield: ['Test Patron'], library: FILLER(6) }, p2: { library: FILLER(6) } });
    expect(life(resolveAll(advanceTo(s, 2, 'upkeep')), 'p1')).toBe(life(s, 'p1'));
  });
});

describe('CR 701.9a, 603.4: "if an opponent discarded a card this turn"', () => {
  const BONES = card('Test Bones', 'Creature — Skeleton', 'At the beginning of each end step, if an opponent discarded a card this turn, you gain 1 life.', { pt: ['1', '1'] });
  const MAKE = card('Test Mind Rot', 'Sorcery', 'Target player discards a card.');
  const OWN = card('Test Regret', 'Sorcery', 'Discard a card.');
  it('is automated', () => { expect(noManual(BONES)).toEqual([]); });
  it('the opponent discarding gives 1 life at the end step; discarding yourself does not', () => {
    const s = scenario([], { defs: [BONES, MAKE, OWN, FILLER_CARD], p1: { hand: ['Test Mind Rot'], battlefield: ['Test Bones'] }, p2: { hand: ['Test Filler'] } });
    const t = advanceTo(cast(s, 'Test Mind Rot'), 1, 'end');
    expect(life(resolveAll(t), 'p1')).toBe(life(s, 'p1') + 1);
    const s2 = scenario([], { defs: [BONES, MAKE, OWN, FILLER_CARD], p1: { hand: ['Test Regret', 'Test Filler'], battlefield: ['Test Bones'] } });
    const t2 = advanceTo(cast(s2, 'Test Regret'), 1, 'end');
    expect(life(resolveAll(t2), 'p1')).toBe(life(s2, 'p1'));
  });
});
