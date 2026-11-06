/**
 * Commander band 5,001-10,000, group counters part 3, round edh-d-94: the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 118.3, 400.3, 607.2a      cost part "Put a creature card exiled with ~ into its owner's graveyard" (Shelob, Dread Weaver)
 *   CR 406.1, 608.2c, 608.2h     "Exile all creatures. Each player creates a 0/0 ... token and puts a number of +1/+1 counters on it equal to the total power of creatures they
 *                                controlled that were exiled this way." (Oversimplify)
 *   CR 701.26a, 107.14, 608.2c   "Tap all creatures target player controls. You may pay any amount of {E}. If you do, choose up to that many creatures tapped this way. Put a stun
 *                                counter on each of them." (Suppression Ray)
 *   CR 614.1a, 603.12, 118.12    "If a nontoken creature an opponent controls would die, exile it instead. When you do, you may pay {2}. If you do, create a 1/1 black and green
 *                                Pest creature token with \"When this token dies, you gain 1 life.\"" (Valentin, Dean of the Vein)
 *   CR 701.20a, 603.12, 202.3    "Reveal cards ... until you reveal a creature card. Put that card into your hand and the rest on the bottom ... When you reveal a creature card this
 *                                way, put X +1/+1 counters on target creature you control, where X is the mana value of that card." (Yuna's Whistle)
 *   CR 111.1, 122.6, 614.1c      "... create a 0/0 green Ooze creature token with trample. The token enters with X +1/+1 counters on it, where X is the number of other creatures you
 *                                control." (Printlifter Ooze)
 *   CR 205.3j, 614.12a, 120.3c   "As ~ enters, choose a planeswalker type. Planeswalkers you control of the chosen type have hexproof. As long as you control a creature, if damage
 *                                dealt to a planeswalker you control of the chosen type would result in all loyalty counters on it being removed, instead all but one ..." (Deification)
 *   CR 122.1, 122.6, 608.2c      "Choose a kind of counter on a creature you control. Put a counter of that kind on each other creature you control." (Contractual Safeguard)
 *   CR 400.7j, 702.62a-b         "{2}, Exile a nonland card from your hand: Put four time counters on the exiled card. If it doesn't have suspend, it gains suspend." (Jhoira of the Ghitu)
 */
import { describe, expect, it } from 'vitest';
import { type GameState, type ObjectId } from '../../../src/index';
import { act, answer, find, mpScenario } from '../../m12/rules/helpers';
import { card, counters, full, named, resolveAll as settleAll } from '../cmd3/helpers';
import { getChars } from '../../../src/rules/characteristics';
import { compileCard, type OracleCard } from '../../../src/index';
import { advanceTo, pass, scenario } from '../../m3/scenario';

const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
const onBf = (s: GameState, p: string, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
const inExile = (st: GameState, defId: string): ObjectId[] => (st.zones.exile ?? []).filter((id) => st.objects[id]!.defId === defId);
const inYardOf = (st: GameState, p: string, defId: string): boolean => (st.zones.graveyard[p] ?? []).some((id) => st.objects[id]!.defId === defId);
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;

describe('CR 118.3, 400.3, 607.2a: the cost "Put a creature card exiled with ~ into its owner\'s graveyard"', () => {
  const SPINNER = card('Test Dread Spinner', 'Legendary Creature — Spider Demon', "Whenever a nontoken creature an opponent controls dies, exile it.\n{2}, Put a creature card exiled with ~ into its owner's graveyard: Put two +1/+1 counters on ~. Draw a card.", ['3', '3']);
  const KILL = card('Test Slay', 'Instant', 'Destroy target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  const defs = [SPINNER, KILL, BEAR, OGRE];
  const killed = (s0: GameState, victim: ObjectId): GameState => settleAll(answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Slay', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [obj(victim)] }));
  const activate = (s0: GameState, pick?: ObjectId): GameState => settleAll(act(s0, { type: 'activate', player: 'p1', source: onBf(s0, 'p1', 'Test Dread Spinner')[0]!, ability: 'p:0:1' } as never), pick ? { objects: [pick] } : {});
  const start = (extra: { p2bf?: string[]; p3exile?: string[] } = {}): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Slay'], battlefield: ['Test Dread Spinner', 'Plains', 'Plains'] }, p2: { battlefield: extra.p2bf ?? ['Test Bear'] }, p3: { exile: extra.p3exile ?? [] } } });
  it('is automated', () => expect(full(SPINNER)).toBe(true));
  it('the opponent\'s creature it exiled pays the cost: it goes to its owner\'s graveyard, ~ gets two counters and you draw', () => {
    const s0 = start();
    const s1 = killed(s0, onBf(s0, 'p2', 'Test Bear')[0]!);
    expect(inExile(s1, 'Test Bear').length).toBe(1);
    const h = handSize(s1, 'p1');
    const s = activate(s1);
    expect(inYardOf(s, 'p2', 'Test Bear')).toBe(true);
    expect(inExile(s, 'Test Bear').length).toBe(0);
    expect(counters(s, named(s, 'Test Dread Spinner')[0]!, '+1/+1')).toBe(2);
    expect(handSize(s, 'p1')).toBe(h + 1);
  });
  it('negative: a creature card in exile that ~ did not exile can\'t pay the cost (CR 607.2a)', () => {
    const s0 = start({ p3exile: ['Test Ogre'] });
    expect(() => activate(s0)).toThrow();
    expect(inExile(s0, 'Test Ogre').length).toBe(1);
  });
  it('negative: with a card it exiled and an unlinked one, only the linked one is offered', () => {
    const s0 = start({ p3exile: ['Test Ogre'] });
    const s1 = killed(s0, onBf(s0, 'p2', 'Test Bear')[0]!);
    const ogre = inExile(s1, 'Test Ogre')[0]!;
    let s = act(s1, { type: 'activate', player: 'p1', source: onBf(s1, 'p1', 'Test Dread Spinner')[0]!, ability: 'p:0:1' } as never);
    const d = s.pending as { kind: string; options?: ObjectId[] };
    if (d.kind === 'chooseObjects') expect(d.options).not.toContain(ogre); // (with one candidate the payment may pick it without asking)
    s = settleAll(s);
    expect(inYardOf(s, 'p2', 'Test Bear')).toBe(true);
    expect(inExile(s, 'Test Ogre')).toEqual([ogre]);
  });
  it('negative: a card that left exile and came back is a new object, no longer exiled with ~ (Shelob ruling 2023-06-16, CR 400.7)', () => {
    const s0 = start();
    const s1 = killed(s0, onBf(s0, 'p2', 'Test Bear')[0]!);
    const bear = inExile(s1, 'Test Bear')[0]!;
    // the card leaves exile for the graveyard and is exiled again by another effect: a new object (move it by hand as a rules-neutral setup)
    const s2 = structuredClone(s1);
    s2.zones.exile = s2.zones.exile.filter((id) => id !== bear);
    const fresh = `${bear}-again` as ObjectId;
    s2.objects[fresh] = { ...s2.objects[bear]!, id: fresh };
    delete s2.objects[bear];
    s2.zones.exile.push(fresh);
    expect(() => activate(s2)).toThrow();
  });
});

describe('CR 118.3, 607.2a, 614.1a: the same cost paid with a card a replacement effect of the object exiled ("If another creature would die, exile it instead.", Void Maw\'s wording, newly full)', () => {
  const MAW = card('Test Hungry Maw', 'Creature — Horror', "If another creature would die, exile it instead.\nPut a card exiled with ~ into its owner's graveyard: ~ gets +2/+2 until end of turn.", ['4', '4']);
  const KILL = card('Test Slay', 'Instant', 'Destroy target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [MAW, KILL, BEAR];
  it('is automated', () => expect(full(MAW)).toBe(true));
  it('the creature its replacement exiled pays the cost and ~ gets +2/+2', async () => {
    const { pt } = await import('../cmd3/helpers');
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Slay'], battlefield: ['Test Hungry Maw'] }, p2: { battlefield: ['Test Bear'] } } });
    const s1 = settleAll(answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Slay', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [obj(onBf(s0, 'p2', 'Test Bear')[0]!)] }));
    expect(inExile(s1, 'Test Bear').length).toBe(1);
    const s = settleAll(act(s1, { type: 'activate', player: 'p1', source: onBf(s1, 'p1', 'Test Hungry Maw')[0]!, ability: 'p:0:1' } as never));
    expect(inYardOf(s, 'p2', 'Test Bear')).toBe(true);
    expect(pt(s, onBf(s, 'p1', 'Test Hungry Maw')[0]!)).toBe('6/6');
  });
  it('negative: a card in exile the object did not exile can\'t pay it', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Hungry Maw'] }, p2: { exile: ['Test Bear'] } } });
    expect(() => act(s0, { type: 'activate', player: 'p1', source: onBf(s0, 'p1', 'Test Hungry Maw')[0]!, ability: 'p:0:1' } as never)).toThrow();
  });
});

describe('CR 400.7j, 702.62a-b: "{2}, Exile a nonland card from your hand: Put four time counters on the exiled card. If it doesn\'t have suspend, it gains suspend."', () => {
  const SAGE = card('Test Time Sage', 'Legendary Creature — Human Wizard', "{2}, Exile a nonland card from your hand: Put four time counters on the exiled card. If it doesn't have suspend, it gains suspend.", ['3', '3']);
  const BOLT = card('Test Spark', 'Sorcery', 'You gain 3 life.', undefined, '{3}');
  const SLOW = card('Test Slow Spark', 'Sorcery', 'Suspend 2--{R}\nYou gain 2 life.', undefined, '{4}');
  const defs = [SAGE, BOLT, SLOW];
  const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
  const time = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['time'] ?? 0;
  const activate = (s0: GameState, pick: string): GameState => {
    const id = s0.zones.hand['p1']!.find((x) => s0.objects[x]!.defId === pick)!;
    return settleAll(act(s0, { type: 'activate', player: 'p1', source: onBf(s0, 'p1', 'Test Time Sage')[0]!, ability: 'p:0:0' } as never), { objects: [id] });
  };
  const start = (hand: string[]): GameState => scenario(['Plains'], { p1: { battlefield: ['Test Time Sage', 'Plains', 'Plains'], hand }, defs });
  it('is automated', () => expect(full(SAGE)).toBe(true));
  it('the card the cost exiled from your hand gets four time counters and gains suspend (CR 400.7j: the effect finds it in exile)', () => {
    const s = activate(start(['Test Spark']), 'Test Spark');
    const id = inExile(s, 'Test Spark')[0]!;
    expect(time(s, id)).toBe(4);
    expect(kws(s, id)).toContain('suspend');
  });
  it('suspend works on it: at its owner\'s next upkeep one time counter is removed (CR 702.62a)', () => {
    const s1 = activate(start(['Test Spark']), 'Test Spark');
    const s = advanceTo(s1, 3, 'draw');
    expect(time(s, inExile(s, 'Test Spark')[0]!)).toBe(3);
  });
  it('negative: a card that already has suspend keeps its one suspend (it is not given a second one)', () => {
    const s = activate(start(['Test Slow Spark']), 'Test Slow Spark');
    const id = inExile(s, 'Test Slow Spark')[0]!;
    expect(time(s, id)).toBe(4);
    expect(kws(s, id).filter((k) => k === 'suspend')).toHaveLength(1);
  });
  it('negative: a land card can\'t be exiled for the cost (nonland), so with only a land in hand it can\'t be activated', () => {
    const s0 = start(['Plains']);
    expect(() => activate(s0, 'Plains')).toThrow();
  });
});

describe('CR 406.1, 608.2c, 608.2h: "Exile all creatures. Each player creates a 0/0 ... token and puts a number of +1/+1 counters on it equal to the total power of creatures they controlled that were exiled this way."', () => {
  const SIMPLE = card('Test Simplify', 'Sorcery', 'Exile all creatures. Each player creates a 0/0 green and blue Fractal creature token and puts a number of +1/+1 counters on it equal to the total power of creatures they controlled that were exiled this way.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  const defs = [SIMPLE, BEAR, OGRE];
  const fractal = (s: GameState, p: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
  const play = (s0: GameState): GameState => settleAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Simplify', 'hand', 'p1') }));
  it('is automated', () => expect(full(SIMPLE)).toBe(true));
  it('each player\'s token gets the total power of the creatures THAT player controlled: 5 for p1, 3 for p2', () => {
    const s = play(mpScenario({ defs, zones: { p1: { hand: ['Test Simplify'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Ogre'] } } }));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind !== 'token' && ['Test Bear', 'Test Ogre'].includes(s.objects[id]!.defId))).toEqual([]);
    expect(counters(s, fractal(s, 'p1')[0]!, '+1/+1')).toBe(5);
    expect(counters(s, fractal(s, 'p2')[0]!, '+1/+1')).toBe(3);
  });
  it('the power is read as the creatures last existed on the battlefield, counters included (Oversimplify ruling 2021-04-16, CR 608.2h)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Simplify'] }, p2: { battlefield: ['Test Bear'] } }, setup: (st) => { const b = st.zones.battlefield.find((id) => st.objects[id]!.defId === 'Test Bear')!; st.objects[b]!.counters['+1/+1'] = 2; } });
    const s = play(s0);
    expect(counters(s, fractal(s, 'p2')[0]!, '+1/+1')).toBe(4);
  });
  it('negative: a player who controlled no creature gets no counters: the 0/0 token dies (CR 704.5f), and a creature an opponent controlled is not counted for you', () => {
    const s = play(mpScenario({ defs, zones: { p1: { hand: ['Test Simplify'] }, p2: { battlefield: ['Test Ogre'] } } }));
    expect(fractal(s, 'p1')).toEqual([]);
    expect(fractal(s, 'p3')).toEqual([]);
    expect(counters(s, fractal(s, 'p2')[0]!, '+1/+1')).toBe(3);
  });
  it('a creature an opponent owns but you control counts for you, the controller (CR 608.2h: controlled as it last existed)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Simplify'] }, p2: { battlefield: ['Test Ogre'] } }, setup: (st) => { const o = st.zones.battlefield.find((id) => st.objects[id]!.defId === 'Test Ogre')!; st.objects[o]!.controller = 'p1'; } });
    const s = play(s0);
    expect(counters(s, fractal(s, 'p1')[0]!, '+1/+1')).toBe(3);
    expect(fractal(s, 'p2')).toEqual([]);
  });
});

describe('CR 701.26a, 107.14, 608.2c: "Tap all creatures target player controls. You may pay any amount of {E}. If you do, choose up to that many creatures tapped this way. Put a stun counter on each of them."', () => {
  const RAY = card('Test Stun Beam', 'Sorcery', 'Tap all creatures target player controls. You may pay any amount of {E}. If you do, choose up to that many creatures tapped this way. Put a stun counter on each of them.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [RAY, BEAR];
  const energy = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;
  const bears = (s: GameState, p: string): ObjectId[] => onBf(s, p, 'Test Bear');
  /** p1 casts the beam at p2, pays `n` energy and chooses `pick` (or as many as allowed, in order). */
  const play = (s0: GameState, n: number, pick?: ObjectId[]): { s: GameState; offered: ObjectId[]; max: number } => {
    let s = answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Stun Beam', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    let offered: ObjectId[] = [];
    let max = -1;
    for (let g = 0; g < 40; g++) {
      if (s.pending?.kind === 'priority') { if (s.zones.stack.length === 0) break; s = act(s, { type: 'pass', player: s.pending.player }); continue; }
      const d = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number };
      if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n } as never);
      else if (d.kind === 'chooseObjects') { offered = d.options!; max = d.max!; s = answer(s, { kind: 'chooseObjects', ids: pick ?? d.options!.slice(0, d.max) }); }
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else throw new Error(`unexpected ${d.kind}`);
    }
    return { s, offered, max };
  };
  const start = (e: number, tappedFirst = false): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Stun Beam'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] } }, setup: (st) => {
    st.players.find((x) => x.id === 'p1')!.counters['energy'] = e;
    if (tappedFirst) st.objects[st.zones.battlefield.filter((id) => st.objects[id]!.defId === 'Test Bear' && st.objects[id]!.controller === 'p2')[0]!]!.tapped = true;
  } });
  it('is automated', () => expect(full(RAY)).toBe(true));
  it('taps every creature of the target player; paying 2 {E} lets you put stun counters on two of them', () => {
    const r = play(start(3), 2);
    expect(bears(r.s, 'p2').every((id) => r.s.objects[id]!.tapped)).toBe(true);
    expect(energy(r.s, 'p1')).toBe(1);
    expect(r.max).toBe(2);
    expect(bears(r.s, 'p2').filter((id) => counters(r.s, id, 'stun') === 1)).toHaveLength(2);
    expect(r.s.objects[bears(r.s, 'p1')[0]!]!.tapped).toBe(false); // your own creature is not the target player's
  });
  it('negative: a creature that was already tapped is not "tapped this way" and can\'t be chosen (Suppression Ray ruling 2024-06-07)', () => {
    const s0 = start(3, true);
    const already = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Bear' && s0.objects[id]!.controller === 'p2' && s0.objects[id]!.tapped)!;
    const r = play(s0, 3);
    expect(r.offered).not.toContain(already);
    expect(r.offered).toHaveLength(2);
    expect(counters(r.s, already, 'stun')).toBe(0);
  });
  it('negative: paying no energy stuns nothing (the creatures are still tapped)', () => {
    const r = play(start(3), 0);
    expect(energy(r.s, 'p1')).toBe(3);
    expect(bears(r.s, 'p2').every((id) => r.s.objects[id]!.tapped && counters(r.s, id, 'stun') === 0)).toBe(true);
  });
  it('"up to": paying 3 {E} you may still choose just one', () => {
    const s0 = start(3);
    const one = bears(s0, 'p2')[0]!;
    const r = play(s0, 3, [one]);
    expect(energy(r.s, 'p1')).toBe(0);
    expect(counters(r.s, one, 'stun')).toBe(1);
    expect(bears(r.s, 'p2').filter((id) => counters(r.s, id, 'stun') === 1)).toHaveLength(1);
  });
});

describe('CR 614.1a, 603.12, 118.12: "If a nontoken creature an opponent controls would die, exile it instead. When you do, you may pay {2}. If you do, create a 1/1 ... Pest creature token with \"When this token dies, you gain 1 life.\""', () => {
  const DEAN = card('Test Vein Dean', 'Legendary Creature — Vampire Warlock', 'Menace, lifelink\nIf a nontoken creature an opponent controls would die, exile it instead. When you do, you may pay {2}. If you do, create a 1/1 black and green Pest creature token with "When this token dies, you gain 1 life."', ['4', '2']);
  const KILL = card('Test Slay', 'Instant', 'Destroy target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [DEAN, KILL, BEAR];
  const pests = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
  const slay = (s0: GameState, victim: ObjectId, yes: boolean): GameState => settleAll(answer(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Slay', 'hand', 'p1') }), { kind: 'chooseTargets', targets: [obj(victim)] }), { yes });
  const start = (mine = false): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Slay'], battlefield: ['Test Vein Dean', 'Plains', 'Plains', ...(mine ? ['Test Bear'] : [])] }, p2: { battlefield: ['Test Bear'] } } });
  it('is automated', () => expect(full(DEAN)).toBe(true));
  it('the opponent\'s dying creature is exiled instead; paying {2} makes the Pest token', () => {
    const s0 = start();
    const s = slay(s0, onBf(s0, 'p2', 'Test Bear')[0]!, true);
    expect(inExile(s, 'Test Bear').length).toBe(1);
    expect(inYardOf(s, 'p2', 'Test Bear')).toBe(false);
    expect(pests(s)).toHaveLength(1);
  });
  it('negative: declining the payment makes no token, but the creature is still exiled (the replacement is not optional)', () => {
    const s0 = start();
    const s = slay(s0, onBf(s0, 'p2', 'Test Bear')[0]!, false);
    expect(inExile(s, 'Test Bear').length).toBe(1);
    expect(pests(s)).toHaveLength(0);
  });
  it('negative: your own creature dying is not replaced and triggers nothing', () => {
    const s0 = start(true);
    const s = slay(s0, onBf(s0, 'p1', 'Test Bear')[0]!, true);
    expect(inYardOf(s, 'p1', 'Test Bear')).toBe(true);
    expect(pests(s)).toHaveLength(0);
  });
  it('the Pest\'s own ability: when it dies, its controller gains 1 life (a token dying is not replaced: the replacement is of nontoken creatures)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Slay', 'Test Slay'], battlefield: ['Test Vein Dean', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Bear'] } } });
    const s1 = slay(s0, onBf(s0, 'p2', 'Test Bear')[0]!, true);
    const pest = pests(s1)[0]!;
    const life0 = s1.players.find((x) => x.id === 'p1')!.life;
    const s = slay(s1, pest, true);
    expect(pests(s)).toHaveLength(0);
    expect(s.players.find((x) => x.id === 'p1')!.life).toBe(life0 + 1);
  });
});

describe('CR 701.20a, 603.12, 202.3: "Reveal cards ... until you reveal a creature card. ... When you reveal a creature card this way, put X +1/+1 counters on target creature you control, where X is the mana value of that card."', () => {
  const WHISTLE = card('Test Call Whistle', 'Instant', 'Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order. When you reveal a creature card this way, put X +1/+1 counters on target creature you control, where X is the mana value of that card.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const GIANT = card('Test Giant', 'Creature — Giant', '', ['4', '4'], '{2}{G}{G}');
  const HYDRA = card('Test X Hydra', 'Creature — Hydra', '', ['0', '0'], '{X}{G}');
  const defs = [WHISTLE, BEAR, GIANT, HYDRA];
  const mine = (s: GameState): ObjectId => onBf(s, 'p1', 'Test Bear')[0]!;
  /** Cast it (no target yet), then answer the reflexive trigger's target with `target`. */
  const play = (s0: GameState, target?: ObjectId): { s: GameState; asked: boolean } => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Call Whistle', 'hand', 'p1') });
    let asked = false;
    for (let g = 0; g < 40; g++) {
      if (s.pending?.kind === 'priority') { if (s.zones.stack.length === 0) break; s = act(s, { type: 'pass', player: s.pending.player }); continue; }
      const d = s.pending as unknown as { kind: string };
      if (d.kind === 'chooseTargets') { asked = true; s = answer(s, { kind: 'chooseTargets', targets: [obj(target ?? mine(s))] }); }
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
      else throw new Error(`unexpected ${d.kind}`);
    }
    return { s, asked };
  };
  // the first card of the library given is drawn in the draw step of turn 1 (m12/rules/helpers.ts#mpScenario): a Plains in front of the named cards
  const start = (library: string[]): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Call Whistle'], battlefield: ['Test Bear'], library: ['Plains', ...library] } } });
  it('is automated', () => expect(full(WHISTLE)).toBe(true));
  it('the first creature card revealed goes to your hand and its mana value (4) is the number of counters on the target chosen as the trigger goes on the stack', () => {
    const s0 = start(['Plains', 'Test Giant', 'Test Bear']);
    const r = play(s0);
    expect(r.asked).toBe(true);
    expect(r.s.zones.hand['p1']!.some((id) => r.s.objects[id]!.defId === 'Test Giant')).toBe(true);
    expect(counters(r.s, mine(r.s), '+1/+1')).toBe(4);
    const lib = r.s.zones.library['p1']!;
    expect(r.s.objects[lib[0]!]!.defId).toBe('Test Bear'); // the card after the Giant is still on top: the reveal stopped at the Giant
    expect(lib.length).toBe(s0.zones.library['p1']!.length - 1);
  });
  it('X in the found card\'s mana cost is 0: {X}{G} gives one counter (Yuna\'s Whistle ruling 2025-06-06, CR 202.3e)', () => {
    const r = play(start(['Test X Hydra']));
    expect(counters(r.s, mine(r.s), '+1/+1')).toBe(1);
  });
  it('negative: with no creature card in the library nothing triggers: no target is asked and no counters are put', () => {
    const r = play(mpScenario({ defs, zones: { p1: { hand: ['Test Call Whistle'], battlefield: ['Test Bear'] } } }));
    expect(r.asked).toBe(false);
    expect(counters(r.s, mine(r.s), '+1/+1')).toBe(0);
  });
});

describe('CR 111.1, 122.6, 614.1c, 708.8: "... create a 0/0 green Ooze creature token with trample. The token enters with X +1/+1 counters on it, where X is the number of other creatures you control."', () => {
  const OOZE = card('Test Print Ooze', 'Creature — Ooze', 'Deathtouch\nWhenever this creature or another creature you control is turned face up, create a 0/0 green Ooze creature token with trample. The token enters with X +1/+1 counters on it, where X is the number of other creatures you control.\nDisguise {0}', ['1', '2'], '{1}{G}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const SPY = card('Test Hidden Spy', 'Creature — Rogue', 'Disguise {0}', ['3', '3'], '{2}{U}');
  const defs = [OOZE, BEAR, SPY];
  const oozeTokens = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
  const faceDown = (st: GameState, defId: string): void => { const id = st.zones.battlefield.find((x) => st.objects[x]!.defId === defId)!; Object.assign(st.objects[id]!, { faceDown: true, faceDownInfo: { by: 'disguise', profile: 'ward2' } }); };
  const turnUp = (s0: GameState, defId: string): GameState => settleAll(act(s0, { type: 'special', player: 'p1', kind: 'turnFaceUp', object: s0.zones.battlefield.find((x) => s0.objects[x]!.defId === defId)!, via: 'disguise' } as never));
  it('is automated', () => expect(full(OOZE)).toBe(true));
  it('turning another creature face up: the token gets one counter for each creature you control besides it (the Ooze, the Spy and a Bear: 3)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Print Ooze', 'Test Hidden Spy', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } }, setup: (st) => faceDown(st, 'Test Hidden Spy') });
    const s = turnUp(s0, 'Test Hidden Spy');
    expect(oozeTokens(s)).toHaveLength(1);
    expect(counters(s, oozeTokens(s)[0]!, '+1/+1')).toBe(3);
  });
  it('turning the Ooze itself face up triggers too; an opponent\'s creature is not counted (Ooze + Bear: 2)', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Print Ooze', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } }, setup: (st) => faceDown(st, 'Test Print Ooze') });
    const s = turnUp(s0, 'Test Print Ooze');
    expect(counters(s, oozeTokens(s)[0]!, '+1/+1')).toBe(2);
  });
  it('negative: a creature that enters face up is not "turned face up": no token', async () => {
    const { cast } = await import('../cmd3/helpers');
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Print Ooze'], hand: ['Test Bear'] } } });
    const s = settleAll(cast(s0, 'Test Bear'));
    expect(oozeTokens(s)).toHaveLength(0);
  });
});

describe('CR 205.3j, 614.12a, 120.3c, 614.1a: Deification ("choose a planeswalker type"; hexproof; damage leaves one loyalty counter while you control a creature)', () => {
  const DEIFY = card('Test Apotheosis', 'Enchantment', "As this enchantment enters, choose a planeswalker type.\nPlaneswalkers you control of the chosen type have hexproof.\nAs long as you control a creature, if damage dealt to a planeswalker you control of the chosen type would result in all loyalty counters on it being removed, instead all but one of those counters are removed.");
  const walker = (name: string, sub: string): ReturnType<typeof card> => compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: `Legendary Planeswalker — ${sub}`, oracle_text: '+1: You gain 1 life.', colors: [], loyalty: '3' } as OracleCard);
  const JACE = walker('Test Mind Mage', 'Jace');
  const CHANDRA = walker('Test Pyromancer', 'Chandra');
  const BOLT = card('Test Quake', 'Instant', 'Test Quake deals 5 damage to each planeswalker.');
  const TREMOR = card('Test Tremor', 'Instant', 'Test Tremor deals 2 damage to each planeswalker.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [DEIFY, JACE, CHANDRA, BOLT, TREMOR, BEAR];
  const loyalty = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['loyalty'] ?? -1;
  const enter = (bf: string[], pick = 'Jace'): GameState => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Apotheosis'], battlefield: bf }, p2: { hand: ['Test Quake', 'Test Tremor'] } }, setup: (st) => { for (const id of st.zones.battlefield) if (st.objects[id]!.defId.startsWith('Test P') || st.objects[id]!.defId === 'Test Mind Mage') st.objects[id]!.counters['loyalty'] = 3; } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Apotheosis', 'hand', 'p1') });
    for (let g = 0; g < 30 && s.zones.stack.length + (s.pending?.kind === 'priority' ? 0 : 1) > 0; g++) {
      if (s.pending?.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: pick } as never);
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else s = settleAll(s);
    }
    return s;
  };
  /** p2 casts the quake (5 damage to each planeswalker), or another spell of its hand. */
  const quake = (s0: GameState, name = 'Test Quake'): GameState => {
    let s = s0;
    for (let g = 0; g < 8 && s.pending?.kind === 'priority' && s.pending.player !== 'p2'; g++) s = act(s, { type: 'pass', player: s.pending.player });
    return settleAll(act(s, { type: 'cast', player: 'p2', card: find(s, name, 'hand', 'p2') }));
  };
  it('is automated', () => expect(full(DEIFY)).toBe(true));
  it('the chosen type\'s planeswalker has hexproof; another type\'s has not', () => {
    const s = enter(['Test Mind Mage', 'Test Pyromancer', 'Test Bear']);
    const kw = (id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
    expect(kw(onBf(s, 'p1', 'Test Mind Mage')[0]!)).toContain('hexproof');
    expect(kw(onBf(s, 'p1', 'Test Pyromancer')[0]!)).not.toContain('hexproof');
  });
  it('5 damage to each planeswalker: the chosen type\'s keeps one loyalty counter while you control a creature; the other type\'s dies (CR 704.5i)', () => {
    const s = quake(enter(['Test Mind Mage', 'Test Pyromancer', 'Test Bear'], 'Jace'));
    const jace = onBf(s, 'p1', 'Test Mind Mage')[0]!;
    expect(loyalty(s, jace)).toBe(1);
    expect(onBf(s, 'p1', 'Test Pyromancer')).toEqual([]);
  });
  it('negative: without a creature the planeswalker of the chosen type loses every counter and dies', () => {
    const s = quake(enter(['Test Mind Mage'], 'Jace'));
    expect(onBf(s, 'p1', 'Test Mind Mage')).toEqual([]);
  });
  it('negative: damage that does not remove every counter is not changed (2 damage: 3 -> 1)', () => {
    const s = quake(enter(['Test Mind Mage', 'Test Bear'], 'Jace'), 'Test Tremor');
    expect(loyalty(s, onBf(s, 'p1', 'Test Mind Mage')[0]!)).toBe(1);
  });
  it('an opponent\'s planeswalker of the chosen type is not protected ("you control")', () => {
    const s0 = enter(['Test Bear'], 'Jace');
    const s1 = structuredClone(s0);
    const id = 'opp-jace' as ObjectId;
    s1.objects[id] = { ...structuredClone(s1.objects[onBf(s1, 'p1', 'Test Bear')[0]!]!), id, defId: 'Test Mind Mage', owner: 'p3', controller: 'p3', counters: { loyalty: 3 } };
    s1.zones.battlefield.push(id);
    const s = quake(s1);
    expect(s.zones.battlefield.includes(id)).toBe(false);
  });
});

describe('CR 122.1, 122.6, 608.2c, 207.2c (Addendum): Contractual Safeguard ("Choose a kind of counter on a creature you control. Put a counter of that kind on each other creature you control.")', () => {
  const GUARD = card('Test Safeguard Pact', 'Instant', 'Addendum — If you cast this spell during your main phase, put a shield counter on a creature you control. (If it would be dealt damage or destroyed, remove a shield counter from it instead.)\nChoose a kind of counter on a creature you control. Put a counter of that kind on each other creature you control.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  const defs = [GUARD, BEAR, OGRE];
  /** Cast it; the decisions in order: the creature for the shield counter (if asked), the creature whose counter kind is chosen, the kind. */
  const play = (s0: GameState, picks: { shieldOn?: ObjectId; holder?: ObjectId; kind?: string }): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Safeguard Pact', 'hand', 'p1') });
    let objectAsks = 0;
    for (let g = 0; g < 40; g++) {
      if (s.pending?.kind === 'priority') { if (s.zones.stack.length === 0) break; s = act(s, { type: 'pass', player: s.pending.player }); continue; }
      const d = s.pending as unknown as { kind: string; options: { id: string; label: string }[] | ObjectId[] };
      if (d.kind === 'chooseObjects') {
        const want = objectAsks++ === 0 && picks.shieldOn !== undefined ? picks.shieldOn : picks.holder;
        s = answer(s, { kind: 'chooseObjects', ids: [want ?? (d.options as ObjectId[])[0]!] });
      } else if (d.kind === 'chooseOption') {
        const o = (d.options as { id: string; label: string }[]).find((x) => x.label === picks.kind) ?? (d.options as { id: string }[])[0]!;
        s = answer(s, { kind: 'chooseOption', ids: [o.id] });
      } else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected ${d.kind}`);
    }
    return s;
  };
  const start = (setup: (st: GameState) => void = () => {}): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Safeguard Pact'], battlefield: ['Test Bear', 'Test Ogre', 'Test Ogre'] }, p2: { battlefield: ['Test Bear'] } }, setup });
  const ids = (s: GameState): { bear: ObjectId; ogres: ObjectId[]; theirs: ObjectId } => ({ bear: onBf(s, 'p1', 'Test Bear')[0]!, ogres: onBf(s, 'p1', 'Test Ogre'), theirs: onBf(s, 'p2', 'Test Bear')[0]! });
  it('is automated', () => expect(full(GUARD)).toBe(true));
  it('in your main phase: a shield counter on one creature, then that kind chosen on it puts a shield counter on each OTHER creature you control (ruling 2022-04-29)', () => {
    const s0 = start();
    const { bear, ogres, theirs } = ids(s0);
    const s = play(s0, { shieldOn: bear, holder: bear, kind: 'shield' });
    expect(counters(s, bear, 'shield')).toBe(1);
    expect(ogres.map((o) => counters(s, o, 'shield'))).toEqual([1, 1]);
    expect(counters(s, theirs, 'shield')).toBe(0);
  });
  it('choosing another kind on another creature: +1/+1 from an Ogre goes on the Bear and the other Ogre, not on that Ogre again', () => {
    const s0 = start((st) => { const o = st.zones.battlefield.find((id) => st.objects[id]!.defId === 'Test Ogre')!; st.objects[o]!.counters['+1/+1'] = 2; });
    const { bear, ogres } = ids(s0);
    const pumped = ogres.find((o) => (s0.objects[o]!.counters['+1/+1'] ?? 0) === 2)!;
    const other = ogres.find((o) => o !== pumped)!;
    const s = play(s0, { shieldOn: bear, holder: pumped, kind: '+1/+1' });
    expect(counters(s, pumped, '+1/+1')).toBe(2);
    expect(counters(s, bear, '+1/+1')).toBe(1);
    expect(counters(s, other, '+1/+1')).toBe(1);
  });
  it('negative: a creature without counters can\'t be the one the kind is chosen on (only creatures with a counter are offered)', () => {
    const s0 = start();
    const { bear, ogres } = ids(s0);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Safeguard Pact', 'hand', 'p1') });
    for (let g = 0; g < 20 && s.pending?.kind === 'priority'; g++) s = act(s, { type: 'pass', player: s.pending.player });
    s = answer(s, { kind: 'chooseObjects', ids: [bear] }); // the shield counter on the Bear
    const d = s.pending as unknown as { kind: string; options?: ObjectId[] };
    if (d.kind === 'chooseObjects') expect(d.options).toEqual([bear]); // the Ogres have no counter
    void ogres;
  });
});
