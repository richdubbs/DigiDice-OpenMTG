/**
 * p2-pt-3 (lane p2-pt): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the game's
 * default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 613.4c, 613.1f   "Creatures you control get +0/+1 for each Gate you control and have vigilance"
 *   CR 611.3a, 613.4c   "All Squirrels get +2/+2 as long as there are seven or more cards in your graveyard"; "White creatures get an additional +1/+1 as long as ..."
 *   CR 102.3, 613.4c    "Equipped creature gets +1/+0 for each opponent you have"
 *   CR 105.2, 613.4c    "... gets +1/+0 for each of its colors": each object's own colors
 *   CR 102.3, 404.1,    "~ gets +1/+1 for each card your opponents own in exile" / "for each creature card in your opponents' graveyards": the opponents' cards only
 *   406.1
 *   CR 111.1            "Creatures you control that are Zombies and/or tokens get +1/+1 and have flying"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m5/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
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
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const FILLER = card('Test Old Note', 'Sorcery', 'Draw a card.');

describe('CR 613.4c, 613.1f: "Creatures you control get +0/+1 for each Gate you control and have vigilance"', () => {
  const HOLD = card('Test Gate Ward', 'Enchantment', 'Creatures you control get +0/+1 for each Gate you control and have vigilance.');
  const GATE = card('Test Stone Gate', 'Land — Gate', '{T}: Add {C}.');
  it('is automated', () => expect(full(HOLD)).toBe(true));
  it('two Gates: your creature is 2/4 with vigilance; the opponent\'s is unchanged', () => {
    const s = scenario([], { p1: { battlefield: ['Test Gate Ward', 'Test Stone Gate', 'Test Stone Gate', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] }, defs: [HOLD, GATE, BEAR] });
    const mine = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    expect(pt(s, mine)).toBe('2/4');
    expect(hasKeyword(getChars(s, mine)!, 'vigilance')).toBe(true);
    expect(pt(s, find(s, 'Test Plain Bear', 'battlefield', 'p2'))).toBe('2/2');
  });
});

describe('CR 611.3a, 613.4c: conditional group pumps ("All Squirrels get +2/+2 as long as ..."; "... get an additional +1/+1 as long as ...")', () => {
  const NUTS = card('Test Nut Hoard', 'Enchantment', 'All Squirrels get +2/+2 as long as there are seven or more cards in your graveyard.');
  const SQUIRREL = card('Test Gray Squirrel', 'Creature — Squirrel', '', { pt: ['1', '1'] });
  const RITE = card('Test White Rite', 'Enchantment', 'White creatures get +1/+1.\nWhite creatures get an additional +1/+1 as long as there are seven or more cards in your graveyard.');
  const PAGE = card('Test White Page', 'Creature — Human', '', { pt: ['1', '1'], colors: ['W'] });
  it('both are automated', () => { expect(full(NUTS)).toBe(true); expect(full(RITE)).toBe(true); });
  it('six cards in your graveyard: no pump; seven: every Squirrel (the opponent\'s too) gets +2/+2', () => {
    const six = scenario([], { p1: { battlefield: ['Test Nut Hoard', 'Test Gray Squirrel'], graveyard: Array(6).fill('Test Old Note') }, p2: { battlefield: ['Test Gray Squirrel'] }, defs: [NUTS, SQUIRREL, FILLER] });
    for (const id of named(six, 'Test Gray Squirrel')) expect(pt(six, id)).toBe('1/1');
    const seven = scenario([], { p1: { battlefield: ['Test Nut Hoard', 'Test Gray Squirrel'], graveyard: Array(7).fill('Test Old Note') }, p2: { battlefield: ['Test Gray Squirrel'] }, defs: [NUTS, SQUIRREL, FILLER] });
    for (const id of named(seven, 'Test Gray Squirrel')) expect(pt(seven, id)).toBe('3/3');
  });
  it('a white creature is 2/2 with six cards and 3/3 with seven', () => {
    const six = scenario([], { p1: { battlefield: ['Test White Rite', 'Test White Page'], graveyard: Array(6).fill('Test Old Note') }, defs: [RITE, PAGE, FILLER] });
    expect(pt(six, find(six, 'Test White Page', 'battlefield', 'p1'))).toBe('2/2');
    const seven = scenario([], { p1: { battlefield: ['Test White Rite', 'Test White Page'], graveyard: Array(7).fill('Test Old Note') }, defs: [RITE, PAGE, FILLER] });
    expect(pt(seven, find(seven, 'Test White Page', 'battlefield', 'p1'))).toBe('3/3');
  });
});

describe('CR 102.3, 105.2, 613.4c: equipped and group pumps by opponents and by the object\'s own colors', () => {
  const SUN = card('Test Sun Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0 for each opponent you have.\nEquip {4}');
  const SABER = card('Test Hue Saber', 'Artifact — Equipment', 'Equipped creature gets +1/+0 for each of its colors.\nEquip {1}');
  const KNIGHT = card('Test Prism Knight', 'Creature — Human Knight', 'Each other multicolored creature you control gets +1/+1 for each of its colors.', { pt: ['2', '2'], colors: ['W', 'G'] });
  const TRIO = card('Test Trio Beast', 'Creature — Beast', '', { pt: ['1', '1'], colors: ['R', 'G', 'W'] });
  const MONO = card('Test Mono Beast', 'Creature — Beast', '', { pt: ['1', '1'], colors: ['G'] });
  it('all are automated', () => { expect(full(SUN)).toBe(true); expect(full(SABER)).toBe(true); expect(full(KNIGHT)).toBe(true); });
  it('one opponent: the equipped creature gets +1/+0', () => {
    let s = scenario([], { p1: { battlefield: ['Test Sun Blade', 'Test Plain Bear'] }, defs: [SUN, BEAR] });
    s = structuredClone(s);
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    s.objects[find(s, 'Test Sun Blade', 'battlefield', 'p1')]!.attachedTo = bear;
    expect(pt(s, bear)).toBe('3/2');
  });
  it('a three-colored equipped creature gets +3/+0; the other three-colored one is unchanged', () => {
    let s = scenario([], { p1: { battlefield: ['Test Hue Saber', 'Test Trio Beast', 'Test Trio Beast'] }, defs: [SABER, TRIO] });
    s = structuredClone(s);
    const [a, b] = named(s, 'Test Trio Beast') as [ObjectId, ObjectId];
    s.objects[find(s, 'Test Hue Saber', 'battlefield', 'p1')]!.attachedTo = a;
    expect(pt(s, a)).toBe('4/1');
    expect(pt(s, b)).toBe('1/1');
  });
  it('the knight: another three-colored creature gets +3/+3, a mono-colored one nothing, the knight itself nothing', () => {
    const s = scenario([], { p1: { battlefield: ['Test Prism Knight', 'Test Trio Beast', 'Test Mono Beast'] }, defs: [KNIGHT, TRIO, MONO] });
    expect(pt(s, find(s, 'Test Trio Beast', 'battlefield', 'p1'))).toBe('4/4');
    expect(pt(s, find(s, 'Test Mono Beast', 'battlefield', 'p1'))).toBe('1/1');
    expect(pt(s, find(s, 'Test Prism Knight', 'battlefield', 'p1'))).toBe('2/2');
  });
});

describe('CR 102.3, 404.1, 406.1, 613.4c: counts of the cards your opponents own', () => {
  const SHADE = card('Test Exile Shade', 'Creature — Nightmare', 'This creature gets +1/+1 for each card your opponents own in exile.', { pt: ['1', '1'] });
  const WIGHT = card('Test Grave Wight', 'Creature — Zombie', "This creature gets +1/+1 for each creature card in your opponents' graveyards.", { pt: ['1', '1'] });
  it('both are automated', () => { expect(full(SHADE)).toBe(true); expect(full(WIGHT)).toBe(true); });
  it('two cards the opponent owns in exile count; one you own does not', () => {
    const s = scenario([], { p1: { battlefield: ['Test Exile Shade'], exile: ['Test Old Note'] }, p2: { exile: ['Test Old Note', 'Test Plain Bear'] }, defs: [SHADE, FILLER, BEAR] });
    expect(pt(s, find(s, 'Test Exile Shade', 'battlefield', 'p1'))).toBe('3/3');
  });
  it('creature cards in the opponent\'s graveyard count (not a sorcery card, not yours)', () => {
    const s = scenario([], { p1: { battlefield: ['Test Grave Wight'], graveyard: ['Test Plain Bear'] }, p2: { graveyard: ['Test Plain Bear', 'Test Plain Bear', 'Test Old Note'] }, defs: [WIGHT, BEAR, FILLER] });
    expect(pt(s, find(s, 'Test Grave Wight', 'battlefield', 'p1'))).toBe('3/3');
  });
});

describe('CR 111.1, 613.4c: "Creatures you control that are Zombies and/or tokens get +1/+1 and have flying"', () => {
  const WINGS = card('Test Gold Wings', 'Enchantment', 'Creatures you control that are Zombies and/or tokens get +1/+1 and have flying.\nWhen this enchantment enters, create a 1/1 white Spirit creature token.');
  const ZOMBIE = card('Test Slow Zombie', 'Creature — Zombie', '', { pt: ['2', '2'] });
  it('is automated', () => expect(full(WINGS)).toBe(true));
  it('a Zombie card and a Spirit token get +1/+1 and flying; a Bear does not', () => {
    let s = scenario([], { p1: { battlefield: ['Test Slow Zombie', 'Test Plain Bear'], hand: ['Test Gold Wings'] }, defs: [WINGS, ZOMBIE, BEAR] });
    s = cast(s, 'Test Gold Wings');
    const zombie = find(s, 'Test Slow Zombie', 'battlefield', 'p1');
    expect(pt(s, zombie)).toBe('3/3');
    expect(hasKeyword(getChars(s, zombie)!, 'flying')).toBe(true);
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(pt(s, token)).toBe('2/2');
    expect(hasKeyword(getChars(s, token)!, 'flying')).toBe(true);
    expect(pt(s, find(s, 'Test Plain Bear', 'battlefield', 'p1'))).toBe('2/2');
  });
});
