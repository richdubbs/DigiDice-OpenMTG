/**
 * p2-misc-1 (Phase 2 lane p2-misc: keyword actions and small mechanics): the round's readings played through the engine with synthetic cards (invented names and
 * wordings, design 6.10), compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 731.1, 614.12   "If it's neither day nor night, it becomes day as ~ enters": a game with neither becomes day as the creature enters; a game that is night
 *                      stays night
 *   CR 731.1a, 603.2   "Whenever day becomes night or night becomes day": triggers when day becomes night, not when it first becomes day from neither
 *   CR 702.26a, 502.1  phasing: in its controller's untap step it phases out, and in the next one it phases in (not in the other player's untap step); an Aura
 *                      on it phases out with it (CR 702.26g)
 *   CR 701.47a         "amass Slivers N": a 0/0 Sliver Army token with N +1/+1 counters; an Army already there gets the counters and becomes a Sliver
 *   CR 603.2, 603.6a,  "Creatures entering or dying don't cause abilities to trigger": no enters or dies trigger while the creature is there, including when it
 *   603.10a            dies at the same time (looking back); other events still trigger
 *   CR 602.5b, 702.142a "Creatures you control can boast twice during each of your turns rather than once": a boast ability can be activated twice in your turn,
 *                      not three times; without the ability once
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, put, runCombat, scenario, tweak } from '../../m5/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; guard < 80 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (queue.length > 0 && queue[0]!.kind === d.kind) s = answer(s, queue.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const cast = (s: GameState, name: string, targets: ObjectId[] = []): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), [], targets);
const dayNight = (s: GameState): string | undefined => s.designations.dayNight;

describe('CR 731.1, 614.12: "If it\'s neither day nor night, it becomes day as this creature enters."', () => {
  const SAGE = card('Test Dawn Watcher', 'Creature — Human Wizard', "If it's neither day nor night, it becomes day as this creature enters.\nWhenever day becomes night or night becomes day, you gain 3 life.", { pt: ['1', '3'] });
  it('is automated', () => expect(full(SAGE)).toBe(true));
  it('a game that is neither day nor night becomes day as it enters; becoming day from neither is no change of day and night, so nothing triggers', () => {
    let s = scenario([], { p1: { hand: ['Test Dawn Watcher'] }, defs: [SAGE] });
    expect(dayNight(s)).toBeUndefined();
    const before = life(s, 'p1');
    s = cast(s, 'Test Dawn Watcher');
    expect(find(s, 'Test Dawn Watcher', 'battlefield', 'p1')).toBeDefined();
    expect(dayNight(s)).toBe('day');
    expect(life(s, 'p1')).toBe(before);
  });
  it('a game that is already night stays night', () => {
    let s = tweak(scenario([], { p1: { hand: ['Test Dawn Watcher'] }, defs: [SAGE] }), (x) => { x.designations.dayNight = 'night'; });
    s = cast(s, 'Test Dawn Watcher');
    expect(dayNight(s)).toBe('night');
  });
  it('CR 731.1a, 731.2: day becomes night at the next untap step (the previous turn\'s active player cast no spell): "whenever day becomes night" triggers once', () => {
    let s = tweak(scenario([], { p1: { battlefield: ['Test Dawn Watcher'] }, defs: [SAGE] }), (x) => { x.designations.dayNight = 'day'; });
    const before = life(s, 'p1');
    s = settle(advanceTo(s, 2, 'upkeep'));
    expect(dayNight(s)).toBe('night');
    expect(life(s, 'p1')).toBe(before + 3);
  });
});

describe('CR 702.26a, 502.1: phasing', () => {
  const SHADE = card('Test Flickering Shade', 'Creature — Spirit', 'Phasing', { pt: ['2', '2'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const AURA = card('Test Ward Charm', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');
  it('is automated', () => expect(full(SHADE)).toBe(true));
  it('it phases out in its controller\'s untap step and phases in in the next one; the other player\'s untap step changes nothing; a creature without phasing stays', () => {
    let s = scenario([], { p1: { battlefield: ['Test Flickering Shade', 'Test Bear'] }, defs: [SHADE, BEAR] });
    const shade = find(s, 'Test Flickering Shade', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = advanceTo(s, 2, 'main1');
    expect(s.objects[shade]!.phasedOut).toBe(false);
    s = advanceTo(s, 3, 'main1');
    expect(s.objects[shade]!.phasedOut).toBe(true);
    expect(s.objects[bear]!.phasedOut).toBe(false);
    s = advanceTo(s, 4, 'main1');
    expect(s.objects[shade]!.phasedOut).toBe(true);
    s = advanceTo(s, 5, 'main1');
    expect(s.objects[shade]!.phasedOut).toBe(false);
  });
  it('CR 702.26g: an Aura attached to it phases out and in with it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Flickering Shade'] }, defs: [SHADE, AURA] });
    const shade = find(s, 'Test Flickering Shade', 'battlefield', 'p1');
    let aura = '';
    s = tweak(s, (x) => { aura = put(x, 'p1', 'battlefield', 'Test Ward Charm'); x.objects[aura]!.attachedTo = shade; });
    s = advanceTo(s, 3, 'main1');
    expect(s.objects[aura]!.phasedOut).toBe(true);
    s = advanceTo(s, 5, 'main1');
    expect(s.objects[shade]!.phasedOut).toBe(false);
    expect(s.objects[aura]!.phasedOut).toBe(false);
    expect(s.objects[aura]!.attachedTo).toBe(shade);
  });
});

describe('CR 701.47a, 701.47d: "amass Slivers N" (any creature type)', () => {
  const HIVE = card('Test Hive Caller', 'Creature — Elf', 'When this creature enters, amass Slivers 2.', { pt: ['1', '1'] });
  const ARMY = card('Test Old Army', 'Creature — Zombie Army', '', { pt: ['0', '0'] });
  it('is automated', () => expect(full(HIVE)).toBe(true));
  it('with no Army: a 0/0 black Sliver Army creature token with two +1/+1 counters', () => {
    let s = scenario([], { p1: { hand: ['Test Hive Caller'] }, defs: [HIVE, ARMY] });
    s = cast(s, 'Test Hive Caller');
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(1);
    const c = getChars(s, tokens[0]!)!;
    expect([...c.subtypes].sort()).toEqual(['Army', 'Sliver']);
    expect(s.objects[tokens[0]!]!.counters['+1/+1']).toBe(2);
  });
  it('with an Army already there: no token; the Army gets the counters and becomes a Sliver in addition to its other types', () => {
    let s = scenario([], { p1: { hand: ['Test Hive Caller'], battlefield: [{ name: 'Test Old Army', counters: { '+1/+1': 1 } }] }, defs: [HIVE, ARMY] });
    const army = find(s, 'Test Old Army', 'battlefield', 'p1');
    s = cast(s, 'Test Hive Caller');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(0);
    expect(s.objects[army]!.counters['+1/+1']).toBe(3);
    expect([...getChars(s, army)!.subtypes].sort()).toEqual(['Army', 'Sliver', 'Zombie']);
  });
});

describe('CR 603.2, 603.6a, 603.10a: "Creatures entering or dying don\'t cause abilities to trigger."', () => {
  const HUSH = card('Test Hushed Warden', 'Creature — Faerie', "Creatures entering or dying don't cause abilities to trigger.", { pt: ['1', '2'] });
  const WATCHER = card('Test Grave Watcher', 'Creature — Spirit', 'Whenever another creature dies, you gain 1 life.\nWhenever this creature becomes tapped, you gain 2 life.', { pt: ['1', '1'] });
  const GREETER = card('Test Greeter', 'Creature — Human', 'When this creature enters, you gain 4 life.', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const DOOM = card('Test Quiet End', 'Instant', 'Destroy target creature.');
  const WRATH = card('Test Grim Tide', 'Sorcery', 'Destroy all creatures.');
  const TAP = card('Test Sudden Nap', 'Instant', 'Tap target creature.');
  const DEFS = [HUSH, WATCHER, GREETER, BEAR, DOOM, WRATH, TAP];
  it('is automated', () => expect(full(HUSH)).toBe(true));
  it('a creature dying triggers nothing while it is on the battlefield; without it, it triggers', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hushed Warden', 'Test Grave Watcher', 'Test Bear'], hand: ['Test Quiet End'] }, defs: DEFS });
    let before = life(s, 'p1');
    s = cast(s, 'Test Quiet End', [find(s, 'Test Bear', 'battlefield', 'p1')]);
    expect(life(s, 'p1')).toBe(before);
    s = scenario([], { p1: { battlefield: ['Test Grave Watcher', 'Test Bear'], hand: ['Test Quiet End'] }, defs: DEFS });
    before = life(s, 'p1');
    s = cast(s, 'Test Quiet End', [find(s, 'Test Bear', 'battlefield', 'p1')]);
    expect(life(s, 'p1')).toBe(before + 1);
  });
  it('CR 603.10a: dying at the same time as the other creatures, it still keeps their dying from triggering (looking back)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hushed Warden', 'Test Grave Watcher', 'Test Bear'], hand: ['Test Grim Tide'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = cast(s, 'Test Grim Tide');
    expect(s.zones.battlefield.length).toBe(0);
    expect(life(s, 'p1')).toBe(before);
    s = scenario([], { p1: { battlefield: ['Test Grave Watcher', 'Test Bear'], hand: ['Test Grim Tide'] }, defs: DEFS });
    s = cast(s, 'Test Grim Tide');
    expect(life(s, 'p1')).toBe(before + 1); // without it: the Bear dying at the same time as the Watcher triggers it (CR 603.10a)
  });
  it('CR 603.6a: a creature entering triggers nothing; another event (becoming tapped) still triggers', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hushed Warden', 'Test Grave Watcher'], hand: ['Test Greeter', 'Test Sudden Nap'] }, defs: DEFS });
    const before = life(s, 'p1');
    s = cast(s, 'Test Greeter');
    expect(life(s, 'p1')).toBe(before);
    s = cast(s, 'Test Sudden Nap', [find(s, 'Test Grave Watcher', 'battlefield', 'p1')]);
    expect(life(s, 'p1')).toBe(before + 2);
  });
});

describe('CR 602.5b, 702.142a: "Creatures you control can boast twice during each of your turns rather than once."', () => {
  const STORYTELLER = card('Test Saga Singer', 'Creature — God', 'Creatures you control can boast twice during each of your turns rather than once.', { pt: ['3', '3'] });
  const BRAGGART = card('Test Braggart', 'Creature — Human Warrior', 'Boast — {0}: You gain 1 life. (Activate only if this creature attacked this turn and only once each turn.)', { pt: ['2', '2'] });
  const DEFS = [STORYTELLER, BRAGGART];
  const attacked = (battlefield: string[]): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { p1: { battlefield: battlefield.map((name) => ({ name, since: -1 })) }, defs: DEFS });
    const id = find(s0, 'Test Braggart', 'battlefield', 'p1');
    return { s: runCombat(s0, { attack: [[id]], until: 'declareAttackers' } as never), id };
  };
  it('is automated', () => {
    expect(full(STORYTELLER)).toBe(true);
    expect(full(BRAGGART)).toBe(true);
  });
  it('with it: the boast ability can be activated twice in your turn, not a third time', () => {
    const { s, id } = attacked(['Test Saga Singer', 'Test Braggart']);
    const before = life(s, 'p1');
    let t = s;
    for (let i = 0; i < 2; i++) {
      const a = legalActions(t, t.pending!.player).find((x) => x.kind === 'activate' && x.object === id);
      expect(a, `activation ${i + 1}`).toBeDefined();
      t = settle(act(t, a!.action));
    }
    expect(life(t, 'p1')).toBe(before + 2);
    expect(legalActions(t, t.pending!.player).some((x) => x.kind === 'activate' && x.object === id)).toBe(false);
  });
  it('without it: once', () => {
    const { s, id } = attacked(['Test Braggart']);
    const a = legalActions(s, s.pending!.player).find((x) => x.kind === 'activate' && x.object === id);
    expect(a).toBeDefined();
    const t = settle(act(s, a!.action));
    expect(legalActions(t, t.pending!.player).some((x) => x.kind === 'activate' && x.object === id)).toBe(false);
  });
});
