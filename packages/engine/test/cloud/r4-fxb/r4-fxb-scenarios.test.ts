/**
 * Standard round 4, slice r4-fxb: the shapes of this slice and the templates it promoted, played through applyAction with synthetic cards compiled by the
 * game's default compiler (invented wordings, design 6.10). Nothing is mocked. The promotions (design 6.9, 10.4) rest on these plays and on the hand-verified
 * golden cards of test/m5/golden/cards/cloud-r4-fxb-review.json.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, life, pass, put, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { tweak } from '../../m5/helpers';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual node) and the card full: what a template or promotion makes of it. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual')) && d.automation.level === 'full';
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

type Opts = { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[]; x?: number };
function settle(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  const groups = opts.targets ?? [];
  const picks = opts.picks ?? [];
  const queue = opts.answers ?? [];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending.kind === 'chooseNumber' && opts.x !== undefined) s = answer(s, { kind: 'chooseNumber', n: opts.x });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering what comes up. */
function drain(s0: GameState, opts: Opts = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 20; guard++) s = settle(pass(pass(s)), opts);
  return s;
}
function queued(opts: Opts): Opts {
  return { ...opts, targets: [...(opts.targets ?? [])], picks: [...(opts.picks ?? [])], answers: [...(opts.answers ?? [])] };
}
function cast(s0: GameState, name: string, opts: Opts = {}): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1'), ...(opts.x !== undefined ? { x: opts.x } : {}) } as never), q), q);
}
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability, ...(opts.x !== undefined ? { x: opts.x } : {}) } as never), q), q);
}
/** Pass priority (declaring the given attackers, no blockers) until `done`. */
function passTo(s0: GameState, done: (s: GameState) => boolean, opts: Opts & { attack?: ObjectId[] } = {}, max = 400): GameState {
  let s = s0;
  for (let guard = 0; guard < max && !done(s); guard++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: s.pending.player === 'p1' ? (opts.attack ?? []).map((a) => ({ attacker: a, defender: 'p2' })) : [] } as never);
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, opts);
  }
  if (!done(s)) throw new Error(`never reached (turn ${s.turn.number} ${s.turn.step}, pending ${s.pending?.kind})`);
  return s;
}
const onBattlefield = (s: GameState, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId);
const damageOn = (s: GameState, id: ObjectId): number => s.objects[id]!.damage ?? 0;

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const OX = card('Test Ox', 'Creature — Ox', '', ['2', '5'], '{3}{G}');

describe('CR 707.10, 707.10c, 107.3: "When you cast this spell, copy it X times." (eff.t45.copy.xTimes): X is the X announced for the spell', () => {
  const BARRAGE = card('Test Barrage', 'Sorcery', 'When you cast this spell, copy it X times. You may choose new targets for the copies.\nThis spell deals 1 damage to target creature.', undefined, '{X}{R}', ['R']);
  it('is automated; cast with X = 2, the spell and its two copies deal 1 damage each (the copies retargeted)', () => {
    expect(automated(BARRAGE)).toBe(true);
    let s = scenario(['Mountain'], { p1: { hand: ['Test Barrage'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Test Ox', 'Test Bear'] }, defs: [BARRAGE, OX, BEAR] });
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = cast(s, 'Test Barrage', { x: 2, targets: [[obj(ox)], [obj(ox)], [obj(bear)]], answers: [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: true }] });
    expect(s.zones.stack).toHaveLength(0);
    expect(damageOn(s, ox) + damageOn(s, bear)).toBe(3);
  });
});

describe('CR 613.4b, 205.3m, 611.2a: "Until end of turn, that creature has base power and toughness 4/4 and gains all creature types." (eff.stdecl.durFirst.basept.gains.allCreatureTypes)', () => {
  const GIFTER = card('Test Gifter', 'Creature — Faerie Wizard', 'Flash\nFlying\nWhen this creature enters, choose up to one other target creature. Until end of turn, that creature has base power and toughness 4/4 and gains all creature types.', ['1', '2']);
  it('is automated; the target is a 4/4 of every creature type until the turn ends, then a 2/2 Bear again (CR 514.2)', () => {
    expect(automated(GIFTER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Gifter'], battlefield: ['Test Bear'] }, defs: [GIFTER, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Gifter', { targets: [[obj(bear)]] });
    expect(getChars(s, bear)).toMatchObject({ power: '4', toughness: '4' });
    expect(getChars(s, bear).subtypes).toEqual(expect.arrayContaining(['Bear', 'Elf', 'Dragon', 'Faerie']));
    s = passTo(s, (x) => x.turn.number === 2);
    expect(getChars(s, bear)).toMatchObject({ power: '2', toughness: '2' });
    expect(getChars(s, bear).subtypes).toEqual(['Bear']);
  });
  it('with no target chosen ("up to one"), nothing changes', () => {
    let s = scenario([], { p1: { hand: ['Test Gifter'], battlefield: ['Test Bear'] }, defs: [GIFTER, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Gifter', { targets: [[]] });
    expect(getChars(s, bear)).toMatchObject({ power: '2', toughness: '2' });
  });
});

describe('CR 602.2, 113.6k, 122.1h: "{8}: Return this card from your graveyard to the battlefield tapped with a finality counter on it." (eff.e13.return.self.gy.bf.tapped.counter)', () => {
  const RELENTLESS = card('Test Relentless', 'Artifact Creature — Robot', "This creature can't be blocked except by three or more creatures.\n{8}: Return this card from your graveyard to the battlefield tapped with a finality counter on it.", ['6', '5'], '{6}');
  it('is automated; activated from the graveyard it returns tapped with one finality counter, and when it would die again it is exiled', () => {
    expect(automated(RELENTLESS)).toBe(true);
    const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
    let s = scenario(['Plains'], { p1: { graveyard: ['Test Relentless'], hand: ['Test Swat'], battlefield: Array(8).fill('Plains') }, defs: [RELENTLESS, SWAT] });
    const gy = find(s, 'Test Relentless', 'graveyard', 'p1');
    s = activate(s, gy, {}, 'p:0:1');
    const [r] = findAll(s, 'Test Relentless', 'battlefield', 'p1');
    expect(r).toBeDefined();
    expect(s.objects[r!]!.tapped).toBe(true);
    expect(s.objects[r!]!.counters.finality).toBe(1);
    s = cast(s, 'Test Swat', { targets: [[obj(r!)]] });
    expect(findAll(s, 'Test Relentless', 'graveyard', 'p1')).toHaveLength(0);
    expect(findAll(s, 'Test Relentless', 'exile', 'p1')).toHaveLength(1);
  });
  it('can not be activated while it is on the battlefield (the ability functions only in the graveyard, CR 113.6k)', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Relentless', ...Array(8).fill('Plains')] }, defs: [RELENTLESS] });
    const id = find(s, 'Test Relentless', 'battlefield', 'p1');
    expect(() => act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:1' } as never)).toThrow();
  });
});

describe('CR 702.182a, 613.1d, 613.1f, 301.5c: "Equipped creature is a Wizard in addition to its other types and has \\"Whenever you cast a noncreature spell ..., put a +1/+1 counter on this creature.\\"" (sta.t77.attached.addtype.quoted.lead)', () => {
  const ORRERY = card('Test Orrery', 'Artifact — Equipment', 'Job select\nEquipped creature is a Wizard in addition to its other types and has "Whenever you cast a noncreature spell and whenever you draw your third card each turn, put a +1/+1 counter on this creature."\nEquip {2}', undefined, '{1}{U}');
  const SPARK = card('Test Spark', 'Instant', 'Draw a card.', undefined, '{0}');
  it('is automated; job select makes a 1/1 Hero wearing it, a Wizard Hero; a noncreature spell puts a +1/+1 counter on the creature, not on the Equipment', () => {
    expect(automated(ORRERY)).toBe(true);
    let s = scenario(['Island'], { p1: { hand: ['Test Orrery', 'Test Spark'], battlefield: ['Island', 'Island'] }, defs: [ORRERY, SPARK] });
    s = cast(s, 'Test Orrery');
    const eq = find(s, 'Test Orrery', 'battlefield', 'p1');
    const hero = s.objects[eq]!.attachedTo!;
    expect(hero).toBeDefined();
    expect(getChars(s, hero).subtypes).toEqual(expect.arrayContaining(['Hero', 'Wizard']));
    s = cast(s, 'Test Spark');
    expect(s.objects[hero]!.counters['+1/+1']).toBe(1);
    expect(s.objects[eq]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

const keywordsOf = (s: GameState, id: ObjectId): string[] => getChars(s, id).abilities.map((a) => (a.def as { keyword?: string }).keyword ?? a.def.kind);
const FLIER = card('Test Flier', 'Creature — Bird', 'Flying\nVigilance', ['1', '1'], '{1}{W}');

describe('CR 611.2a, 613.1f, 514.2: "All creatures lose all abilities until end of turn." (eff.fxb.loseAll.each)', () => {
  const HUSH = card('Test Hush', 'Instant', 'All creatures lose all abilities until end of turn.');
  it('is automated; every creature, yours and the opponent\'s, has no abilities until the turn ends, then has them again', () => {
    expect(automated(HUSH)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Hush'], battlefield: ['Test Flier'] }, p2: { battlefield: ['Test Flier'] }, defs: [HUSH, FLIER] });
    const [a, b] = [find(s, 'Test Flier', 'battlefield', 'p1'), find(s, 'Test Flier', 'battlefield', 'p2')];
    s = cast(s, 'Test Hush');
    expect(keywordsOf(s, a)).toEqual([]);
    expect(keywordsOf(s, b)).toEqual([]);
    s = passTo(s, (x) => x.turn.number === 2);
    expect(keywordsOf(s, a)).toEqual(['flying', 'vigilance']);
  });
});

describe('CR 611.2a, 613.7, 122.1b: "up to one other target creature loses all abilities. Put a flying counter ... on that creature." (eff.fxb.loseAll.permanent)', () => {
  const MENTOR = card('Test Mentor', 'Creature — Bird Bard', 'When this creature enters, up to one other target creature loses all abilities. Put a flying counter and a lifelink counter on that creature.', ['2', '2']);
  it('is automated; the loss has no end, and the keyword counters put on afterwards still give their abilities (a later timestamp, CR 613.7c)', () => {
    expect(automated(MENTOR)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Mentor'] }, p2: { battlefield: ['Test Flier'] }, defs: [MENTOR, FLIER] });
    const f = find(s, 'Test Flier', 'battlefield', 'p2');
    s = cast(s, 'Test Mentor', { targets: [[obj(f)]] });
    expect(keywordsOf(s, f).sort()).toEqual(['flying', 'lifelink']);
    s = passTo(s, (x) => x.turn.number === 3);
    expect(keywordsOf(s, f).sort()).toEqual(['flying', 'lifelink']); // vigilance stays lost (no duration)
  });
  it('CR 613.7c: a keyword counter put on BEFORE the loss began is lost with every other ability', () => {
    let s = scenario([], { p1: { hand: ['Test Mentor'] }, p2: { battlefield: ['Test Bear'] }, defs: [MENTOR, BEAR] });
    const b = find(s, 'Test Bear', 'battlefield', 'p2');
    const HUSH = card('Test Quiet', 'Instant', 'Target creature loses all abilities.');
    s = scenario([], { p1: { hand: ['Test Quiet'] }, p2: { battlefield: ['Test Bear'] }, defs: [HUSH, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = tweak(s, (x) => { x.objects[bear]!.counters.trample = 1; });
    expect(keywordsOf(s, bear)).toEqual(['trample']);
    s = cast(s, 'Test Quiet', { targets: [[obj(bear)]] });
    expect(keywordsOf(s, bear)).toEqual([]);
    expect(b).toBeDefined();
  });
});

describe('CR 400.7, 611.2a, 603.6a: "When ~ dies, return it to the battlefield ... with a +1/+1 counter on it. It loses all abilities and gains haste." (eff.fxb.loseAll.gains.permanent)', () => {
  const CAT = card('Test Hellion', 'Legendary Creature — Human Hero', "Haste\nWhen Test Hellion dies, return her to the battlefield under her owner's control with a +1/+1 counter on her. She loses all abilities and gains haste.", ['2', '2']);
  const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
  it('is automated; the returned permanent (a new object) has only haste and its counter, so dying again does not return it', () => {
    expect(automated(CAT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Hellion'], hand: ['Test Swat', 'Test Swat'] }, defs: [CAT, SWAT] });
    s = cast(s, 'Test Swat', { targets: [[obj(find(s, 'Test Hellion', 'battlefield', 'p1'))]] });
    const back = find(s, 'Test Hellion', 'battlefield', 'p1');
    expect(s.objects[back]!.counters['+1/+1']).toBe(1);
    expect(keywordsOf(s, back)).toEqual(['haste']);
    s = cast(s, 'Test Swat', { targets: [[obj(back)]] });
    expect(findAll(s, 'Test Hellion', 'battlefield', 'p1')).toHaveLength(0);
    expect(findAll(s, 'Test Hellion', 'graveyard', 'p1')).toHaveLength(1);
  });
});

describe('CR 111.10, 608.2d: "create a Food token or a Treasure token" (eff.fxb.token.orToken)', () => {
  const ARMY = card('Test Army', 'Creature — Insect', 'When this creature enters, create a Food token or a Treasure token.', ['1', '1']);
  for (const pick of ['Treasure', 'Food']) {
    it(`is automated; you choose as it resolves, and one ${pick} token is created`, () => {
      expect(automated(ARMY)).toBe(true);
      let s = scenario([], { p1: { hand: ['Test Army'] }, defs: [ARMY] });
      s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Army', 'hand', 'p1') }));
      for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) {
        s = settle(pass(pass(s)));
        const p = s.pending as unknown as { kind: string; options?: { id: string; label?: string }[] };
        if (p?.kind === 'chooseOption') s = settle(answer(s, { kind: 'chooseOption', ids: [p.options!.find((o) => JSON.stringify(o).toLowerCase().includes(pick.toLowerCase()))!.id] }));
      }
      const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').map((id) => getChars(s, id).subtypes);
      expect(tokens).toEqual([[pick]]);
    });
  }
});

const rejected = (s: GameState, f: (s: GameState) => GameState): boolean => { try { f(s); return false; } catch (e) { return /rejected/i.test(String(e)); } };
const attackWith = (s: GameState, ids: ObjectId[]): GameState =>
  passUntil(declareAttackers(toDeclareAttackers(s), ids.map((id) => [id] as [ObjectId])), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'the declare blockers decision');

describe('CR 509.1c, 611.2a, 506.1: "{3}: ~ must be blocked each combat this turn if able." (eff.fxb.mustBeBlocked.eachCombat)', () => {
  const MOLE = card('Test Mole', 'Creature — Mole', '{3}: This creature must be blocked each combat this turn if able.', ['3', '3']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  it('is automated; after the activation a creature that can block must block it, and no block at all is refused', () => {
    expect(automated(MOLE)).toBe(true);
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Mole', 'Test Ogre', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Bear'] }, defs: [MOLE, OGRE, BEAR] });
    const mole = find(s, 'Test Mole', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = activate(s, mole);
    s = attackWith(s, [mole, ogre]);
    expect(rejected(s, (x) => declareBlockers(x, []))).toBe(true);
    expect(rejected(s, (x) => declareBlockers(x, [[bear, ogre]]))).toBe(true);
    expect(declareBlockers(s, [[bear, mole]]).combat!.blockers.length).toBe(1);
  });
  it('without the activation, no block is a legal declaration', () => {
    let s = scenario([], { p1: { battlefield: ['Test Mole'] }, p2: { battlefield: ['Test Bear'] }, defs: [MOLE, BEAR] });
    s = attackWith(s, [find(s, 'Test Mole', 'battlefield', 'p1')]);
    expect(rejected(s, (x) => declareBlockers(x, []))).toBe(false);
  });
});

describe('CR 608.2c, 122.1d: "tap up to one target creature. If an opponent controls that creature, put a stun counter on it." (eff.fxb.ifOpponentControls)', () => {
  const FEAR = card('Test Dread', 'Enchantment Creature — Nightmare', 'When this creature enters, tap up to one target creature. If an opponent controls that creature, put a stun counter on it.', ['2', '2']);
  it("is automated; an opponent's creature is tapped and gets a stun counter, your own is only tapped", () => {
    expect(automated(FEAR)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Dread', 'Test Dread'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [FEAR, BEAR] });
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Dread', { targets: [[obj(theirs)]] });
    expect(s.objects[theirs]).toMatchObject({ tapped: true });
    expect(s.objects[theirs]!.counters.stun).toBe(1);
    s = cast(s, 'Test Dread', { targets: [[obj(mine)]] });
    expect(s.objects[mine]).toMatchObject({ tapped: true });
    expect(s.objects[mine]!.counters.stun ?? 0).toBe(0);
  });
});

describe('CR 608.2c-d, 122.1d: "Tap up to three target creatures. Put a stun counter on one of them." (eff.fxb.counter.oneOfThem)', () => {
  const STAIRS = card('Test Stairs', 'Sorcery', 'Tap up to three target creatures. Put a stun counter on one of them.');
  it('is automated; all three are tapped and the one you choose among them gets the stun counter', () => {
    expect(automated(STAIRS)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Stairs'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Ox'] }, defs: [STAIRS, BEAR, OX] });
    const ids = [...findAll(s, 'Test Bear', 'battlefield', 'p2'), find(s, 'Test Ox', 'battlefield', 'p2')];
    s = cast(s, 'Test Stairs', { targets: [ids.map(obj)], picks: [[ids[2]!]] });
    expect(ids.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(ids.map((id) => s.objects[id]!.counters.stun ?? 0)).toEqual([0, 0, 1]);
  });
});

/** The steps the turn goes through from `s` until `done`, passing priority and declaring the given attackers each combat (no blockers). */
function stepsUntil(s0: GameState, done: (s: GameState) => boolean, attack: (s: GameState) => ObjectId[] = () => [], max = 400): { s: GameState; steps: string[] } {
  let s = s0;
  const steps: string[] = [];
  let last = '';
  for (let guard = 0; guard < max && !done(s); guard++) {
    const key = `${s.turn.number}:${s.turn.step}:${steps.length}`;
    if (`${s.turn.number}:${s.turn.step}` !== last) { steps.push(s.turn.step); last = `${s.turn.number}:${s.turn.step}`; }
    void key;
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: s.pending.player === 'p1' ? attack(s).map((a) => ({ attacker: a, defender: 'p2' })) : [] } as never);
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s);
  }
  return { s, steps };
}

describe('CR 500.8, 603.7b: "After this main phase, there are two additional combat phases. At the beginning of each combat this turn, untap all creatures that attacked this turn."', () => {
  const THROTTLE = card('Test Throttle', 'Sorcery', 'After this main phase, there are two additional combat phases.\nAt the beginning of each combat this turn, untap all creatures that attacked this turn.');
  it('is automated; three combat phases follow the main phase, and the creature that attacked is untapped at the beginning of each later combat', () => {
    expect(automated(THROTTLE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Throttle'], battlefield: ['Test Bear'] }, defs: [THROTTLE, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Throttle');
    const run = stepsUntil(s, (x) => x.turn.step === 'main2', (x) => (x.objects[bear]!.tapped ? [] : [bear]));
    expect(run.steps.filter((x) => x === 'beginCombat')).toHaveLength(3);
    expect(life(run.s, 'p2')).toBe(20 - 2 * 3); // it attacked in each combat: untapped at the beginning of the second and third
  });
});

describe('CR 500.8: "If ~ is attacking, untap ~ and there is an additional combat phase after this phase." (eff.stdfdn.extraPhase.combat; r4-fxb\'s duplicate folded into it in wave 7)', () => {
  const HULK = card('Test Brute', 'Creature — Gamma Berserker', 'Whenever this creature attacks, untap it and there is an additional combat phase after this phase.', ['3', '3']);
  it('is automated; after the combat phase another combat phase begins, then the turn goes on to the second main phase', () => {
    expect(automated(HULK)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Brute'] }, defs: [HULK] });
    const brute = find(s, 'Test Brute', 'battlefield', 'p1');
    let attacks = 0;
    const run = stepsUntil(s, (x) => x.turn.step === 'main2', () => (attacks++ === 0 ? [brute] : []));
    expect(run.steps.filter((x) => x === 'beginCombat')).toHaveLength(2);
    s = run.s;
    expect(s.objects[brute]!.tapped).toBe(false);
  });
});

describe('CR 500.9: "you get that many additional upkeep steps after this phase" (eff.fxb.extraSteps.upkeep.afterThisPhase, op extraStep)', () => {
  const OBEKA = card('Test Splitter', 'Creature — Ogre Warlock', 'Whenever this creature deals combat damage to a player, you get that many additional upkeep steps after this phase.', ['2', '3']);
  const UPKEEPER = card('Test Upkeeper', 'Enchantment', 'At the beginning of your upkeep, you gain 1 life.');
  it('is automated; two damage: two upkeep steps after the combat phase (each triggers upkeep abilities), then the second main phase', () => {
    expect(automated(OBEKA)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Splitter', 'Test Upkeeper'] }, defs: [OBEKA, UPKEEPER] });
    const ogre = find(s, 'Test Splitter', 'battlefield', 'p1');
    let attacks = 0;
    const run = stepsUntil(s, (x) => x.turn.step === 'main2', () => (attacks++ === 0 ? [ogre] : []));
    const afterCombat = run.steps.slice(run.steps.indexOf('endCombat'));
    expect(afterCombat).toEqual(['endCombat', 'upkeep']); // the two added upkeeps are one run of the same step name
    expect(life(run.s, 'p1')).toBe(20 + 2);
    expect(life(run.s, 'p2')).toBe(18);
  });
});

describe('CR 500.9, 513.1: "Then if it\'s the first end step of the turn, there is an additional end step after this step." (eff.fxb.extraStep.end.afterThisStep)', () => {
  const YSH = card('Test Sage', 'Creature — Elf Sage', "At the beginning of your end step, you gain 1 life. Then if it's the first end step of the turn, there is an additional end step after this step.", ['3', '3']);
  it('is automated; one additional end step only: the ability triggers in both end steps, and the second time it is not the first end step', () => {
    expect(automated(YSH)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Sage'] }, defs: [YSH] });
    const run = stepsUntil(s, (x) => x.turn.number === 2);
    expect(life(run.s, 'p1')).toBe(22);
    expect(run.s.log.filter((l) => /An additional end step begins/.test((l as { text?: string }).text ?? '')).length).toBe(1);
  });
});

describe('CR 115.7, 115.7a, 115.9a: "Change the target of target spell or ability with a single target." (eff.fxb.changeTarget, op changeTarget)', () => {
  const BEND = card('Test Bend', 'Instant', 'Change the target of target spell or ability with a single target.');
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 2 damage to target creature.');
  const DOUBLE = card('Test Double Zap', 'Instant', 'Test Double Zap deals 1 damage to target creature and 1 damage to another target creature.');
  /** p2 casts `spell` at p1's creature; p1 responds with Test Bend on it. */
  function bendAt(spell: string, extra: string[] = []): { s: GameState; mine: ObjectId; theirs: ObjectId } {
    let s = scenario([], { p1: { hand: ['Test Bend'], battlefield: ['Test Bear'] }, p2: { hand: [spell], battlefield: ['Test Ox', ...extra] }, defs: [BEND, ZAP, DOUBLE, BEAR, OX] });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Ox', 'battlefield', 'p2');
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.player === 'p2');
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, spell, 'hand', 'p2') }), { targets: [[obj(mine)], [obj(theirs)]] });
    s = pass(s); // p1 gets priority with the spell on the stack
    return { s, mine, theirs };
  }
  it('is automated; the opponent\'s 2 damage to your creature is redirected to the only other legal target, their own creature', () => {
    expect(automated(BEND)).toBe(true);
    let { s, mine, theirs } = bendAt('Test Zap');
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    const zap = s.zones.stack[0]!;
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bend', 'hand', 'p1') }), { targets: [[obj(zap)]] });
    s = drain(s, { targets: [[obj(theirs)]] });
    expect(damageOn(s, mine)).toBe(0);
    expect(damageOn(s, theirs)).toBe(2);
  });
  it('CR 115.7a: with no other legal target the target is unchanged', () => {
    let s = scenario([], { p1: { hand: ['Test Bend'], battlefield: ['Test Ox'] }, p2: { hand: ['Test Zap'] }, defs: [BEND, ZAP, OX] });
    const mine = find(s, 'Test Ox', 'battlefield', 'p1');
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.player === 'p2');
    s = pass(settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Zap', 'hand', 'p2') }), { targets: [[obj(mine)]] }));
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bend', 'hand', 'p1') }), { targets: [[obj(s.zones.stack[0]!)]] }));
    expect(damageOn(s, mine)).toBe(2);
  });
  it('CR 115.9a: a spell with two targets is not a legal target of it', () => {
    const { s } = bendAt('Test Double Zap');
    expect(s.zones.stack).toHaveLength(1);
    expect(rejected(s, (x) => act(x, { type: 'cast', player: 'p1', card: find(x, 'Test Bend', 'hand', 'p1') }))).toBe(true); // no legal target (CR 601.2c)
  });
});

describe('CR 601.2h, 608.2h: "Counter target spell. If the amount of mana spent to cast that spell was less than its mana value, you draw a card." (spellManaSpent of a target)', () => {
  const UNWIND = card('Test Unwind', 'Instant', 'Counter target spell. If the amount of mana spent to cast that spell was less than its mana value, you draw a card.');
  const BIG = card('Test Big', 'Sorcery', 'You gain 1 life.', undefined, '{3}');
  const HELPER = card('Test Helper', 'Artifact', 'Sorcery spells you cast cost {1} less to cast.');
  /** p2 casts Test Big (with or without the cost reduction), p1 counters it. */
  function counterIt(reduced: boolean): GameState {
    let s = scenario(['Island'], { p1: { hand: ['Test Unwind'] }, p2: { hand: ['Test Big'], battlefield: ['Island', 'Island', 'Island', ...(reduced ? ['Test Helper'] : [])] }, defs: [UNWIND, BIG, HELPER] });
    s = passTo(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.player === 'p2');
    s = pass(settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Big', 'hand', 'p2') })));
    return drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Unwind', 'hand', 'p1') }), { targets: [[obj(s.zones.stack[0]!)]] }));
  }
  it('is automated; a spell cast for its full cost is countered and no card is drawn', () => {
    expect(automated(UNWIND)).toBe(true);
    const s = counterIt(false);
    expect(findAll(s, 'Test Big', 'graveyard', 'p2')).toHaveLength(1);
    expect(s.zones.hand.p1).toHaveLength(0);
  });
  it('a spell cast for less than its mana value (a cost reduction) is countered and you draw a card', () => {
    const s = counterIt(true);
    expect(findAll(s, 'Test Big', 'graveyard', 'p2')).toHaveLength(1);
    expect(s.zones.hand.p1).toHaveLength(1);
  });
});

describe('CR 602.5b, 208.1: "{2}, {T}: Draw a card. Activate only if this creature\'s power is 3 or greater." (announce.qty.stat.self)', () => {
  const OTTER = card('Test Otter', 'Creature — Otter', "{T}: Draw a card. Activate only if this creature's power is 3 or greater.", ['1', '3']);
  const GROW = card('Test Grow', 'Instant', 'Target creature gets +2/+0 until end of turn.');
  it("is automated; with power 1 the ability can't be activated, with power 3 it can", () => {
    expect(automated(OTTER)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Otter'], hand: ['Test Grow'] }, defs: [OTTER, GROW] });
    const otter = find(s, 'Test Otter', 'battlefield', 'p1');
    s = tweak(s, (x) => { x.objects[otter]!.controlledSinceTurn = 0; });
    expect(rejected(s, (x) => act(x, { type: 'activate', player: 'p1', source: otter, ability: 'p:0:0' } as never))).toBe(true);
    s = cast(s, 'Test Grow', { targets: [[obj(otter)]] });
    s = activate(s, otter);
    expect(s.zones.hand.p1).toHaveLength(1);
  });
});

describe('CR 120.3, 608.2f: "it deals damage to each player equal to the number of nonbasic lands that player controls." (eff.fxb.damage.eachPlayer.theirCount)', () => {
  const LYNX = card('Test Lynx', 'Creature — Cat', 'When this creature enters, it deals damage to each player equal to the number of nonbasic lands that player controls.', ['3', '2']);
  const WASTE = card('Test Waste', 'Land', '{T}: Add {C}.');
  it('is automated; each player is dealt damage equal to their own nonbasic lands (basic lands do not count)', () => {
    expect(automated(LYNX)).toBe(true);
    let s = scenario(['Mountain'], { p1: { hand: ['Test Lynx'], battlefield: ['Test Waste', 'Mountain'] }, p2: { battlefield: ['Test Waste', 'Test Waste', 'Test Waste'] }, defs: [LYNX, WASTE] });
    s = cast(s, 'Test Lynx');
    expect(life(s, 'p1')).toBe(19);
    expect(life(s, 'p2')).toBe(17);
  });
});

describe('CR 122.1, 608.2c-d: "remove a counter from a creature you control. If you do, draw a card." (eff.fxb.removeCounter.fromOneYouControl)', () => {
  const HYDE = card('Test Hyde', 'Creature — Human', 'At the beginning of your upkeep, remove a counter from a creature you control. If you do, draw a card.', ['2', '2']);
  it('is automated; with a counter on a creature you control one is removed and you draw; with none, nothing happens', () => {
    expect(automated(HYDE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Hyde', 'Test Bear'] }, defs: [HYDE, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = tweak(s, (x) => { x.objects[bear]!.counters['+1/+1'] = 2; });
    const hand0 = s.zones.hand.p1!.length;
    s = passTo(s, (x) => x.turn.number === 3 && x.turn.step === 'draw', { picks: [[bear]] });
    expect(s.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(s.zones.hand.p1!.length).toBe(hand0 + 2); // the upkeep draw and the draw step's
    s = tweak(s, (x) => { delete x.objects[bear]!.counters['+1/+1']; });
    const hand1 = s.zones.hand.p1!.length;
    s = passTo(s, (x) => x.turn.number === 5 && x.turn.step === 'draw');
    expect(s.zones.hand.p1!.length).toBe(hand1 + 1); // no counter to remove: only the draw step's card
  });
});

describe('CR 608.2c, 122.1: "create a 1/1 black Snail creature token if you don\'t control a Snail. Otherwise, put a +1/+1 counter on a Snail you control." (eff.r3refs.counters.put.onChosen.youControl; r4-fxb\'s duplicate folded into it in wave 7)', () => {
  const WICK = card('Test Wick', 'Creature — Rat Warlock', "Whenever this creature or another Rat you control enters, create a 1/1 black Snail creature token if you don't control a Snail. Otherwise, put a +1/+1 counter on a Snail you control.", ['2', '2']);
  const RAT = card('Test Rat', 'Creature — Rat', '', ['1', '1']);
  it('is automated; the first Rat makes a Snail, the next one puts a +1/+1 counter on that Snail', () => {
    expect(automated(WICK)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Wick', 'Test Rat'] }, defs: [WICK, RAT] });
    s = cast(s, 'Test Wick');
    const snails = s.zones.battlefield.filter((id) => (getChars(s, id).subtypes ?? []).includes('Snail'));
    expect(snails).toHaveLength(1);
    s = cast(s, 'Test Rat', { picks: [[snails[0]!]] });
    expect(s.zones.battlefield.filter((id) => (getChars(s, id).subtypes ?? []).includes('Snail'))).toHaveLength(1);
    expect(s.objects[snails[0]!]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 107.3, 608.2h, 702.? converge: "Put X +1/+1 counters on each of them and you gain X life, where X is the number of colors of mana spent to cast this spell."', () => {
  const SONG = card('Test Song', 'Sorcery', 'Create two 0/0 green and blue Fractal creature tokens. Put X +1/+1 counters on each of them and you gain X life, where X is the number of colors of mana spent to cast this spell.', undefined, '{G}{U}', ['G', 'U']);
  it('is automated; two colors spent: two tokens with two counters each, and 2 life', () => {
    expect(automated(SONG)).toBe(true);
    let s = scenario(['Forest', 'Island'], { p1: { hand: ['Test Song'], battlefield: ['Forest', 'Island'] }, defs: [SONG] });
    s = cast(s, 'Test Song');
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.map((id) => s.objects[id]!.counters['+1/+1'])).toEqual([2, 2]);
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 604.3, 613.4a, 122.1: "~\'s power is equal to the number of +1/+1 counters on lands you control." (the counters on a group)', () => {
  const TOPH = card('Test Bandit', 'Legendary Creature — Human Warrior', "This creature's power is equal to the number of +1/+1 counters on lands you control.", ['*', '3']);
  const LAND = card('Test Plain Land', 'Land', '');
  it('is automated; the power is the counters on your lands added up (not on creatures, not on an opponent\'s lands)', () => {
    expect(automated(TOPH)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Bandit', 'Test Plain Land', 'Test Plain Land', 'Test Bear'] }, p2: { battlefield: ['Test Plain Land'] }, defs: [TOPH, LAND, BEAR] });
    const [l1, l2] = findAll(s, 'Test Plain Land', 'battlefield', 'p1');
    const theirs = find(s, 'Test Plain Land', 'battlefield', 'p2');
    s = tweak(s, (x) => { x.objects[l1!]!.counters['+1/+1'] = 2; x.objects[l2!]!.counters['+1/+1'] = 1; x.objects[theirs]!.counters['+1/+1'] = 5; x.objects[find(x, 'Test Bear', 'battlefield', 'p1')]!.counters['+1/+1'] = 4; });
    expect(getChars(s, find(s, 'Test Bandit', 'battlefield', 'p1')).power).toBe('3');
  });
});

describe('CR 603.10a, 608.2h, 122.1: "When this creature dies, create a Treasure token for each +1/+1 counter on it." (eff.fxb.token.forEach.counterKind)', () => {
  const HYDRA = card('Test Hydra', 'Creature — Snake Hydra', 'When this creature dies, create a Treasure token for each +1/+1 counter on it.', ['1', '1'], '{2}{G}');
  const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
  it('is automated; it counts the +1/+1 counters it had as it last existed (other kinds do not count)', () => {
    expect(automated(HYDRA)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Hydra'], hand: ['Test Swat'] }, defs: [HYDRA, SWAT] });
    const h = find(s, 'Test Hydra', 'battlefield', 'p1');
    s = tweak(s, (x) => { x.objects[h]!.counters['+1/+1'] = 3; x.objects[h]!.counters.charge = 2; });
    s = cast(s, 'Test Swat', { targets: [[obj(h)]] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(3);
  });
});

describe('CR 105.2, 608.2h: "Whenever you cast a spell, put a +1/+1 counter on ~ for each of that spell\'s colors." (eff.fxb.counters.perColorOf)', () => {
  const RAMOS = card('Test Engine', 'Artifact Creature — Dragon', "Whenever you cast a spell, put a +1/+1 counter on this creature for each of that spell's colors.", ['4', '4']);
  const GOLD = card('Test Gold', 'Instant', 'You gain 1 life.', undefined, '{0}', ['W', 'U', 'B']);
  it('is automated; a three-color spell puts three counters on it', () => {
    expect(automated(RAMOS)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Engine'], hand: ['Test Gold'] }, defs: [RAMOS, GOLD] });
    s = cast(s, 'Test Gold');
    expect(s.objects[find(s, 'Test Engine', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(3);
  });
});

describe('CR 120.3, 115.3: "~ deals 6 damage to target creature and 2 damage to up to one other target creature token." (eff.fxb.damage.andUpToTarget)', () => {
  const SHOT = card('Test Shot', 'Instant', 'Test Shot deals 3 damage to target creature and 1 damage to up to one other target creature token.');
  const TOKEN_MAKER = card('Test Maker', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.');
  it('is automated; the two amounts go to the two targets, and the token may not be the first target ("other")', () => {
    expect(automated(SHOT)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Shot', 'Test Maker'] }, p2: { battlefield: ['Test Ox'] }, defs: [SHOT, TOKEN_MAKER, OX] });
    s = cast(s, 'Test Maker');
    const [tok] = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    s = cast(s, 'Test Shot', { targets: [[obj(ox)], [obj(tok!)]] });
    expect(damageOn(s, ox)).toBe(3);
    expect(s.zones.battlefield).not.toContain(tok); // 1 damage to a 1/1 token
  });
});

describe('CR 701.28a, 608.2c: "Then transform ~ if you control four or more artifacts." (eff.fxb.then.transform.ifCond) and "Then destroy all other creatures if its power is exactly 20."', () => {
  const AMALIA = card('Test Amalia', 'Legendary Creature — Vampire Scout', 'Whenever you gain life, this creature gets +1/+0 until end of turn. Then destroy all other creatures if its power is exactly 4.', ['3', '3']);
  const SIP = card('Test Sip', 'Instant', 'You gain 1 life.');
  it('is automated; at power 4 the other creatures are destroyed, at any other power they are not', () => {
    expect(automated(AMALIA)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Amalia'], hand: ['Test Sip', 'Test Sip'] }, p2: { battlefield: ['Test Bear'] }, defs: [AMALIA, SIP, BEAR] });
    s = cast(s, 'Test Sip'); // 4/3: destroy
    expect(findAll(s, 'Test Bear', 'battlefield', 'p2')).toHaveLength(0);
    expect(findAll(s, 'Test Amalia', 'battlefield', 'p1')).toHaveLength(1);
  });
});

describe('CR 608.2c: "If you do, X. If you don\'t, Y." — "you don\'t" reads the instruction the "If you do" sentence reads (lower/conditions.ts#resolveDid)', () => {
  const OFFER = card('Test Offer', 'Sorcery', "You may sacrifice a creature. If you do, draw a card. If you don't, you lose 2 life.");
  it('is automated; sacrificing draws and keeps the life, declining loses 2 life and draws nothing', () => {
    expect(automated(OFFER)).toBe(true);
    const start = (): GameState => scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Offer'], library: ['Test Ox', 'Test Ox'] }, defs: [OFFER, BEAR, OX] });
    let s = start();
    const hand0 = s.zones.hand.p1!.length;
    s = cast(s, 'Test Offer', { answers: [{ kind: 'yesNo', yes: true }], picks: [[find(s, 'Test Bear', 'battlefield', 'p1')]] });
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(0);
    expect(s.zones.hand.p1!.length).toBe(hand0); // the Offer left, one card drawn
    expect(life(s, 'p1')).toBe(20);
    s = start();
    s = cast(s, 'Test Offer', { answers: [{ kind: 'yesNo', yes: false }] });
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toHaveLength(1);
    expect(s.zones.hand.p1!.length).toBe(hand0 - 1);
    expect(life(s, 'p1')).toBe(18);
  });
});

describe('CR 608.2h, 112.7a: "Sacrifice ~: Create a token for each corpse counter on ~." (eff.fxb.token.forEach.counterKind) reads the counters the source had as it was sacrificed', () => {
  const CRYPT = card('Test Crypt', 'Artifact', '{T}, Sacrifice this artifact: Create a 1/1 black Zombie creature token for each corpse counter on this artifact.');
  it('is automated; three corpse counters make three tokens after the artifact is gone', () => {
    expect(automated(CRYPT)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Crypt'] }, defs: [CRYPT] });
    const crypt = find(s, 'Test Crypt', 'battlefield', 'p1');
    s = tweak(s, (x) => { x.objects[crypt]!.counters.corpse = 3; });
    s = activate(s, crypt);
    expect(findAll(s, 'Test Crypt', 'battlefield', 'p1')).toHaveLength(0);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(3);
  });
});

describe('CR 603.10a, 608.2h: a dies trigger that counts "~"\'s counters or reads "~"\'s power uses the creature as it last existed on the battlefield', () => {
  const WALKER = card('Test Walker', 'Artifact Creature — Construct', 'When this creature dies, create a 1/1 colorless Thopter artifact creature token with flying for each +1/+1 counter on this creature.', ['1', '1']);
  const NEST = card('Test Nest', 'Creature — Squirrel', "When this creature dies, create X tapped 1/1 green Squirrel creature tokens, where X is this creature's power.", ['1', '1']);
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  it('two +1/+1 counters make two Thopters; a 3/3 (two counters on a 1/1) makes three tapped Squirrels', () => {
    expect(automated(WALKER)).toBe(true);
    expect(automated(NEST)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Walker', 'Test Nest'], hand: ['Test Kill', 'Test Kill'] }, defs: [WALKER, NEST, KILL] });
    const walker = find(s, 'Test Walker', 'battlefield', 'p1');
    const nest = find(s, 'Test Nest', 'battlefield', 'p1');
    s = tweak(s, (x) => { x.objects[walker]!.counters['+1/+1'] = 2; x.objects[nest]!.counters['+1/+1'] = 2; });
    s = cast(s, 'Test Kill', { targets: [[obj(walker)]] });
    const tokens = (st: GameState) => st.zones.battlefield.filter((id) => st.objects[id]!.kind === 'token');
    expect(tokens(s)).toHaveLength(2);
    s = cast(s, 'Test Kill', { targets: [[obj(nest)]] });
    const squirrels = tokens(s).filter((id) => getChars(s, id).subtypes.includes('Squirrel'));
    expect(squirrels).toHaveLength(3);
    expect(squirrels.every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});
