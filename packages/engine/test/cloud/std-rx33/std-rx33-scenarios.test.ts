/**
 * EDH lane rx33 (std-rx33): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 107.14, 118.3, 118.12  "you may pay {E}{E}. If you do, ...": with enough energy the payment is offered and removes the energy; with less it can't be paid
 *                             and nothing happens
 *   CR 120.1, 120.2b, 608.2c  "deals 2 damage to target opponent and 1 damage to each creature that player controls": the target player's creatures only
 *   CR 118.12a, 701.21a, 101.4 "each opponent sacrifices a permanent of their choice unless they pay {2}": an opponent who can't pay sacrifices; one who pays keeps it
 *   CR 509.1a                 "Equipped creature can block an additional creature each combat": two attackers for the equipped creature, one for another;
 *                             "~ can block an additional creature each combat as long as <Cond>" only while the condition holds
 *   CR 502.3, 611.2a          "tap it and it doesn't untap during its controller's next untap step": stays tapped through that untap step, untaps at the next
 *   CR 614.1c, 122.6          "~ enters with a number of +1/+1 counters on it equal to <Qty>": the count as it enters
 *   CR 604.1, 613.4c          "~ gets +X/+0, where X is <Qty>": follows the count
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, isTapped, life, passBoth, scenario, battlefieldNames } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { maxBlocks } from '../../../src/statics/hooks';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { targets?: TargetChoice[][]; yes?: boolean[]; objects?: ObjectId[][] }
/** Answer the decisions that come up until a player has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { targets: [...(script.targets ?? [])], yes: [...(script.yes ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? (p as unknown as { options: ObjectId[] }).options.slice(0, (p as unknown as { min: number }).min) } as never);
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
const resolveAll = (s0: GameState, script: Script = {}): GameState => {
  let s = s0;
  for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
};
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const energy = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.counters.energy ?? 0;
const hand = (s: GameState, p: string): number => s.zones.hand[p]!.length;

describe('CR 107.14, 118.3, 118.12: "You may pay {E}{E}. If you do, draw a card."', () => {
  const TINKER = card('Test Spark Tinker', 'Creature — Human Artificer', '{T}: You may pay {E}{E}. If you do, draw a card.', ['1', '1']);
  const start = (e: number): GameState => {
    const s = scenario([], { defs: [TINKER], p1: { battlefield: ['Test Spark Tinker'] } });
    s.players.find((x) => x.id === 'p1')!.counters.energy = e;
    return act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Spark Tinker', 'battlefield', 'p1'), ability: 'p:0:0' });
  };
  it('is automated', () => expect(full(TINKER)).toBe(true));
  it('with three energy, paying removes two and draws a card', () => {
    const s = resolveAll(start(3), { yes: [true] });
    expect(energy(s, 'p1')).toBe(1);
    expect(hand(s, 'p1')).toBe(1);
  });
  it('declining keeps the energy and draws nothing', () => {
    const s = resolveAll(start(3), { yes: [false] });
    expect(energy(s, 'p1')).toBe(3);
    expect(hand(s, 'p1')).toBe(0);
  });
  it('with one energy the payment can\'t be made: no card, the energy stays', () => {
    const s = resolveAll(start(1), { yes: [true] });
    expect(energy(s, 'p1')).toBe(1);
    expect(hand(s, 'p1')).toBe(0);
  });
});

describe('CR 120.1, 120.2b, 608.2c: "~ deals 2 damage to target opponent and 1 damage to each creature that player controls."', () => {
  const ARC = card('Test Arc Squall', 'Instant', '~ deals 2 damage to target opponent and 1 damage to each creature that player controls.'.replace('~', 'Test Arc Squall'));
  const SAME = card('Test Ember Rain', 'Sorcery', 'Test Ember Rain deals 1 damage to target player and each creature that player controls.');
  const MOTH = card('Test Paper Moth', 'Creature — Insect', '', ['1', '1']);
  const defs = [ARC, SAME, MOTH];
  it('both are automated', () => {
    expect(full(ARC)).toBe(true);
    expect(full(SAME)).toBe(true);
  });
  it('the opponent loses 2 life, their creature dies, yours does not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Paper Moth'], hand: ['Test Arc Squall'] }, p2: { battlefield: ['Test Paper Moth'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Arc Squall', 'hand', 'p1') }), { targets: [[player('p2')]] }));
    expect(life(s, 'p2')).toBe(18);
    expect(battlefieldNames(s, 'p2')).not.toContain('Test Paper Moth');
    expect(battlefieldNames(s, 'p1')).toContain('Test Paper Moth');
  });
  it('the same amount to the target player and their creatures; targeting yourself hits your own creatures', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Paper Moth'], hand: ['Test Ember Rain'] }, p2: { battlefield: ['Test Paper Moth'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ember Rain', 'hand', 'p1') }), { targets: [[player('p1')]] }));
    expect(life(s, 'p1')).toBe(19);
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Paper Moth');
    expect(battlefieldNames(s, 'p2')).toContain('Test Paper Moth');
  });
});

describe('CR 118.12a, 701.21a, 101.4: "each opponent sacrifices a permanent of their choice unless they pay {2}"', () => {
  const TOLL = card('Test Toll Keeper', 'Creature — Human Rogue', 'When this creature enters, each opponent sacrifices a permanent of their choice unless they pay {2}.', ['1', '1']);
  const ROCK = card('Test Pebble', 'Artifact', '');
  const defs = [TOLL, ROCK];
  it('is automated', () => expect(full(TOLL)).toBe(true));
  it('an opponent who can\'t pay sacrifices a permanent; you sacrifice nothing', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Toll Keeper'], battlefield: ['Test Pebble'] }, p2: { battlefield: ['Test Pebble'] } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Toll Keeper', 'hand', 'p1') }), { yes: [false] });
    expect(battlefieldNames(s, 'p2')).toEqual([]);
    expect(battlefieldNames(s, 'p1').sort()).toEqual(['Test Pebble', 'Test Toll Keeper']);
  });
  it('an opponent who pays {2} keeps their permanents', () => {
    const s0 = scenario(['Plains'], { defs, p1: { hand: ['Test Toll Keeper'] }, p2: { battlefield: ['Test Pebble', 'Plains', 'Plains'] } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Toll Keeper', 'hand', 'p1') }), { yes: [true] });
    expect(battlefieldNames(s, 'p2').sort()).toEqual(['Plains', 'Plains', 'Test Pebble']);
  });
});

describe('CR 509.1a: "can block an additional creature each combat" of the attached creature, and of ~ as long as a condition holds', () => {
  const HOOK = card('Test Twin Hook', 'Artifact — Equipment', 'Equipped creature can block an additional creature each combat.\nEquip {1}');
  const POST = card('Test Watch Post', 'Creature — Human Soldier', 'This creature can block an additional creature each combat as long as you control an artifact.', ['1', '3']);
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', ['2', '2']);
  const ROCK = card('Test Pebble', 'Artifact', '');
  const defs = [HOOK, POST, BEAR, ROCK];
  it('both are automated', () => {
    expect(full(HOOK)).toBe(true);
    expect(full(POST)).toBe(true);
  });
  it('the equipped creature may block two attackers, another creature one', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Twin Hook', 'Test Grove Bear', 'Test Grove Bear'] } });
    const [a, b] = [s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Grove Bear')[0]!, s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Grove Bear')[1]!];
    s.objects[find(s, 'Test Twin Hook', 'battlefield', 'p1')]!.attachedTo = a;
    expect(maxBlocks(s, a)).toBe(2);
    expect(maxBlocks(s, b)).toBe(1);
  });
  it('~ may block two attackers while you control an artifact, one without', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Watch Post', 'Test Pebble'] } });
    expect(maxBlocks(s, find(s, 'Test Watch Post', 'battlefield', 'p1'))).toBe(2);
    const t = scenario([], { defs, p1: { battlefield: ['Test Watch Post'] }, p2: { battlefield: ['Test Pebble'] } });
    expect(maxBlocks(t, find(t, 'Test Watch Post', 'battlefield', 'p1'))).toBe(1);
  });
});

describe('CR 502.3, 611.2a: "tap target creature and it doesn\'t untap during its controller\'s next untap step"', () => {
  const NET = card('Test Vine Snare', 'Creature — Snake Warrior', "{T}: Tap target creature and it doesn't untap during its controller's next untap step.", ['1', '1']);
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', ['2', '2']);
  it('is automated', () => expect(full(NET)).toBe(true));
  it('the opponent\'s creature stays tapped through their next untap step and untaps at the one after', () => {
    const s0 = scenario([], { defs: [NET, BEAR], p1: { battlefield: ['Test Vine Snare'] }, p2: { battlefield: ['Test Grove Bear'] } });
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p2');
    const s1 = resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Vine Snare', 'battlefield', 'p1'), ability: 'p:0:0' }), { targets: [[obj(bear)]] }));
    expect(isTapped(s1, bear)).toBe(true);
    expect(isTapped(advanceTo(s1, 2, 'upkeep'), bear)).toBe(true);
    expect(isTapped(advanceTo(s1, 4, 'upkeep'), bear)).toBe(false);
  });
});

describe('CR 614.1c, 122.6 / CR 604.1, 613.4c: a number of counters as ~ enters, and +X/+0 where X is a count', () => {
  const GROWER = card('Test Moss Heap', 'Creature — Fungus', 'This creature enters with a number of +1/+1 counters on it equal to the number of artifact cards in your graveyard.', ['0', '0']);
  const RAGER = card('Test Scrap Brute', 'Creature — Ogre', 'This creature gets +X/+0, where X is the number of artifacts you control.', ['1', '1']);
  const ROCK = card('Test Pebble', 'Artifact', '');
  const defs = [GROWER, RAGER, ROCK];
  it('both are automated', () => {
    expect(full(GROWER)).toBe(true);
    expect(full(RAGER)).toBe(true);
  });
  it('enters with as many counters as artifact cards in your graveyard (the opponent\'s do not count)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Moss Heap'], graveyard: ['Test Pebble', 'Test Pebble'] }, p2: { graveyard: ['Test Pebble'] } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Moss Heap', 'hand', 'p1') }));
    expect(s.objects[find(s, 'Test Moss Heap', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(2);
  });
  it('gets +1/+0 for each artifact you control', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Scrap Brute', 'Test Pebble', 'Test Pebble'] }, p2: { battlefield: ['Test Pebble'] } });
    expect(Number(getChars(s, find(s, 'Test Scrap Brute', 'battlefield', 'p1')).power)).toBe(3);
  });
});
