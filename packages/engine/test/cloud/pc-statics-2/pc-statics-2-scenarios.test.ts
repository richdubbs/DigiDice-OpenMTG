/**
 * pc-statics-2 (precon lane pc-statics: statics): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 903.4, 903.4f, 118.3, 119.4  "{T}, Pay life equal to the number of colors in your commanders' color identity: Draw a card.": the life is the size of the identity, both
 *                                   partners' combined, 0 for a colorless identity and outside a Commander game
 *   CR 613.1d, 613.1f, 613.4b       "Enchanted creature is an Insect artifact creature with base power and toughness 0/1 and has defender, and it loses all other abilities,
 *                                   card types, and creature types.": the enchanted creature only, in layers 4, 6 and 7b
 *   CR 205.3m, 613.1d, 400.1        "Creatures you control are every creature type. The same is true for creature spells you control and creature cards you own that aren't
 *                                   on the battlefield.": your creatures, your creature spells and your creature cards elsewhere, not the opponent's
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m5/helpers';
import { getChars } from '../../../src/rules/characteristics';
import { card as mcard, commanderScenario, legend } from '../../m11/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

/** Answer pending decisions (costs, targets, yes to a may) until a player has priority with an empty stack. */
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

describe("CR 903.4, 119.4: \"Pay life equal to the number of colors in your commanders' color identity\"", () => {
  const ROOM = mcard('Test Room', '', 'Land', "{T}, Pay life equal to the number of colors in your commanders' color identity: Draw a card.");
  const TITANIA = legend('Test Titania', '{G}', ['2', '2'], ['G']);
  const KRAUM = legend('Test Kraum', '{U}{R}', ['4', '4'], ['U', 'R'], 'Partner');
  const GOLEM = legend('Test Golem', '{5}', ['5', '5'], [], '', 'Legendary Artifact Creature — Golem');
  const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
  const roomOf = (commanders: CardDef[]): GameState => commanderScenario({ p1Commanders: commanders, p2Commanders: [BOB], defs: [ROOM], p1: { battlefield: ['Test Room'] } });
  const life = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
  const run = (s: GameState): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Test Room', 'battlefield', 'p1') && !x.isMana);
    if (!a) throw new Error('not offered');
    return settle(act(s, a.action));
  };
  it('is automated; one color of identity costs 1 life', () => {
    expect(full(ROOM)).toBe(true);
    const s = roomOf([TITANIA]);
    const before = { life: life(s), hand: handSize(s) };
    const t = run(s);
    expect(life(t)).toBe(before.life - 1);
    expect(handSize(t)).toBe(before.hand + 1);
  });
  it('partners: the combined identity of two commanders (U, R and G) costs 3 life', () => {
    const s = roomOf([KRAUM, TITANIA]);
    expect(life(run(s))).toBe(life(s) - 3); // U, R and G
  });
  it('a colorless identity costs nothing: the card is still drawn', () => {
    const s = roomOf([GOLEM]);
    const t = run(s);
    expect(life(t)).toBe(life(s));
    expect(handSize(t)).toBe(handSize(s) + 1);
  });
  it("negative: without a commander the ability is not offered (War Room ruling 2020-11-10; CR 903.4f)", () => {
    const plain = card('Test Room', 'Land', "{T}, Pay life equal to the number of colors in your commanders' color identity: Draw a card.");
    const s = scenario([], { p1: { battlefield: ['Test Room'] }, defs: [plain] });
    expect(legalActions(s, 'p1').some((x) => x.kind === 'activate' && x.object === find(s, 'Test Room', 'battlefield', 'p1') && !x.isMana)).toBe(false);
  });
});

describe('CR 613.1d, 613.1f, 613.4b: "Enchanted creature is an Insect artifact creature with base power and toughness 0/1 and has defender, and it loses all other abilities, card types, and creature types."', () => {
  const MUTE = card('Test Mutation', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature is an Insect artifact creature with base power and toughness 0/1 and has defender, and it loses all other abilities, card types, and creature types.', { cost: '{0}' });
  const DRAGON = card('Test Dragon', 'Creature — Dragon', 'Flying', { pt: ['5', '5'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('is automated; the enchanted creature is a 0/1 Insect artifact creature with defender and without flying, the other creature is unchanged', () => {
    expect(full(MUTE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Mutation'] }, p2: { battlefield: ['Test Dragon', 'Test Bear'] }, defs: [MUTE, DRAGON, BEAR] });
    s = advanceTo(s, 1, 'main1');
    const dragon = find(s, 'Test Dragon', 'battlefield', 'p2');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mutation', 'hand', 'p1') }), [], [dragon]);
    const c = getChars(s, dragon)!;
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect([...c.subtypes]).toEqual(['Insect']);
    expect(pt(s, dragon)).toBe('0/1');
    expect(c.keywords.map((k) => k.keyword).sort()).toEqual(['defender']);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe('2/2');
  });
});

describe('CR 205.3m, 613.1d, 400.1: "Creatures you control are every creature type. The same is true for creature spells you control and creature cards you own that aren\'t on the battlefield."', () => {
  const NEXUS = card('Test Nexus', 'Artifact', "Creatures you control are every creature type. The same is true for creature spells you control and creature cards you own that aren't on the battlefield.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const SPELL = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'], cost: '{1}' });
  const types = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.subtypes];
  it('is automated; your creature on the battlefield, in hand and in the graveyard are every creature type, the opponent\'s are not', () => {
    expect(full(NEXUS)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Nexus', 'Test Bear'], hand: ['Test Cub'], graveyard: ['Test Bear'] }, p2: { battlefield: ['Test Bear'], hand: ['Test Cub'] }, defs: [NEXUS, BEAR, SPELL] });
    const mineBf = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Bear' && s.objects[id]!.controller === 'p1')!;
    const mineHand = find(s, 'Test Cub', 'hand', 'p1');
    const mineGy = find(s, 'Test Bear', 'graveyard', 'p1');
    for (const id of [mineBf, mineHand, mineGy]) {
      expect(types(s, id), id).toContain('Goblin');
      expect(types(s, id), id).toContain('Elf');
    }
    expect(types(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toEqual(['Bear']);
    expect(types(s, find(s, 'Test Cub', 'hand', 'p2'))).toEqual(['Bear']);
  });
  it('negative: without the Nexus nothing changes', () => {
    const s = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Cub'] }, defs: [NEXUS, BEAR, SPELL] });
    expect(types(s, find(s, 'Test Cub', 'hand', 'p1'))).toEqual(['Bear']);
  });
});
