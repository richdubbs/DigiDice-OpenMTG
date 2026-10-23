/**
 * p2-typechange-1 (Phase 2 lane p2-typechange): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 603.4, 205.1a,   "Whenever you cast a creature spell, if this enchantment is an enchantment, it becomes a 3/3 Wolf creature": "it" is the permanent the
 *   613.1d              intervening if is about (lower/anaphora.ts, the intervening-self rule); it stops being an enchantment, so the next cast does nothing
 *   CR 205.1b, 611.2a   "{1}: This land becomes a 3/3 Golem artifact creature until end of turn. It's still a land.": types added, the land keeps its own
 *   CR 205.1b, 613.4b   "Enchanted artifact is a creature with base power and toughness 4/4 in addition to its other types"
 *   CR 305.7, 607.2d    "As this Aura enters, choose a basic land type. Enchanted land is the chosen type.": its land types are replaced
 *   CR 205.1b, 611.3a,  "Creatures you control are artifacts in addition to their other types. The same is true for creature spells you control and creature cards
 *   108.3, 110.4        you own that aren't on the battlefield."; the nonland-permanent form of it
 *   CR 611.2c, 613.4b   "Artifacts you control become artifact creatures with base power and toughness 3/3 until end of turn": the group is fixed as it resolves
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m5/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const types = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.types].sort();
const subtypes = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.subtypes].sort();
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
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
const activate = (s: GameState, source: ObjectId): GameState => {
  const a = legalActions(s, s.pending!.player).find((x) => x.kind === 'activate' && x.object === source && !x.isMana);
  if (!a) throw new Error('no activation');
  return settle(act(s, a.action));
};
const cast = (s: GameState, name: string, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState =>
  settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), answers, targets);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const IDOL = card('Test Idol', 'Artifact', '');
const CHARM = card('Test Charm', 'Enchantment', '');
const WILDS = card('Test Wilds', 'Land — Forest', '');

describe('CR 603.4, 205.1a: "if this enchantment is an enchantment, it becomes a 3/3 Wolf creature" ("it" is the permanent the intervening if is about)', () => {
  const DEN = card('Test Den', 'Enchantment', 'Whenever you cast a creature spell, if this enchantment is an enchantment, it becomes a 3/3 Wolf creature.');
  it('is automated, and the effect is on ~ itself', () => {
    expect(full(DEN)).toBe(true);
    expect(JSON.stringify(DEN.faces)).toContain('"affects":{"ref":"self"}');
  });
  it('casting a creature spell makes it a 3/3 Wolf creature that is no longer an enchantment; a second creature spell does not trigger it', () => {
    let s = scenario([], { p1: { battlefield: ['Test Den'], hand: ['Test Bear', 'Test Bear'] }, defs: [DEN, BEAR] });
    s = advanceTo(s, 1, 'main1');
    const den = find(s, 'Test Den', 'battlefield', 'p1');
    s = cast(s, 'Test Bear');
    expect(types(s, den)).toEqual(['Creature']);
    expect(subtypes(s, den)).toEqual(['Wolf']);
    expect(pt(s, den)).toBe('3/3');
    const stackBefore = s.zones.stack.length;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bear', 'hand', 'p1') });
    expect(s.zones.stack.length).toBe(stackBefore + 1); // the spell only: the intervening if is false (CR 603.4)
    s = settle(s);
    expect(pt(s, den)).toBe('3/3');
  });
  it('with a condition about something else, "it" is not read as ~ (it stays the spell of the event, the earlier reading)', () => {
    const d = card('Test Den Two', 'Enchantment', 'Whenever you cast a creature spell, if you control an artifact, it becomes a 3/3 Wolf creature.');
    expect(JSON.stringify(d.faces)).not.toContain('"affects":{"ref":"self"}');
    expect(JSON.stringify(d.faces)).toContain('"affects":{"ref":"event","role":"spell"}');
  });
});

describe('CR 205.1b, 611.2a: "This land becomes a 3/3 Golem artifact creature until end of turn. It\'s still a land."', () => {
  const MILL = card('Test Mill', 'Land', '{T}: Add {C}.\n{1}: This land becomes a 3/3 Golem artifact creature until end of turn. It\'s still a land.');
  it('is automated', () => expect(full(MILL)).toBe(true));
  it('it is an Artifact Creature Land Golem 3/3 until end of turn, then a land again', () => {
    let s = scenario([], { p1: { battlefield: ['Test Mill', 'Plains'] }, defs: [MILL] });
    s = advanceTo(s, 1, 'main1');
    const mill = find(s, 'Test Mill', 'battlefield', 'p1');
    s = activate(s, mill);
    expect(types(s, mill)).toEqual(['Artifact', 'Creature', 'Land']);
    expect(subtypes(s, mill)).toEqual(['Golem']);
    expect(pt(s, mill)).toBe('3/3');
    s = advanceTo(s, 2, 'main1');
    expect(types(s, mill)).toEqual(['Land']);
  });
});

describe('CR 205.1b, 613.4b: "Enchanted artifact is a creature with base power and toughness 4/4 in addition to its other types."', () => {
  const SOUL = card('Test Soulcraft', 'Enchantment — Aura', 'Enchant artifact\nEnchanted artifact is a creature with base power and toughness 4/4 in addition to its other types.');
  it('is automated; the enchanted artifact is a 4/4 artifact creature', () => {
    expect(full(SOUL)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Idol'], hand: ['Test Soulcraft'] }, defs: [SOUL, IDOL] });
    s = advanceTo(s, 1, 'main1');
    const idol = find(s, 'Test Idol', 'battlefield', 'p1');
    s = cast(s, 'Test Soulcraft', [], [idol]);
    expect(types(s, idol)).toEqual(['Artifact', 'Creature']);
    expect(pt(s, idol)).toBe('4/4');
  });
});

describe('CR 305.7, 607.2d: "As this Aura enters, choose a basic land type. Enchanted land is the chosen type."', () => {
  const VEIL = card('Test Veil', 'Enchantment — Aura', 'Enchant land\nAs this Aura enters, choose a basic land type.\nEnchanted land is the chosen type.');
  it('is automated; the enchanted Forest is an Island only (its land types are replaced) and still a land', () => {
    expect(full(VEIL)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Wilds'], hand: ['Test Veil'] }, defs: [VEIL, WILDS] });
    s = advanceTo(s, 1, 'main1');
    const wilds = find(s, 'Test Wilds', 'battlefield', 'p1');
    s = cast(s, 'Test Veil', [{ kind: 'chooseName', name: 'Island' }], [wilds]);
    expect(types(s, wilds)).toEqual(['Land']);
    expect(subtypes(s, wilds)).toEqual(['Island']);
  });
});

describe('CR 205.1b, 611.3a, 110.4: "... are artifacts in addition to their other types. The same is true for ... that aren\'t on the battlefield."', () => {
  const FORGE = card('Test Forge', 'Enchantment', "Creatures you control are artifacts in addition to their other types. The same is true for creature spells you control and creature cards you own that aren't on the battlefield.");
  const MOLD = card('Test Mold', 'Artifact', "Nonland permanents you control are artifacts in addition to their other types. The same is true for permanent spells you control and nonland permanent cards you own that aren't on the battlefield.");
  it('both are automated', () => {
    expect(full(FORGE)).toBe(true);
    expect(full(MOLD)).toBe(true);
  });
  it('creatures: a creature on the battlefield and a creature card in hand are artifacts; an enchantment and an opponent\'s creature are not', () => {
    const s = scenario([], { p1: { battlefield: ['Test Forge', 'Test Bear', 'Test Charm'], hand: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [FORGE, BEAR, CHARM] });
    expect(types(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toEqual(['Artifact', 'Creature']);
    expect(types(s, find(s, 'Test Bear', 'hand', 'p1'))).toEqual(['Artifact', 'Creature']);
    expect(types(s, find(s, 'Test Charm', 'battlefield', 'p1'))).toEqual(['Enchantment']);
    expect(types(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toEqual(['Creature']);
  });
  it('nonland permanents: an enchantment and a creature card in hand are artifacts; a land is not', () => {
    const s = scenario([], { p1: { battlefield: ['Test Mold', 'Test Charm', 'Test Wilds'], hand: ['Test Bear'] }, defs: [MOLD, BEAR, CHARM, WILDS] });
    expect(types(s, find(s, 'Test Charm', 'battlefield', 'p1'))).toEqual(['Artifact', 'Enchantment']);
    expect(types(s, find(s, 'Test Bear', 'hand', 'p1'))).toEqual(['Artifact', 'Creature']);
    expect(types(s, find(s, 'Test Wilds', 'battlefield', 'p1'))).toEqual(['Land']);
  });
});

describe('CR 611.2c, 613.4b: "Artifacts you control become artifact creatures with base power and toughness 3/3 until end of turn."', () => {
  const ENGINE = card('Test Engine', 'Artifact', '{2}: Artifacts you control become artifact creatures with base power and toughness 3/3 until end of turn.');
  it('is automated; the artifacts there as it resolves are 3/3 artifact creatures, an artifact that arrives later is not, and all are back after the turn', () => {
    expect(full(ENGINE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Engine', 'Test Idol', 'Plains', 'Plains'] }, defs: [ENGINE, IDOL] });
    s = advanceTo(s, 1, 'main1');
    const engine = find(s, 'Test Engine', 'battlefield', 'p1');
    const idol = find(s, 'Test Idol', 'battlefield', 'p1');
    s = activate(s, engine);
    for (const id of [engine, idol]) {
      expect(types(s, id)).toEqual(['Artifact', 'Creature']);
      expect(pt(s, id)).toBe('3/3');
    }
    const late = put(s, 'p1', 'battlefield', 'Test Idol');
    expect(types(s, late)).toEqual(['Artifact']);
    s = advanceTo(s, 2, 'main1');
    expect(types(s, idol)).toEqual(['Artifact']);
  });
  it('"Each noncreature artifact you control becomes a 2/5 artifact creature until end of turn." is automated and leaves a creature alone', () => {
    const WAKE = card('Test Waker', 'Artifact Creature — Construct', '{2}: Each noncreature artifact you control becomes a 2/5 artifact creature until end of turn.', { pt: ['1', '1'] });
    expect(full(WAKE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Waker', 'Test Idol', 'Plains', 'Plains'] }, defs: [WAKE, IDOL] });
    s = advanceTo(s, 1, 'main1');
    const waker = find(s, 'Test Waker', 'battlefield', 'p1');
    const idol = find(s, 'Test Idol', 'battlefield', 'p1');
    s = activate(s, waker);
    expect(types(s, idol)).toEqual(['Artifact', 'Creature']);
    expect(pt(s, idol)).toBe('2/5');
    expect(pt(s, waker)).toBe('1/1');
  });
});
