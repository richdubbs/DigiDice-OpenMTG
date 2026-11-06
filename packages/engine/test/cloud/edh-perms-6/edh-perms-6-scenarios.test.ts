/**
 * Commander lane edh-perms, round edh-perms-6: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. CR cites are from memory unless noted (cloud session: no rules/cr folder).
 *
 *   CR 118.12, 608.2c, 111.1, 707.9   "Whenever a land you control enters, you may pay {1}{G} if this permanent is attached to a creature you control. If you do, create a token that's a copy of
 *                                     that creature. If you didn't create a token this way, create a 1/1 green Insect creature token." (Springheart Nantuko's shape)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onField = (s: GameState, name: string, owner?: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (!owner || s.objects[id]!.controller === owner));
const pt = (s: GameState, id: ObjectId): [string, string] => [chars(s, id).power!, chars(s, id).toughness!];

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const pool = (s: GameState, ...mana: string[]): void => { for (const m of mana) s.players[0]!.manaPool.push({ type: m } as never); };

describe('CR 118.12, 608.2c, 111.1, 707.9: "you may pay {1}{G} if this permanent is attached to a creature you control. If you do, create a token that\'s a copy of that creature. If you didn\'t create a token this way, create a 1/1 green Insect creature token."', () => {
  const AMULET = card('Test Mimic Band', 'Artifact — Equipment', 'Whenever a land you control enters, you may pay {1}{G} if this permanent is attached to a creature you control. If you do, create a token that\'s a copy of that creature. If you didn\'t create a token this way, create a 1/1 green Insect creature token.\nEquip {1}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const FIELD = card('Test Field', 'Land', '');
  const defs = [AMULET, BEAR, FIELD];
  const insects = (s: GameState): ObjectId[] => onField(s, 'Insect', 'p1').length > 0 ? onField(s, 'Insect', 'p1') : s.zones.battlefield.filter((id) => chars(s, id).subtypes.includes('Insect') && s.objects[id]!.controller === 'p1');
  const play = (s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Test Field', 'hand', 'p1') }), o);
  const setup = (attached: boolean, withMana: boolean): GameState => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Mimic Band', 'Test Bear'], hand: ['Test Field'] } });
    if (attached) s.objects[find(s, 'Test Mimic Band', 'battlefield', 'p1')]!.attachedTo = find(s, 'Test Bear', 'battlefield', 'p1');
    if (withMana) pool(s, 'G', 'G');
    return s;
  };
  it('is fully automated', () => expect(full(AMULET)).toBe(true));
  it('attached to my creature and paid: a token copy of that creature, and no Insect', () => {
    const r = play(setup(true, true));
    expect(onField(r, 'Test Bear', 'p1')).toHaveLength(2);
    const token = onField(r, 'Test Bear', 'p1').find((id) => r.objects[id]!.kind === 'token')!;
    expect(pt(r, token)).toEqual(['2', '2']);
    expect(insects(r)).toHaveLength(0);
  });
  it('attached and the payment declined: no copy, and "you didn\'t create a token this way" makes the Insect', () => {
    const r = play(setup(true, true), { yes: false });
    expect(onField(r, 'Test Bear', 'p1')).toHaveLength(1);
    expect(insects(r)).toHaveLength(1);
    expect(pt(r, insects(r)[0]!)).toEqual(['1', '1']);
  });
  it('not attached to a creature: nothing is offered (no payment), and the Insect is created', () => {
    const r = play(setup(false, true));
    expect(onField(r, 'Test Bear', 'p1')).toHaveLength(1);
    expect(insects(r)).toHaveLength(1);
    expect(r.players[0]!.manaPool.length).toBe(2); // nothing was paid
  });
  it('the payment is made from the pool: attached and paid leaves the pool short by {1}{G}', () => {
    const r = play(setup(true, true));
    expect(r.players[0]!.manaPool.length).toBe(0);
  });
  it('attached but the mana cannot be paid: no copy, and the Insect', () => {
    const r = play(setup(true, false));
    expect(onField(r, 'Test Bear', 'p1')).toHaveLength(1);
    expect(insects(r)).toHaveLength(1);
  });
  it('an opponent\'s land does not trigger it', () => {
    const s0 = setup(true, true);
    expect(insects(s0)).toHaveLength(0);
  });
});

describe('CR 603.6a, 110.5b, 608.2d: "Whenever an artifact or creature an opponent controls enters untapped, they may tap that permanent. If they don\'t, you create a 1/1 white Vampire creature token with lifelink."', () => {
  const TAX = card('Test Toll Keeper', 'Creature — Vampire', 'Whenever an artifact or creature an opponent controls enters untapped, they may tap that permanent. If they don\'t, you create a 1/1 white Vampire creature token with lifelink.', { pt: ['2', '3'] });
  const FAST = card('Test Quick Bear', 'Creature — Bear', 'Flash', { pt: ['2', '2'], cost: '{0}' });
  const SLOW = card('Test Slow Bear', 'Creature — Bear', 'Flash\nThis creature enters tapped.', { pt: ['2', '2'], cost: '{0}' });
  const MINE = card('Test Own Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{0}' });
  const GEM = card('Test Bauble', 'Artifact', 'Flash', { cost: '{0}' });
  const defs = [TAX, FAST, SLOW, MINE, GEM];
  const vampires = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token' && chars(s, id).subtypes.includes('Vampire'));
  /** p1 passes priority in the main phase, p2 casts `name` at instant speed and the stack resolves with the answers `yes` (p2's choice). */
  const oppCasts = (name: string, yes: boolean): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Toll Keeper'] }, p2: { hand: [name] } });
    return resolveAll(act(pass(s0), { type: 'cast', player: 'p2', card: find(s0, name, 'hand', 'p2') }), { yes });
  };
  it('is fully automated', () => expect(full(TAX)).toBe(true));
  it('the opponent\'s creature enters untapped; its controller declines to tap it: I create the Vampire token', () => {
    const r = oppCasts('Test Quick Bear', false);
    expect(vampires(r)).toHaveLength(1);
    expect(pt(r, vampires(r)[0]!)).toEqual(['1', '1']);
    expect(chars(r, vampires(r)[0]!).keywords.some((k) => k.keyword === 'lifelink')).toBe(true);
    expect(r.objects[onField(r, 'Test Quick Bear', 'p2')[0]!]!.tapped).toBe(false);
  });
  it('CR 608.2d: the question "tap it?" is put to the opponent whose permanent entered, not to me', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Toll Keeper'] }, p2: { hand: ['Test Quick Bear'] } });
    let s = act(pass(s0), { type: 'cast', player: 'p2', card: find(s0, 'Test Quick Bear', 'hand', 'p2') });
    const askedOf: string[] = [];
    for (let i = 0; i < 40 && s.pending; i++) {
      const p = s.pending;
      if (p.kind === 'yesNo') { askedOf.push(p.player); s = answer(s, { kind: 'yesNo', yes: false }); }
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else break;
    }
    expect(askedOf).toEqual(['p2']);
  });
  it('the opponent chooses to tap it: it is tapped and I get no token', () => {
    const r = oppCasts('Test Quick Bear', true);
    expect(vampires(r)).toHaveLength(0);
    expect(r.objects[onField(r, 'Test Quick Bear', 'p2')[0]!]!.tapped).toBe(true);
  });
  it('an artifact triggers it too', () => {
    const r = oppCasts('Test Bauble', false);
    expect(vampires(r)).toHaveLength(1);
  });
  it('a creature that enters tapped does not trigger it (CR 110.5b: the status it entered with)', () => {
    const r = oppCasts('Test Slow Bear', false);
    expect(onField(r, 'Test Slow Bear', 'p2')).toHaveLength(1);
    expect(vampires(r)).toHaveLength(0);
  });
  /** The opponent's Bear enters; while the trigger is on the stack I (p1) cast `second` on it; then everything resolves, saying yes to every question. Returns the state and whether any question was asked of p2. */
  const respond = (second: string): { s: GameState; asked: boolean } => {
    const CHILL = card('Test Chill', 'Instant', 'Tap target creature.', { cost: '{0}' });
    const ZAP = card('Test Zap', 'Instant', 'Destroy target creature.', { cost: '{0}' });
    let s = scenario([], { defs: [...defs, CHILL, ZAP], p1: { battlefield: ['Test Toll Keeper'], hand: [second] }, p2: { hand: ['Test Quick Bear'] } });
    s = act(pass(s), { type: 'cast', player: 'p2', card: find(s, 'Test Quick Bear', 'hand', 'p2') });
    let asked = false;
    let cast = false;
    for (let i = 0; i < 40; i++) {
      const p = s.pending;
      if (!p) break;
      if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'yesNo') { asked = asked || p.player === 'p2'; s = answer(s, { kind: 'yesNo', yes: true }); }
      else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
      else if (p.kind === 'priority') {
        if (!cast && p.player === 'p1' && s.zones.stack.length === 1 && s.objects[s.zones.stack[0]!]!.kind !== 'card') {
          cast = true;
          const bear = find(s, 'Test Quick Bear', 'battlefield', 'p2');
          s = act(s, { type: 'cast', player: 'p1', card: find(s, second, 'hand', 'p1') });
          if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] });
        } else if (s.zones.stack.length === 0 && cast) break;
        else s = pass(s);
      } else break;
    }
    return { s, asked };
  };
  it('CR 608.2d (ruling 2023-11-10): if the permanent is already tapped as the ability resolves, they cannot choose to tap it: nothing is asked and I create the Vampire', () => {
    const { s, asked } = respond('Test Chill');
    expect(asked).toBe(false);
    expect(vampires(s)).toHaveLength(1);
    expect(s.objects[onField(s, 'Test Quick Bear', 'p2')[0]!]!.tapped).toBe(true);
  });
  it('CR 608.2d (ruling 2023-11-10): if the permanent has left the battlefield, they cannot choose to tap it: nothing is asked and I create the Vampire', () => {
    const { s, asked } = respond('Test Zap');
    expect(asked).toBe(false);
    expect(onField(s, 'Test Quick Bear', 'p2')).toHaveLength(0);
    expect(vampires(s)).toHaveLength(1);
  });
  it('CR 110.5b, 603.6a: a token that enters tapped does not trigger it either (and an untapped token does)', () => {
    const MAKER = card('Test Tapper', 'Instant', 'Create a tapped 1/1 white Soldier creature token.', { cost: '{0}' });
    const MAKER2 = card('Test Maker', 'Instant', 'Create a 1/1 white Soldier creature token.', { cost: '{0}' });
    for (const [name, expected] of [['Test Tapper', 0], ['Test Maker', 1]] as const) {
      const s0 = scenario([], { defs: [...defs, MAKER, MAKER2], p1: { battlefield: ['Test Toll Keeper'] }, p2: { hand: [name] } });
      const r = resolveAll(act(pass(s0), { type: 'cast', player: 'p2', card: find(s0, name, 'hand', 'p2') }), { yes: false });
      expect(vampires(r), name).toHaveLength(expected);
    }
  });
  it('my own creature entering does not trigger it ("an opponent controls")', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Toll Keeper'], hand: ['Test Own Bear'] } });
    const r = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Own Bear', 'hand', 'p1') }), { yes: false });
    expect(vampires(r)).toHaveLength(0);
  });
});

describe('CR 604.1, 611.3a, 613.1d, 205.1a, 205.3d: "As long as ~ has a slumber counter on it, it\'s a land."', () => {
  const KRAKEN = card('Test Slumber Kraken', 'Legendary Creature — Kraken', 'This creature enters tapped with five slumber counters on it.\nAs long as this creature has a slumber counter on it, it\'s a land.\nWhenever you cast a spell, you may remove a slumber counter from this creature.\n{T}: Add {G}{U}.', { pt: ['7', '7'], cost: '{2}{G}{U}' });
  const SPELL = card('Test Idle Thought', 'Instant', 'You gain 1 life.', { cost: '{0}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [KRAKEN, SPELL, BEAR];
  it('is fully automated', () => expect(full(KRAKEN)).toBe(true));
  it('with a slumber counter it is a land and not a creature (its creature type goes with it, CR 205.3d); with none it is the 7/7 Kraken creature', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Slumber Kraken', counters: { slumber: 5 } }, 'Test Bear'] } });
    const kraken = find(s0, 'Test Slumber Kraken', 'battlefield', 'p1');
    const asLand = chars(s0, kraken);
    expect(asLand.types).toContain('Land');
    expect(asLand.types).not.toContain('Creature');
    expect(asLand.subtypes).not.toContain('Kraken');
    expect(asLand.supertypes).toContain('Legendary');
    const bear = chars(s0, find(s0, 'Test Bear', 'battlefield', 'p1'));
    expect(bear.types).toEqual(['Creature']); // the negative case: nothing else changes type
    s0.objects[kraken]!.counters['slumber'] = 0;
    const awake = chars(s0, kraken);
    expect(awake.types).toContain('Creature');
    expect(awake.types).not.toContain('Land');
    expect(awake.subtypes).toContain('Kraken');
    expect([Number(awake.power), Number(awake.toughness)]).toEqual([7, 7]);
  });
  it('casting a spell lets me remove one counter at a time; at the last one it becomes a creature', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Slumber Kraken', counters: { slumber: 1 } }], hand: ['Test Idle Thought'] } });
    const kraken = find(s0, 'Test Slumber Kraken', 'battlefield', 'p1');
    const r = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Idle Thought', 'hand', 'p1') }), { yes: true });
    expect(r.objects[kraken]!.counters['slumber'] ?? 0).toBe(0);
    expect(chars(r, kraken).types).toContain('Creature');
  });
});

describe('CR 611.2b, 613.1d, 205.3: "{3}{B}, {T}: Put a shadow counter on target creature. For as long as that creature has a shadow counter on it, it\'s a Wraith in addition to its other types."', () => {
  const GATE = card('Test Dark Gate', 'Legendary Land', '{3}{B}, {T}: Put a shadow counter on target creature. For as long as that creature has a shadow counter on it, it\'s a Wraith in addition to its other types.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [GATE, BEAR];
  const start = (): { s: GameState; bear: ObjectId; other: ObjectId; r: GameState } => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Dark Gate', 'Test Bear', 'Test Bear'] } });
    const [bear, other] = onField(s, 'Test Bear', 'p1') as [ObjectId, ObjectId];
    pool(s, 'B', 'C', 'C', 'C');
    const act0 = legal(s, 'p1', 'activate').find((a) => /shadow counter/i.test(a.label));
    expect(act0, 'the activation is offered').toBeDefined();
    const r = resolveAll(act(s, act0!.action), { targets: [[bear]] });
    return { s, bear, other, r };
  };
  it('is fully automated', () => expect(full(GATE)).toBe(true));
  it('the target gets a shadow counter and is a Wraith as well as a Bear; another creature is not', () => {
    const { bear, other, r } = start();
    expect(r.objects[bear]!.counters['shadow']).toBe(1);
    expect(chars(r, bear).subtypes).toEqual(expect.arrayContaining(['Bear', 'Wraith']));
    expect(chars(r, other).subtypes).not.toContain('Wraith');
    expect(chars(r, bear).keywords.some((k) => k.keyword === 'shadow')).toBe(true); // CR 122.1b: a shadow counter gives shadow (ruling 2023-11-03)
    expect(chars(r, other).keywords.some((k) => k.keyword === 'shadow')).toBe(false);
  });
  it('when the counter is gone it is no Wraith any more (the duration is the counter, CR 611.2b)', () => {
    const { bear, r } = start();
    r.objects[bear]!.counters['shadow'] = 0;
    expect(chars(r, bear).subtypes).not.toContain('Wraith');
    expect(chars(r, bear).subtypes).toContain('Bear');
  });
});

describe('CR 604.1, 613.4c, 122.1: "Creatures you don\'t control get -1/-1 for each slime counter on them."', () => {
  const ACID = card('Test Acid Slug', 'Legendary Creature — Slug Horror', 'Creatures you don\'t control get -1/-1 for each slime counter on them.', { pt: ['5', '5'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['4', '4'] });
  const defs = [ACID, BEAR];
  it('is fully automated', () => expect(full(ACID)).toBe(true));
  it('an opponent\'s creature gets -1/-1 for each of its own slime counters; with none it is unchanged; my own creature with counters is not touched', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Acid Slug', { name: 'Test Bear', counters: { slime: 3 } }] }, p2: { battlefield: [{ name: 'Test Bear', counters: { slime: 2 } }, 'Test Bear'] } });
    const theirs = onField(s, 'Test Bear', 'p2');
    const marked = theirs.find((id) => s.objects[id]!.counters['slime'] === 2)!;
    const clean = theirs.find((id) => id !== marked)!;
    expect(pt(s, marked)).toEqual(['2', '2']);
    expect(pt(s, clean)).toEqual(['4', '4']);
    expect(pt(s, onField(s, 'Test Bear', 'p1')[0]!)).toEqual(['4', '4']);
    s.objects[marked]!.counters['slime'] = 4;
    expect(pt(s, marked)).toEqual(['0', '0']);
  });
});

describe('CR 604.1, 613.4c, 201.2: "Each nontoken creature you control gets +1/+1 for each other creature you control with the same name as that creature."', () => {
  const BOX = card('Test Echo Box', 'Artifact', 'Each nontoken creature you control gets +1/+1 for each other creature you control with the same name as that creature.', { cost: '{3}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const OTHER = card('Test Wolf', 'Creature — Wolf', '', { pt: ['2', '2'] });
  const defs = [BOX, BEAR, OTHER];
  it('is fully automated', () => expect(full(BOX)).toBe(true));
  it('three Bears: each gets +2/+2 (two others of its name); a lone Wolf gets nothing; an opponent\'s Bear neither counts nor is counted', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Echo Box', 'Test Bear', 'Test Bear', 'Test Bear', 'Test Wolf'] }, p2: { battlefield: ['Test Bear'] } });
    for (const id of onField(s, 'Test Bear', 'p1')) expect(pt(s, id)).toEqual(['4', '4']);
    expect(pt(s, onField(s, 'Test Wolf', 'p1')[0]!)).toEqual(['2', '2']);
    expect(pt(s, onField(s, 'Test Bear', 'p2')[0]!)).toEqual(['2', '2']);
  });
  it('a single Bear gets nothing (no OTHER creature of its name); two Bears get +1/+1 each', () => {
    const one = scenario([], { defs, p1: { battlefield: ['Test Echo Box', 'Test Bear'] } });
    expect(pt(one, onField(one, 'Test Bear', 'p1')[0]!)).toEqual(['2', '2']);
    const two = scenario([], { defs, p1: { battlefield: ['Test Echo Box', 'Test Bear', 'Test Bear'] } });
    for (const id of onField(two, 'Test Bear', 'p1')) expect(pt(two, id)).toEqual(['3', '3']);
  });
  it('a token copy counts for the nontoken Bear (ruling 2022-02-18) but gets no bonus itself', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Echo Box', 'Test Bear'] } });
    const bear = onField(s, 'Test Bear', 'p1')[0]!;
    const tok = put(s, 'p1', 'battlefield', 'Test Bear');
    s.objects[tok]!.kind = 'token';
    expect(pt(s, bear)).toEqual(['3', '3']);
    expect(pt(s, tok)).toEqual(['2', '2']);
  });
});

describe('CR 608.2c, 301.5a, 122.1: "Whenever a creature dies, put a +1/+1 counter on equipped creature. If equipped creature is a Vampire, put two +1/+1 counters on it instead."', () => {
  const BLADE = card('Test Gore Blade', 'Artifact — Equipment', 'Whenever a creature dies, put a +1/+1 counter on equipped creature. If equipped creature is a Vampire, put two +1/+1 counters on it instead.\nEquip {1}', { cost: '{1}' });
  const BAT = card('Test Night Bat', 'Creature — Vampire', '', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const FODDER = card('Test Fodder', 'Creature — Rat', '', { pt: ['1', '1'] });
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.', { cost: '{0}' });
  const defs = [BLADE, BAT, BEAR, FODDER, SMITE];
  const kill = (wearer: string | null): { r: GameState; wearerId: ObjectId | null } => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Gore Blade', 'Test Night Bat', 'Test Bear', 'Test Fodder'], hand: ['Test Smite'] } });
    const w = wearer === null ? null : find(s, wearer, 'battlefield', 'p1');
    if (w !== null) s.objects[find(s, 'Test Gore Blade', 'battlefield', 'p1')]!.attachedTo = w;
    const r = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') }), { targets: [[find(s, 'Test Fodder', 'battlefield', 'p1')]] });
    return { r, wearerId: w };
  };
  it('is fully automated', () => expect(full(BLADE)).toBe(true));
  it('on a Bear: one +1/+1 counter; on a Vampire: two (instead of, not in addition to, the one)', () => {
    const bear = kill('Test Bear');
    expect(bear.r.objects[bear.wearerId!]!.counters['+1/+1']).toBe(1);
    const bat = kill('Test Night Bat');
    expect(bat.r.objects[bat.wearerId!]!.counters['+1/+1']).toBe(2);
  });
  it('unattached: nothing gets the counters', () => {
    const { r } = kill(null);
    for (const id of r.zones.battlefield) expect(r.objects[id]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
