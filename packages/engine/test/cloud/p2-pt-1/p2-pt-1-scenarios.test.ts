/**
 * p2-pt-1 (lane p2-pt): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the game's
 * default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.10c, 613.4c  "Until end of turn, double target creature's power and it gains first strike": +X/+0 where X is its power as the effect begins; the
 *                       toughness is unchanged; both end at the cleanup step
 *   CR 611.2b, 613.4c   "<obj> gets +2/+2 and has vigilance for as long as ~ remains tapped": the effect ends when the source untaps
 *   CR 120.2b, 608.2h   "Target creature you control deals damage equal to its power to each other creature and each opponent": every other creature (both
 *                       players') and each opponent, never the source itself or you
 *   CR 613.4c, 205.3m   "Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it": counted for each
 *                       creature from its own types (the example of Coat of Arms' reminder text: two Goblin Warriors and a Goblin Shaman each get +2/+2)
 *   CR 701.12a, 613.4b, "Exchange your life total with ~'s toughness": the life total becomes the toughness and the toughness the former life total (layer 7b, for
 *   119.7               good); a player who can't gain life makes no part of the exchange happen
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m5/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: { kind: 'object' | 'player'; id: string }[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets as never });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (queue.length > 0 && queue[0]!.kind === d.kind) s = answer(s, queue.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
const cast = (s: GameState, name: string, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState =>
  settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), [], targets);
const activate = (s: GameState, source: ObjectId, targets: { kind: 'object' | 'player'; id: string }[] = []): GameState => {
  const a = legalActions(s, s.pending!.player).find((x) => x.kind === 'activate' && x.object === source);
  if (!a) throw new Error('no activation');
  return settle(act(s, a.action), [], targets);
};
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

describe('CR 701.10c, 613.4c: "Until end of turn, double target creature\'s power and it gains first strike"', () => {
  const RAGE = card('Test Doubling Rage', 'Instant', "Until end of turn, double target creature's power and it gains first strike.");
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['3', '2'] });
  it('is automated', () => expect(full(RAGE)).toBe(true));
  it('a 3/2 becomes 6/2 with first strike, and is 3/2 without it again on the next turn', () => {
    let s = scenario([], { p1: { battlefield: ['Test Plain Bear'], hand: ['Test Doubling Rage'] }, defs: [RAGE, BEAR] });
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Doubling Rage', [obj(bear)]);
    expect(pt(s, bear)).toBe('6/2');
    expect(hasKeyword(getChars(s, bear)!, 'first strike')).toBe(true);
    s = advanceTo(s, 2, 'main1');
    expect(pt(s, bear)).toBe('3/2');
    expect(hasKeyword(getChars(s, bear)!, 'first strike')).toBe(false);
  });
});

describe('CR 611.2b, 613.4c: "Target Soldier creature gets +2/+2 and has vigilance for as long as ~ remains tapped"', () => {
  const COURIER = card('Test Lance Courier', 'Creature — Human', 'You may choose not to untap this creature during your untap step.\n{1}, {T}: Target Soldier creature gets +2/+2 and has vigilance for as long as this creature remains tapped.', { pt: ['1', '1'] });
  const SOLDIER = card('Test Foot Soldier', 'Creature — Human Soldier', '', { pt: ['2', '2'] });
  it('is automated', () => expect(full(COURIER)).toBe(true));
  it('the Soldier is 4/4 with vigilance while the courier is tapped; when the courier untaps the effect ends', () => {
    let s = scenario([], { p1: { battlefield: ['Test Lance Courier', 'Test Foot Soldier', 'Plains'] }, defs: [COURIER, SOLDIER] });
    const courier = find(s, 'Test Lance Courier', 'battlefield', 'p1');
    const soldier = find(s, 'Test Foot Soldier', 'battlefield', 'p1');
    s = activate(s, courier, [obj(soldier)]);
    expect(pt(s, soldier)).toBe('4/4');
    expect(hasKeyword(getChars(s, soldier)!, 'vigilance')).toBe(true);
    const t = structuredClone(s);
    t.objects[courier]!.tapped = false;
    expect(pt(t, soldier)).toBe('2/2');
    expect(hasKeyword(getChars(t, soldier)!, 'vigilance')).toBe(false);
  });
});

describe('CR 120.2b, 608.2h: "Target creature you control deals damage equal to its power to each other creature and each opponent"', () => {
  const IGNITE = card('Test Ignition Wave', 'Sorcery', 'Target creature you control deals damage equal to its power to each other creature and each opponent.');
  const BIG = card('Test Big Brute', 'Creature — Giant', '', { pt: ['4', '5'] });
  const SMALL = card('Test Small Squire', 'Creature — Human', '', { pt: ['2', '4'] });
  const FOE = card('Test Foe Hulk', 'Creature — Beast', '', { pt: ['5', '6'] });
  it('is automated', () => expect(full(IGNITE)).toBe(true));
  it('4 damage to each other creature (yours and the opponent\'s) and to the opponent; none to itself or to you', () => {
    let s = scenario([], { p1: { battlefield: ['Test Big Brute', 'Test Small Squire'], hand: ['Test Ignition Wave'] }, p2: { battlefield: ['Test Foe Hulk'] }, defs: [IGNITE, BIG, SMALL, FOE] });
    const big = find(s, 'Test Big Brute', 'battlefield', 'p1');
    const foe = find(s, 'Test Foe Hulk', 'battlefield', 'p2');
    s = cast(s, 'Test Ignition Wave', [obj(big)]);
    expect(s.objects[big]!.damage ?? 0).toBe(0);
    expect(s.objects[foe]!.damage).toBe(4);
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Small Squire')).toBe(true);
    expect(lifeOf(s, 'p2')).toBe(16);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 613.4c, 205.3m: "Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it"', () => {
  const BANNER = card('Test Kin Banner', 'Artifact', 'Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it.');
  const WARRIOR = card('Test Goblin Warrior', 'Creature — Goblin Warrior', '', { pt: ['1', '1'] });
  const SHAMAN = card('Test Goblin Shaman', 'Creature — Goblin Shaman', '', { pt: ['1', '1'] });
  const ELF = card('Test Lone Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  it('is automated', () => expect(full(BANNER)).toBe(true));
  it('two Goblin Warriors and a Goblin Shaman (either player\'s) each get +2/+2; an Elf alone gets nothing', () => {
    const s = scenario([], { p1: { battlefield: ['Test Kin Banner', 'Test Goblin Warrior', 'Test Goblin Warrior', 'Test Lone Elf'] }, p2: { battlefield: ['Test Goblin Shaman'] }, defs: [BANNER, WARRIOR, SHAMAN, ELF] });
    for (const id of s.zones.battlefield) {
      const name = s.defs[s.objects[id]!.defId]!.name;
      if (name.startsWith('Test Goblin')) expect(pt(s, id), name).toBe('3/3');
      if (name === 'Test Lone Elf') expect(pt(s, id)).toBe('1/1');
    }
  });
});

describe('CR 701.12a, 613.4b, 119.7: "Exchange your life total with ~\'s toughness" and "... target opponent\'s life total ..."', () => {
  const TREE = card('Test Life Oak', 'Creature — Plant', 'Defender\n{T}: Exchange your life total with this creature\'s toughness.', { pt: ['0', '13'] });
  const DARK = card('Test Dark Oak', 'Creature — Plant', 'Defender\n{T}: Exchange target opponent\'s life total with this creature\'s toughness.', { pt: ['0', '13'] });
  const BAN = card('Test Life Ban', 'Enchantment', "Players can't gain life.");
  it('both are automated', () => {
    expect(full(TREE)).toBe(true);
    expect(full(DARK)).toBe(true);
  });
  it('your life 20 becomes 13 and the creature becomes 0/20, for good (the next turn too)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Life Oak'] }, defs: [TREE] });
    const tree = find(s, 'Test Life Oak', 'battlefield', 'p1');
    s = activate(s, tree);
    expect(lifeOf(s, 'p1')).toBe(13);
    expect(pt(s, tree)).toBe('0/20');
    s = advanceTo(s, 2, 'main1');
    expect(pt(s, tree)).toBe('0/20');
  });
  it("the target opponent's life 20 becomes 13 and the creature becomes 0/20; yours does not change", () => {
    let s = scenario([], { p1: { battlefield: ['Test Dark Oak'] }, defs: [DARK] });
    const tree = find(s, 'Test Dark Oak', 'battlefield', 'p1');
    s = activate(s, tree, [{ kind: 'player', id: 'p2' }]);
    expect(lifeOf(s, 'p2')).toBe(13);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(pt(s, tree)).toBe('0/20');
  });
  it("CR 701.12a: a player who can't gain life makes no part of the exchange happen (life 5, toughness 13)", () => {
    let s = scenario([], { p1: { battlefield: ['Test Life Oak', 'Test Life Ban'] }, defs: [TREE, BAN] });
    expect(full(BAN)).toBe(true);
    s = structuredClone(s);
    s.players.find((p) => p.id === 'p1')!.life = 5;
    const tree = find(s, 'Test Life Oak', 'battlefield', 'p1');
    s = activate(s, tree);
    expect(lifeOf(s, 'p1')).toBe(5);
    expect(pt(s, tree)).toBe('0/13');
  });
});
