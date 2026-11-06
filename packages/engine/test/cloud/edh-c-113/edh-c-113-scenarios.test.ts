/**
 * Commander lane edh-c, round edh-c-113: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler.
 * Each test is named after the rule it checks and has its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.12a, 400.1, 404.1      "Exchange your hand and graveyard."
 *   CR 205.3i, 305.7, 607.2d      "Lands you control are the chosen type in addition to their other types."
 *   CR 120.3c, 608.2h             "~ deals damage to himself equal to that card's mana value." (a planeswalker loses loyalty)
 *   CR 201.2, 205.1a, 613.1d, 613.1f, 613.4b   "Target nontoken creature becomes a 6/6 legendary Horror creature named X and loses all abilities."
 *   CR 608.2c, 205.3m             "... put that card onto the battlefield, then shuffle. That Elf gains haste until end of turn. Exile it at the beginning of the next end step."
 *   CR 120.1, 301.5a, 400.7       "Whenever a creature dealt damage by equipped creature this turn dies, ..."
 *   CR 608.2c                     "Put a +1/+1 counter on the creature you control if it has power 4 or greater." ("it" is the creature the counter goes on)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => (s.zones[zone][p] ?? []).map((id) => s.objects[id]!.defId).sort();
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId).sort();

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  const pick = [...targets]; // one target per decision, in the order of the spell's target phrases
  for (let guard = 0; guard < 80 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: pick.splice(0, 1).map((id) => ({ kind: 'object' as const, id })) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as { options: ObjectId[]; min: number }).options.slice(0, Math.max((d as { min: number }).min, Math.min(1, (d as { options: ObjectId[] }).options.length))) });
    else if (queue.length > 0 && queue[0]!.kind === d.kind) s = answer(s, queue.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const cast = (s: GameState, name: string, targets: ObjectId[] = [], answers: DecisionAnswer[] = []): GameState =>
  settle(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), answers, targets);
const activate = (s: GameState, source: ObjectId, targets: ObjectId[] = []): GameState => {
  const a = legalActions(s, s.pending!.player).find((x) => x.kind === 'activate' && x.object === source && !x.isMana);
  if (!a) throw new Error('no activation');
  return settle(act(s, a.action), [], targets);
};

describe('CR 701.12a, 400.1, 404.1: "Exchange your hand and graveyard."', () => {
  const SWAP = card('Test Swap Rite', 'Sorcery', 'Exchange your hand and graveyard.');
  const A = card('Test Swap Ape', 'Creature — Ape', '', { pt: ['1', '1'] });
  const B = card('Test Swap Bat', 'Creature — Bat', '', { pt: ['1', '1'] });
  const C = card('Test Swap Cat', 'Creature — Cat', '', { pt: ['1', '1'] });
  const WATCH = card('Test Swap Watch', 'Enchantment', 'Whenever you discard a card, you gain 5 life.');
  const defs = [SWAP, A, B, C, WATCH];
  it('is automated', () => { expect(full(SWAP)).toBe(true); });
  it("each card of the hand goes to the graveyard and each card of the graveyard to the hand (the spell itself is in the graveyard when it resolves); nothing is discarded; the opponent's zones stay", () => {
    let s = scenario([], { defs, p1: { hand: ['Test Swap Rite', 'Test Swap Ape', 'Test Swap Bat'], graveyard: ['Test Swap Cat'], battlefield: ['Test Swap Watch'] }, p2: { hand: ['Test Swap Ape'], graveyard: ['Test Swap Cat'] } });
    s = advanceTo(s, 1, 'main1');
    const oppHand = names(s, 'hand', 'p2');
    s = cast(s, 'Test Swap Rite');
    expect(names(s, 'hand', 'p1')).toEqual(['Test Swap Cat']);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Swap Ape', 'Test Swap Bat', 'Test Swap Rite']);
    expect(names(s, 'hand', 'p2')).toEqual(oppHand);
    expect(names(s, 'graveyard', 'p2')).toEqual(['Test Swap Cat']);
    expect(life(s, 'p1')).toBe(20); // CR 701.9a: put into the graveyard, not discarded: the watcher did not trigger
  });
  it('negative: with an empty graveyard the hand still goes to the graveyard (the exchange happens when one zone is empty)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Swap Rite', 'Test Swap Ape'], graveyard: [] } });
    s = advanceTo(s, 1, 'main1');
    s = cast(s, 'Test Swap Rite');
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Swap Ape', 'Test Swap Rite']);
  });
});

describe('CR 205.3i, 305.7, 607.2d: "As ~ enters, choose a basic land type. Lands you control are the chosen type in addition to their other types."', () => {
  const SHAPER = card('Test Land Shaper', 'Creature — Wizard', 'As ~ enters, choose a basic land type.\nLands you control are the chosen type in addition to their other types.', { pt: ['1', '1'] });
  const WILDS = card('Test Wilds', 'Land — Forest', '');
  const defs = [SHAPER, WILDS];
  const subtypes = (s: GameState, id: ObjectId): string[] => [...chars(s, id).subtypes].sort();
  it('is automated', () => { expect(full(SHAPER)).toBe(true); });
  it("your lands gain the chosen land type and keep their own; an opponent's land does not", () => {
    // the template's text is "As ~ enters, choose a basic land type. Lands you control ...": the card name stands for ~
    let s = scenario([], { defs, p1: { battlefield: ['Test Wilds'], hand: ['Test Land Shaper'] }, p2: { battlefield: ['Test Wilds'] } });
    s = advanceTo(s, 1, 'main1');
    s = cast(s, 'Test Land Shaper', [], [{ kind: 'chooseName', name: 'Island' }]);
    expect(subtypes(s, find(s, 'Test Wilds', 'battlefield', 'p1'))).toEqual(['Forest', 'Island']);
    expect(chars(s, find(s, 'Test Wilds', 'battlefield', 'p1')).types).toEqual(['Land']);
    expect(subtypes(s, find(s, 'Test Wilds', 'battlefield', 'p2'))).toEqual(['Forest']);
  });
  it('negative: the creature itself is not a land and gets no land type', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Land Shaper'] } });
    s = advanceTo(s, 1, 'main1');
    s = cast(s, 'Test Land Shaper', [], [{ kind: 'chooseName', name: 'Swamp' }]);
    expect(subtypes(s, find(s, 'Test Land Shaper', 'battlefield', 'p1'))).toEqual(['Wizard']);
  });
});

describe("CR 120.3c, 608.2h: \"~ deals damage to himself equal to that card's mana value.\"", () => {
  const WALKER = card('Test Mad Walker', 'Legendary Planeswalker — Test', "0: Reveal the top card of your library and put it into your hand. Test Mad Walker deals damage to himself equal to that card's mana value.", { loyalty: '5' });
  const BIG = card('Test Big Spell', 'Sorcery', '', { cost: '{3}' });
  const defs = [WALKER, BIG];
  const loyalty = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['loyalty'] ?? 0;
  it('is automated', () => { expect(full(WALKER)).toBe(true); });
  it('the revealed card goes to hand and the planeswalker loses that many loyalty counters (the 0 ability adds none); a land (mana value 0) costs nothing', () => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Mad Walker', counters: { loyalty: 5 } }], library: ['Test Big Spell', 'Plains'] } });
    s = advanceTo(s, 1, 'main1');
    const w = find(s, 'Test Mad Walker', 'battlefield', 'p1');
    const start = loyalty(s, w);
    s = activate(s, w);
    expect(names(s, 'hand', 'p1')).toContain('Test Big Spell');
    expect(loyalty(s, w)).toBe(start - 3);
  });
  it('negative: damage to himself is not damage to a player (CR 120.3c: loyalty only), and a reveal of mana value 0 changes nothing', () => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Mad Walker', counters: { loyalty: 5 } }], library: ['Plains', 'Test Big Spell'] } });
    s = advanceTo(s, 1, 'main1');
    const w = find(s, 'Test Mad Walker', 'battlefield', 'p1');
    const start = loyalty(s, w);
    s = activate(s, w);
    expect(loyalty(s, w)).toBe(start);
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
  });
  it('a planeswalker with fewer loyalty counters than the revealed mana value dies (state-based action, CR 704.5i)', () => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Mad Walker', counters: { loyalty: 2 } }], library: ['Test Big Spell'] } });
    s = advanceTo(s, 1, 'main1');
    const w = find(s, 'Test Mad Walker', 'battlefield', 'p1');
    s = activate(s, w);
    expect(s.zones.battlefield).not.toContain(w);
  });
});

describe('CR 201.2, 205.1a, 613.1d, 613.1f, 613.4b: "Target nontoken creature becomes a 6/6 legendary Horror creature named Test Dread and loses all abilities."', () => {
  const CURSE = card('Test Dread Curse', 'Sorcery', 'Target nontoken creature becomes a 6/6 legendary Horror creature named Test Dread and loses all abilities.');
  const GOLEM = card('Test Fly Golem', 'Artifact Creature — Golem', 'Flying', { pt: ['2', '2'] });
  const ROC = card('Test Plain Roc', 'Creature — Bird', 'Flying', { pt: ['1', '1'] });
  const defs = [CURSE, GOLEM, ROC];
  it('is automated', () => { expect(full(CURSE)).toBe(true); });
  it('the creature becomes only a legendary Horror creature, 6/6, with that name and no abilities; another creature is unchanged', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Dread Curse'] }, p2: { battlefield: ['Test Fly Golem', 'Test Plain Roc'] } });
    s = advanceTo(s, 1, 'main1');
    const golem = find(s, 'Test Fly Golem', 'battlefield', 'p2');
    const roc = find(s, 'Test Plain Roc', 'battlefield', 'p2');
    s = cast(s, 'Test Dread Curse', [golem]);
    const c = chars(s, golem);
    expect(c.types).toEqual(['Creature']);
    expect([...c.subtypes]).toEqual(['Horror']);
    expect(c.supertypes).toContain('Legendary');
    expect(c.names).toEqual(['Test Dread']);
    expect(`${c.power}/${c.toughness}`).toBe('6/6');
    expect(c.keywords.some((k) => k.keyword === 'flying')).toBe(false);
    expect(chars(s, roc).names).toEqual(['Test Plain Roc']);
    expect(`${chars(s, roc).power}/${chars(s, roc).toughness}`).toBe('1/1');
    expect(chars(s, roc).keywords.some((k) => k.keyword === 'flying')).toBe(true);
  });
  it('negative: the effect lasts for good (CR 611.2a), through the end of the turn', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Dread Curse'] }, p2: { battlefield: ['Test Plain Roc'] } });
    s = advanceTo(s, 1, 'main1');
    const roc = find(s, 'Test Plain Roc', 'battlefield', 'p2');
    s = cast(s, 'Test Dread Curse', [roc]);
    s = advanceTo(s, 2, 'main1');
    expect(chars(s, roc).names).toEqual(['Test Dread']);
    expect(`${chars(s, roc).power}/${chars(s, roc).toughness}`).toBe('6/6');
  });
});

describe('CR 608.2c, 205.3m: "Search your library for an Elf permanent card, put that card onto the battlefield, then shuffle. That Elf gains haste until end of turn. Exile it at the beginning of the next end step."', () => {
  const CALL = card('Test Elf Call', 'Creature — Wizard', '{0}, {T}: Search your library for an Elf permanent card, put that card onto the battlefield, then shuffle. That Elf gains haste until end of turn. Exile it at the beginning of the next end step.', { pt: ['1', '1'] });
  const ELF = card('Test Quick Elf', 'Creature — Elf', '', { pt: ['2', '2'] });
  const BEAR = card('Test Quick Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [CALL, ELF, BEAR];
  it('is automated', () => { expect(full(CALL)).toBe(true); });
  it('the Elf comes onto the battlefield with haste and is exiled at the next end step; a non-Elf stays in the library', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Elf Call'], library: ['Test Quick Bear', 'Test Quick Elf'] } });
    s = advanceTo(s, 1, 'main1');
    s = activate(s, find(s, 'Test Elf Call', 'battlefield', 'p1'), []);
    s = settle(s, [], []);
    const elf = findAll(s, 'Test Quick Elf', 'battlefield', 'p1')[0];
    expect(elf).toBeDefined();
    expect(chars(s, elf!).keywords.some((k) => k.keyword === 'haste')).toBe(true);
    expect(findAll(s, 'Test Quick Bear', 'battlefield', 'p1')).toHaveLength(0);
    s = advanceTo(s, 1, 'end');
    s = settle(s, []);
    expect(exiled(s)).toContain('Test Quick Elf');
  });
});

describe('CR 120.1, 301.5a, 400.7: "Whenever a creature dealt damage by equipped creature this turn dies, you may exile that card. If you do, create a 2/2 black Zombie creature token."', () => {
  const BLADE = card('Test Reaper Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nWhenever a creature dealt damage by equipped creature this turn dies, you may exile that card. If you do, create a 2/2 black Zombie creature token.\nEquip {0}');
  const DUEL = card('Test Duel Rite', 'Sorcery', 'Target creature you control fights target creature you don\'t control.');
  const BOLT = card('Test Bolt Rite', 'Instant', 'Test Bolt Rite deals 3 damage to target creature.');
  const BEAR = card('Test Reap Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [BLADE, DUEL, BOLT, BEAR];
  const zombies = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
  it('is automated', () => { expect(full(BLADE)).toBe(true); });
  it('a creature the equipped creature damaged dies: its card is exiled and the controller gets a Zombie', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Reaper Blade', 'Test Reap Bear'], hand: ['Test Duel Rite'] }, p2: { battlefield: ['Test Reap Bear'] } });
    s = advanceTo(s, 1, 'main1');
    const mine = find(s, 'Test Reap Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Reap Bear', 'battlefield', 'p2');
    s.objects[find(s, 'Test Reaper Blade', 'battlefield', 'p1')]!.attachedTo = mine;
    s = cast(s, 'Test Duel Rite', [mine, theirs]);
    expect(s.zones.battlefield).not.toContain(theirs);
    expect(exiled(s)).toEqual(['Test Reap Bear']);
    expect(zombies(s)).toBe(1);
  });
  it('negative: a creature killed by something else, or damaged by a creature that is not equipped, does not trigger', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Reaper Blade', 'Test Reap Bear', 'Test Reap Bear'], hand: ['Test Duel Rite'] }, p2: { battlefield: ['Test Reap Bear'], hand: ['Test Bolt Rite'] } });
    s = advanceTo(s, 1, 'main1');
    const [equipped, plain] = findAll(s, 'Test Reap Bear', 'battlefield', 'p1') as [ObjectId, ObjectId];
    const theirs = find(s, 'Test Reap Bear', 'battlefield', 'p2');
    s.objects[find(s, 'Test Reaper Blade', 'battlefield', 'p1')]!.attachedTo = equipped;
    s = cast(s, 'Test Duel Rite', [plain, theirs]); // the unequipped bear fights and kills it
    expect(s.zones.battlefield).not.toContain(theirs);
    expect(zombies(s)).toBe(0);
    expect(names(s, 'graveyard', 'p2')).toEqual(['Test Reap Bear']);
  });
});

describe('CR 603.10a, 120.1, 301.5a: a creature that dies together with the equipped creature (both die in the same fight)', () => {
  const BLADE = card('Test Twin Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nWhenever a creature dealt damage by equipped creature this turn dies, you may exile that card. If you do, create a 2/2 black Zombie creature token.\nEquip {0}');
  const DUEL = card('Test Twin Duel', 'Sorcery', 'Target creature you control fights target creature you don\'t control.');
  const BEAR = card('Test Twin Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('the other creature, dealt damage by the equipped creature, dies at the same moment: the Equipment was still attached just before (look back in time), so its ability triggers', () => {
    let s = scenario([], { defs: [BLADE, DUEL, BEAR], p1: { battlefield: ['Test Twin Blade', 'Test Twin Bear'], hand: ['Test Twin Duel'] }, p2: { battlefield: [{ name: 'Test Twin Bear' }] } });
    s = advanceTo(s, 1, 'main1');
    const mine = find(s, 'Test Twin Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Twin Bear', 'battlefield', 'p2');
    s.objects[find(s, 'Test Twin Blade', 'battlefield', 'p1')]!.attachedTo = mine;
    s.objects[theirs]!.counters['+1/+1'] = 1; // 3/3: both bears die (the equipped one is 3/3 too)
    s = cast(s, 'Test Twin Duel', [mine, theirs]);
    expect(s.zones.battlefield).not.toContain(mine);
    expect(s.zones.battlefield).not.toContain(theirs);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1')).toHaveLength(1);
  });
});

describe('CR 603.10a: the Equipment leaves the battlefield together with the creature that dies', () => {
  const BLADE = card('Test Wipe Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nWhenever a creature dealt damage by equipped creature this turn dies, you may exile that card. If you do, create a 2/2 black Zombie creature token.\nEquip {0}');
  const DUEL = card('Test Wipe Duel', 'Sorcery', 'Target creature you control fights target creature you don\'t control.');
  const WIPE = card('Test Wipe Rite', 'Sorcery', 'Destroy all artifacts and creatures.');
  const BEAR = card('Test Wipe Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const WALL = card('Test Wipe Wall', 'Creature — Wall', '', { pt: ['0', '9'] });
  it('a destroy-all that takes the Equipment too still triggers it (last known information of the attachment)', () => {
    let s = scenario([], { defs: [BLADE, DUEL, WIPE, BEAR, WALL], p1: { battlefield: ['Test Wipe Blade', 'Test Wipe Bear'], hand: ['Test Wipe Duel', 'Test Wipe Rite'] }, p2: { battlefield: ['Test Wipe Wall'] } });
    s = advanceTo(s, 1, 'main1');
    const mine = find(s, 'Test Wipe Bear', 'battlefield', 'p1');
    s.objects[find(s, 'Test Wipe Blade', 'battlefield', 'p1')]!.attachedTo = mine;
    s = cast(s, 'Test Wipe Duel', [mine, find(s, 'Test Wipe Wall', 'battlefield', 'p2')]);
    s = cast(s, 'Test Wipe Rite');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1')).toHaveLength(1);
    expect(exiled(s)).toEqual(['Test Wipe Wall']);
  });
});

describe('CR 608.2c: "Put a +1/+1 counter on the creature you control if it has power 4 or greater." ("it" is the creature the counter goes on, not the creature an opponent controls)', () => {
  const RAMPAGE = card('Test Rampage Rite', 'Instant', 'Choose target creature you control and target creature an opponent controls. Put a +1/+1 counter on the creature you control if it has power 4 or greater. Then those creatures fight each other.');
  const BIG = card('Test Rampage Big', 'Creature — Ape', '', { pt: ['4', '4'] });
  const MID = card('Test Rampage Mid', 'Creature — Ape', '', { pt: ['3', '3'] });
  const HUGE = card('Test Rampage Huge', 'Creature — Ape', '', { pt: ['6', '6'] });
  const defs = [RAMPAGE, BIG, MID, HUGE];
  const counters = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;
  it('is automated', () => { expect(full(RAMPAGE)).toBe(true); });
  it('a creature with power 4 gets the counter, then the two fight', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Rampage Big'], hand: ['Test Rampage Rite'] }, p2: { battlefield: ['Test Rampage Mid'] } });
    s = advanceTo(s, 1, 'main1');
    const mine = find(s, 'Test Rampage Big', 'battlefield', 'p1');
    const theirs = find(s, 'Test Rampage Mid', 'battlefield', 'p2');
    s = cast(s, 'Test Rampage Rite', [mine, theirs]);
    expect(counters(s, mine)).toBe(1);
    expect(s.zones.battlefield).not.toContain(theirs);
    expect(s.objects[mine]!.damage).toBe(3);
  });
  it("negative: power 3 gets no counter even when the opponent's creature has power 6 (the condition is about the creature you control)", () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Rampage Mid'], hand: ['Test Rampage Rite'] }, p2: { battlefield: ['Test Rampage Huge'] } });
    s = advanceTo(s, 1, 'main1');
    const mine = find(s, 'Test Rampage Mid', 'battlefield', 'p1');
    const theirs = find(s, 'Test Rampage Huge', 'battlefield', 'p2');
    s = cast(s, 'Test Rampage Rite', [mine, theirs]);
    expect(counters(s, mine)).toBe(0);
    expect(counters(s, theirs)).toBe(0);
  });
});
