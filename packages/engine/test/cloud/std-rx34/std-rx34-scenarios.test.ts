/**
 * EDH lane rx34 (std-rx34): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.37a-b, 611.3a  "As long as ~ is monstrous, it has flying.": no flying before monstrosity, flying once the ability made it monstrous; another copy that
 *                         is not monstrous has none
 *   CR 601.2h, 106.1      "If {G} was spent to cast this spell, you gain 3 life.": paid with {G} it gains, paid with {U} (a hybrid cost) it does not
 *   CR 105.3, 608.2d      "Target creature becomes the color of your choice until end of turn.": the answer is the creature's only color until the cleanup step
 *   CR 301.5, 611.3a      "As long as ~ is equipped, it has haste.": haste only while an Equipment is attached to it
 *   CR 500.1, 611.3a      "During turns other than yours, ~ gets +0/+2." and "... creatures you control get +0/+2.": only during the opponent's turn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, legal, passBoth, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id).keywords.map((k) => k.keyword);
const mana = (s: GameState, ...types: string[]): void => { s.players.find((x) => x.id === 'p1')!.manaPool.push(...types.map((type) => ({ type }) as never)); };
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

/** Answer the decisions that come up (targets, color choices, costs paid automatically) until a player has priority. */
function drive(s0: GameState, target?: ObjectId, color?: string): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: target ? [{ kind: 'object', id: target }] : [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (color ?? 'R') as never });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, target?: ObjectId, color?: string): GameState => {
  let s = s0;
  for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), target, color);
  return s;
};
const activate = (s: GameState, source: ObjectId): GameState => {
  const a = legal(s, 'p1', 'activate').find((x) => (x.action as { source?: string }).source === source);
  if (!a) throw new Error('no activation offered');
  return act(s, a.action);
};

describe('CR 701.37a-b, 611.3a: "As long as ~ is monstrous, it has flying."', () => {
  const WYRM = card('Test Bramble Wyrm', 'Creature — Wurm', '{1}: Monstrosity 2.\nAs long as this creature is monstrous, it has flying.', ['3', '3']);
  it('is automated', () => expect(full(WYRM)).toBe(true));
  it('has no flying until its monstrosity ability resolved; then flying, and a second, non-monstrous copy still has none', () => {
    const s0 = scenario([], { defs: [WYRM], p1: { battlefield: ['Test Bramble Wyrm', 'Test Bramble Wyrm'] } });
    const [a, b] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Bramble Wyrm');
    expect(kws(s0, a!)).not.toContain('flying');
    mana(s0, 'C');
    const s = resolveAll(drive(activate(s0, a!)));
    expect(s.objects[a!]!.monstrous).toBe(true);
    expect(kws(s, a!)).toContain('flying');
    expect(Number(getChars(s, a!).power)).toBe(5);
    expect(kws(s, b!)).not.toContain('flying');
  });
});

describe('CR 601.2h, 106.1: "If {G} was spent to cast this spell, you gain 3 life."', () => {
  const SAP = card('Test Sap Draught', 'Instant', 'Draw a card. If {G} was spent to cast this spell, you gain 3 life.', undefined, '{G/U}');
  const cast = (pay: string): GameState => {
    const s0 = scenario([], { defs: [SAP], p1: { hand: ['Test Sap Draught'] } });
    mana(s0, pay);
    return resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Sap Draught', 'hand', 'p1') })));
  };
  it('is automated', () => expect(full(SAP)).toBe(true));
  it('paid with {G} it gains 3 life; paid with {U} it only draws', () => {
    const g = cast('G');
    expect(life(g, 'p1')).toBe(23);
    expect(g.zones.hand.p1!.length).toBe(1);
    const u = cast('U');
    expect(life(u, 'p1')).toBe(20);
    expect(u.zones.hand.p1!.length).toBe(1);
  });
});

describe('CR 105.3, 608.2d, 611.2c: "{T}: Target creature becomes the color of your choice until end of turn."', () => {
  const PRISM = card('Test Tinted Prism', 'Artifact', '{T}: Target creature becomes the color of your choice until end of turn.');
  const BEAR = card('Test Grove Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}', ['G']);
  it('is automated', () => expect(full(PRISM)).toBe(true));
  it('the chosen color replaces the creature\'s colors until the cleanup step', () => {
    const s0 = scenario([], { defs: [PRISM, BEAR], p1: { battlefield: ['Test Tinted Prism'] }, p2: { battlefield: ['Test Grove Bear'] } });
    const bear = find(s0, 'Test Grove Bear', 'battlefield', 'p2');
    expect(getChars(s0, bear).colors).toEqual(['G']);
    const s = resolveAll(drive(activate(s0, find(s0, 'Test Tinted Prism', 'battlefield', 'p1')), bear, 'U'), bear, 'U');
    expect(getChars(s, bear).colors).toEqual(['U']);
    const next = advanceTo(s, 2, 'upkeep');
    expect(getChars(next, bear).colors).toEqual(['G']);
  });
});

describe('CR 301.5, 611.3a: "As long as ~ is equipped, it has haste."', () => {
  const RAIDER = card('Test Hasty Raider', 'Creature — Goblin Warrior', 'As long as this creature is equipped, it has haste.', ['2', '1']);
  const BLADE = card('Test Plain Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {1}');
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  it('haste only while an Equipment is attached to it', () => {
    const s = scenario([], { defs: [RAIDER, BLADE], p1: { battlefield: ['Test Hasty Raider', 'Test Plain Blade'] } });
    const raider = find(s, 'Test Hasty Raider', 'battlefield', 'p1');
    expect(kws(s, raider)).not.toContain('haste');
    s.objects[find(s, 'Test Plain Blade', 'battlefield', 'p1')]!.attachedTo = raider;
    expect(kws(s, raider)).toContain('haste');
  });
});

describe('CR 500.1, 611.3a: "During turns other than yours, ..." P/T changes', () => {
  const LYNX = card('Test Mesa Watcher', 'Creature — Cat', 'During turns other than yours, this creature gets +0/+2.', ['2', '1']);
  const BANNER = card('Test Night Banner', 'Enchantment', 'During turns other than yours, creatures you control get +0/+2.');
  it('both are automated', () => { expect(full(LYNX)).toBe(true); expect(full(BANNER)).toBe(true); });
  it('the bonus applies during the opponent\'s turn only, and only to its controller\'s creatures', () => {
    const s0 = scenario([], { defs: [LYNX, BANNER], p1: { battlefield: ['Test Mesa Watcher', 'Test Night Banner'] }, p2: { battlefield: ['Test Mesa Watcher'] } });
    const mine = find(s0, 'Test Mesa Watcher', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Mesa Watcher', 'battlefield', 'p2');
    expect(Number(getChars(s0, mine).toughness)).toBe(1);
    expect(Number(getChars(s0, theirs).toughness)).toBe(3); // p2's own Watcher: p1's turn is a turn other than p2's
    const s = advanceTo(s0, 2, 'upkeep');
    expect(Number(getChars(s, mine).toughness)).toBe(5); // its own +0/+2 and the Banner's
    expect(Number(getChars(s, theirs).toughness)).toBe(1);
  });
});
