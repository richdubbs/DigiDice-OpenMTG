/**
 * Commander lane edh-b, round edh-b-6 (EDHREC ranks 9,001-10,000, second pass): the new readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 601.3, 101.2, 513.1      "Cast ~ only during your end step."
 *   CR 101.2, 701.6a            "Instant, sorcery, and Dragon spells you control can't be countered."
 *   CR 205.3g, 613.4c           "Each creature you control that's a Food or a Golem gets +2/+2 and has trample."
 *   CR 109.2, 701.21a           "sacrifice a creature other than this creature"
 *   CR 402.1, 102.3             "the number of your opponents with four or more cards in hand"
 *   CR 119.5, 103.4, 608.2d     "it becomes equal to your starting life total"; "you may have your life total become the number of charge counters on ~"
 *   CR 701.22a, 614.1a          "If you would scry a number of cards, scry that many cards plus one instead."
 *   CR 402.1, 122.1             "~ enters with X +1/+1 counters on it, where X is the total number of cards in all players' hands"
 *   CR 601.2f, 702.19b          "Each creature spell you cast costs {1} less to cast if it has mutate."
 *   CR 604.1, 613.4c            "As long as <condition>, ~ and <group> get +N/+M [and have <keyword>]"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, legal, life, pass, put, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  const colors = ['W', 'U', 'B', 'R', 'G'].filter((c) => cost.includes(`{${c}}`));
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const has = (s: GameState, id: ObjectId, kw: string): boolean => getChars(s, id)!.keywords.some((k) => k.keyword === kw);
const pt = (s: GameState, id: ObjectId): string => `${getChars(s, id)!.power}/${getChars(s, id)!.toughness}`;
function settle(s0: GameState, o: { yes?: boolean; pick?: (opts: string[]) => string[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 30 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options as string[]) : (p.options as string[]).slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else break;
  }
  return s;
}
function finish(s0: GameState, o: Parameters<typeof settle>[1] = {}): GameState {
  let s = settle(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending && s.pending.kind !== 'priority' ? settle(s, o) : pass(s);
  return s;
}
const castable = (s: GameState, name: string, who: 'p1' | 'p2' = 'p1'): boolean => legal(s, who, 'cast').some((a) => (a.action as { card?: string }).card === find(s, name, 'hand', who));
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);

describe('CR 601.3, 101.2, 513.1: "Cast ~ only during your end step." (Necrologia)', () => {
  const SIP = card('Test Dusk Sip', 'Instant', 'Cast ~ only during your end step.\nDraw a card.');
  const setup = (): GameState => scenario(['Plains'], { p1: { hand: ['Test Dusk Sip'] }, defs: [SIP] });
  it('is automated, with a cast restriction on the end step of its caster', () => {
    expect(full(SIP)).toBe(true);
    expect(JSON.stringify(SIP.faces)).toContain('"step":["end"]');
  });
  it('can be cast in its caster\'s end step', () => {
    const s = advanceTo(setup(), 1, 'end');
    expect(castable(s, 'Test Dusk Sip')).toBe(true);
  });
  it('negative: not in the caster\'s main phase', () => {
    expect(castable(advanceTo(setup(), 1, 'main1'), 'Test Dusk Sip')).toBe(false);
  });
  it('negative: not in an opponent\'s end step', () => {
    let s = advanceTo(setup(), 2, 'end');
    s = pass(s); // the active player (p2) passes; p1 now has priority in p2's end step
    expect(s.turn.step).toBe('end');
    expect(s.pending?.player).toBe('p1');
    expect(castable(s, 'Test Dusk Sip')).toBe(false);
  });
});

describe('CR 101.2, 701.6a: "Instant, sorcery, and Dragon spells you control can\'t be countered." (Taigam, Ojutai Master)', () => {
  const GUARD = card('Test Shield Mage', 'Legendary Creature — Human Monk', "Instant, sorcery, and Dragon spells you control can't be countered.", ['2', '2']);
  const ZAP = card('Test Little Zap', 'Instant', 'You gain 1 life.', undefined, '{1}');
  const WISP = card('Test Cheap Wisp', 'Creature — Spirit', '', ['1', '1'], '{1}');
  const DRAKE = card('Test Cheap Drake', 'Creature — Dragon', '', ['1', '1'], '{1}');
  const HUSH = card('Test Hush', 'Instant', 'Counter target spell.');
  const defs = [GUARD, ZAP, WISP, DRAKE, HUSH];
  const resolved = (name: string, guard: boolean): boolean => {
    let s = scenario([], { defs, p1: { hand: [name], battlefield: ['Plains', 'Plains', ...(guard ? ['Test Shield Mage'] : [])] }, p2: { hand: ['Test Hush'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = pass(s);
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Hush', 'hand', 'p2') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: spell }] });
    s = finish(s);
    return name === 'Test Little Zap' ? life(s, 'p1') === 21 : s.zones.battlefield.some((id) => s.objects[id]!.defId === name);
  };
  it('is automated', () => expect(full(GUARD)).toBe(true));
  it('an instant and a Dragon creature spell are not countered', () => {
    expect(resolved('Test Little Zap', true)).toBe(true);
    expect(resolved('Test Cheap Drake', true)).toBe(true);
  });
  it('negative: a non-Dragon creature spell is countered, and so is an instant without the permanent', () => {
    expect(resolved('Test Cheap Wisp', true)).toBe(false);
    expect(resolved('Test Little Zap', false)).toBe(false);
  });
});

describe('CR 205.3g, 613.4c: "Each creature you control that\'s a Food or a Golem gets +2/+2 and has trample." (Brenard, Ginger Sculptor)', () => {
  const LORD = card('Test Sculptor', 'Legendary Creature — Human Artificer', "Each creature you control that's a Food or a Golem gets +2/+2 and has trample.", ['2', '2']);
  const FG = card('Test Food Golem', 'Artifact Creature — Food Golem', '', ['1', '1']);
  const GOLEM = card('Test Clay Golem', 'Artifact Creature — Golem', '', ['3', '3']);
  const FOOD = card('Test Plain Food', 'Artifact — Food', '');
  const defs = [LORD, FG, GOLEM, FOOD, BEAR];
  it('is automated', () => expect(full(LORD)).toBe(true));
  it('Food Golem and Golem creatures get +2/+2 and trample; a Bear, the lord itself and the opponent\'s Golem do not; a Food that is no creature is not a creature', () => {
    const s = scenario([], { defs, p1: { battlefield: ['Test Sculptor', 'Test Food Golem', 'Test Clay Golem', 'Test Bear', 'Test Plain Food'] }, p2: { battlefield: ['Test Clay Golem'] } });
    expect(pt(s, find(s, 'Test Food Golem', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Clay Golem', 'battlefield', 'p1'))).toBe('5/5');
    expect(has(s, find(s, 'Test Clay Golem', 'battlefield', 'p1'), 'trample')).toBe(true);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Sculptor', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Clay Golem', 'battlefield', 'p2'))).toBe('3/3');
    expect(getChars(s, find(s, 'Test Plain Food', 'battlefield', 'p1'))!.types).not.toContain('Creature');
  });
});

describe('CR 109.2, 701.21a: "At the beginning of your upkeep, sacrifice a creature other than this creature." (Demonic Taskmaster)', () => {
  const TASK = card('Test Taskmaster', 'Creature — Imp', 'Flying\nAt the beginning of your upkeep, sacrifice a creature other than this creature.', ['4', '3']);
  const defs = [TASK, BEAR];
  it('is automated', () => expect(full(TASK)).toBe(true));
  it('sacrifices the other creature, never itself', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Taskmaster', 'Test Bear'] } });
    const s = finish(advanceTo(s0, 3, 'upkeep'));
    expect(s.objects[find(s, 'Test Taskmaster', 'battlefield', 'p1')]!.zone).toBe('battlefield');
    expect(findAll(s, 'Test Bear', 'battlefield', 'p1')).toEqual([]);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1);
  });
  it('negative: with no other creature nothing is sacrificed (the Taskmaster survives)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Taskmaster'] } });
    const s = finish(advanceTo(s0, 3, 'upkeep'));
    expect(s.objects[find(s, 'Test Taskmaster', 'battlefield', 'p1')]!.zone).toBe('battlefield');
  });
});

describe('CR 402.1, 102.3, 608.2h: "create X 2/2 green Wolf creature tokens, where X is the number of your opponents with four or more cards in hand." (Wolfcaller\'s Howl)', () => {
  const HOWL = card('Test Howl', 'Enchantment', 'At the beginning of your upkeep, create X 2/2 green Wolf creature tokens, where X is the number of your opponents with four or more cards in hand.');
  const wolves = (hand: number): number => {
    const names = Array.from({ length: hand }, () => 'Plains');
    const s0 = scenario([], { defs: [HOWL], p1: { battlefield: ['Test Howl'] }, p2: { hand: names } });
    const s = finish(advanceTo(s0, 3, 'upkeep'));
    return s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && getChars(s, id)!.subtypes.includes('Wolf')).length;
  };
  it('is automated', () => expect(full(HOWL)).toBe(true));
  it('an opponent with four cards in hand at the upkeep (three, then the draw of their turn): one Wolf', () => expect(wolves(3)).toBe(1));
  it('negative: an opponent with three cards in hand at the upkeep: none', () => expect(wolves(2)).toBe(0));
});

describe('CR 119.5, 103.4: "When ~ enters, if your life total is less than your starting life total, it becomes equal to your starting life total." (Resolute Archangel)', () => {
  const ANGEL = card('Test Resolute Angel', 'Creature — Angel', 'Flying\nWhen ~ enters, if your life total is less than your starting life total, it becomes equal to your starting life total.', ['4', '4']);
  const played = (start: number): number => {
    let s = scenario([], { defs: [ANGEL], p1: { hand: ['Test Resolute Angel'] } });
    s.players.find((p) => p.id === 'p1')!.life = start;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Resolute Angel', 'hand', 'p1') });
    s = finish(s);
    return life(s, 'p1');
  };
  it('is automated', () => expect(full(ANGEL)).toBe(true));
  it('life 7 becomes 20 (the starting life total)', () => expect(played(7)).toBe(20));
  it('negative: life 25 is not reduced', () => expect(played(25)).toBe(25));
});

describe('CR 701.22a, 614.1a: "If you would scry a number of cards, scry that many cards plus one instead." (Kenessos, Priest of Thassa)', () => {
  const PRIEST = card('Test Scry Priest', 'Legendary Creature — Merfolk Priest', 'If you would scry a number of cards, scry that many cards plus one instead.', ['3', '3']);
  const PEEK = card('Test Peek', 'Sorcery', 'Scry 1.');
  const options = (priest: boolean, who: 'p1' | 'p2'): number => {
    let s = scenario([], { defs: [PRIEST, PEEK], p1: { hand: who === 'p1' ? ['Test Peek'] : [], battlefield: priest ? ['Test Scry Priest'] : [] }, p2: { hand: who === 'p2' ? ['Test Peek'] : [] } });
    for (const p of ['p1', 'p2'] as const) for (let i = 0; i < 3; i++) put(s, p, 'library', 'Plains');
    s = act(s, { type: 'cast', player: who, card: find(s, 'Test Peek', 'hand', who) });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    if (who === 'p2') return -1;
    s = pass(pass(s));
    const p = s.pending;
    return p?.kind === 'chooseObjects' ? (p.options as string[]).length : 0;
  };
  it('is automated', () => expect(full(PRIEST)).toBe(true));
  it('you scry 2 instead of 1', () => expect(options(true, 'p1')).toBe(2));
  it('control: without the replacement you scry 1', () => expect(options(false, 'p1')).toBe(1));
  it('negative: an opponent\'s scry is not increased (the replacement is for you only)', () => {
    let s = scenario([], { defs: [PRIEST, PEEK], p1: { battlefield: ['Test Scry Priest'] }, p2: { hand: ['Test Peek'] } });
    for (const p of ['p1', 'p2'] as const) for (let i = 0; i < 3; i++) put(s, p, 'library', 'Plains');
    s = advanceTo(s, 2, 'main1');
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Peek', 'hand', 'p2') });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseObjects');
    expect((s.pending as { options: string[] }).options.length).toBe(1);
  });
});

describe('CR 402.1, 122.1: "~ enters with X +1/+1 counters on it, where X is the total number of cards in all players\' hands." (Realm Seekers)', () => {
  const SEEKER = card('Test Seeker', 'Creature — Elf Scout', "~ enters with X +1/+1 counters on it, where X is the total number of cards in all players' hands.", ['0', '0']);
  it('is automated', () => expect(full(SEEKER)).toBe(true));
  it('counts the cards in every hand after it leaves yours (2 in yours, 3 in the opponent\'s: 5)', () => {
    let s = scenario([], { defs: [SEEKER], p1: { hand: ['Test Seeker', 'Plains', 'Plains'] }, p2: { hand: ['Plains', 'Plains', 'Plains'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Seeker', 'hand', 'p1') });
    s = finish(s);
    expect(pt(s, find(s, 'Test Seeker', 'battlefield', 'p1'))).toBe('5/5');
  });
});

describe('CR 601.2f, 702.19b: "Each creature spell you cast costs {1} less to cast if it has mutate." (Pollywog Symbiote)', () => {
  const POLLY = card('Test Cost Cutter', 'Creature — Frog', 'Each creature spell you cast costs {1} less to cast if it has mutate.', ['1', '1']);
  const MUTANT = card('Test Mutant', 'Creature — Beast', 'Mutate {2}{U}', ['2', '2'], '{2}{U}');
  const PLAIN = card('Test Plain Beast', 'Creature — Beast', '', ['2', '2'], '{2}{U}');
  const defs = [POLLY, MUTANT, PLAIN];
  const can = (name: string, polly: boolean): boolean => {
    const s = scenario(['Island'], { defs, p1: { hand: [name], battlefield: ['Island', 'Island', ...(polly ? ['Test Cost Cutter'] : [])] } });
    return castable(s, name);
  };
  it('is automated', () => expect(full(POLLY)).toBe(true));
  it('a creature spell with mutate costs {1} less: castable with two lands', () => expect(can('Test Mutant', true)).toBe(true));
  it('negative: without the reducer it needs three lands; a creature spell without mutate is not reduced', () => {
    expect(can('Test Mutant', false)).toBe(false);
    expect(can('Test Plain Beast', true)).toBe(false);
  });
});

describe('CR 604.1, 613.4c: "As long as you control six or more lands, ~ and land creatures you control get +2/+2." (Sylvan Advocate)', () => {
  const ADV = card('Test Grove Advocate', 'Creature — Elf Cleric', 'As long as you control six or more lands, ~ and land creatures you control get +2/+2.', ['2', '3']);
  const DRYAD = card('Test Land Dryad', 'Land Creature — Forest Dryad', '', ['1', '1']);
  const defs = [ADV, DRYAD, BEAR];
  const board = (forests: number): GameState => scenario(['Forest'], { defs, p1: { battlefield: ['Test Grove Advocate', 'Test Land Dryad', 'Test Bear', ...Array.from({ length: forests }, () => 'Forest')] }, p2: { battlefield: ['Test Land Dryad'] } });
  it('is automated', () => expect(full(ADV)).toBe(true));
  it('six lands (the land creature counts): the Advocate and your land creature get +2/+2, the Bear and the opponent\'s land creature do not', () => {
    const s = board(5);
    expect(pt(s, find(s, 'Test Grove Advocate', 'battlefield', 'p1'))).toBe('4/5');
    expect(pt(s, find(s, 'Test Land Dryad', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Land Dryad', 'battlefield', 'p2'))).toBe('1/1');
  });
  it('negative: five lands, no bonus', () => {
    const s = board(4);
    expect(pt(s, find(s, 'Test Grove Advocate', 'battlefield', 'p1'))).toBe('2/3');
    expect(pt(s, find(s, 'Test Land Dryad', 'battlefield', 'p1'))).toBe('1/1');
  });
});

describe('CR 604.1, 613.4c, 613.1f: "As long as the top card of your library is black, ~ and other Vampire creatures you control get +2/+1 and have flying." (Vampire Nocturnus)', () => {
  const NOCT = card('Test Night Lord', 'Creature — Vampire', 'As long as the top card of your library is black, ~ and other Vampire creatures you control get +2/+1 and have flying.', ['3', '3']);
  const BAT = card('Test Night Bat', 'Creature — Vampire', '', ['1', '1']);
  const BLACK = card('Test Black Card', 'Sorcery', '', undefined, '{B}');
  const defs = [NOCT, BAT, BLACK, BEAR];
  const board = (black: boolean): GameState => {
    const s = scenario(['Plains'], { defs, p1: { battlefield: ['Test Night Lord', 'Test Night Bat', 'Test Bear'] } });
    put(s, 'p1', 'library', black ? 'Test Black Card' : 'Plains');
    s.zones.library['p1']!.unshift(s.zones.library['p1']!.pop()!); // the card put last is the top card
    return s;
  };
  it('is automated', () => expect(full(NOCT)).toBe(true));
  it('black top card: both Vampires get +2/+1 and flying, the Bear does not', () => {
    const s = board(true);
    const lord = find(s, 'Test Night Lord', 'battlefield', 'p1');
    const bat = find(s, 'Test Night Bat', 'battlefield', 'p1');
    expect(pt(s, lord)).toBe('5/4');
    expect(pt(s, bat)).toBe('3/2');
    expect(has(s, bat, 'flying')).toBe(true);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
  });
  it('negative: a nonblack top card, no bonus', () => {
    const s = board(false);
    expect(pt(s, find(s, 'Test Night Lord', 'battlefield', 'p1'))).toBe('3/3');
    expect(has(s, find(s, 'Test Night Bat', 'battlefield', 'p1'), 'flying')).toBe(false);
  });
});

describe('CR 109.2, 701.21a, 608.2c: "sacrifice a creature other than ~. If you can\'t, ~ deals 7 damage to you." (Lord of the Pit, made full by the same reading)', () => {
  const PIT = card('Test Pit Lord', 'Creature — Demon', "At the beginning of your upkeep, sacrifice a creature other than ~. If you can't, ~ deals 7 damage to you.", ['7', '7']);
  const run = (others: boolean): GameState => finish(advanceTo(scenario([], { defs: [PIT, BEAR], p1: { battlefield: others ? ['Test Pit Lord', 'Test Bear'] : ['Test Pit Lord'] } }), 3, 'upkeep'));
  it('is automated', () => expect(full(PIT)).toBe(true));
  it('with another creature: it is sacrificed and no damage is dealt', () => {
    const s = run(true);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1').length).toBe(1);
    expect(life(s, 'p1')).toBe(20);
  });
  it('negative: with no other creature you take 7 damage and the Demon stays', () => {
    const s = run(false);
    expect(life(s, 'p1')).toBe(13);
    expect(s.objects[find(s, 'Test Pit Lord', 'battlefield', 'p1')]!.zone).toBe('battlefield');
  });
});

// Eternity Vessel rides edh-c-12's reading (fix:edhv12-life-total-become-may).
describe('CR 119.5, 608.2d: "you may have your life total become the number of charge counters on ~." (Eternity Vessel)', () => {
  const VESSEL = card('Test Vessel', 'Artifact', 'This artifact enters with X charge counters on it, where X is your life total.\nWhenever a land you control enters, you may have your life total become the number of charge counters on ~.');
  const run = (yes: boolean): number => {
    let s = scenario([], { defs: [VESSEL], p1: { hand: ['Plains'], battlefield: [{ name: 'Test Vessel', counters: { charge: 5 } }] } });
    s.players.find((p) => p.id === 'p1')!.life = 12;
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Plains', 'hand', 'p1') });
    s = finish(s, { yes });
    return life(s, 'p1');
  };
  it('is automated', () => expect(full(VESSEL)).toBe(true));
  it('accepting sets the life total to the counters', () => expect(run(true)).toBe(5));
  it('negative: declining leaves the life total', () => expect(run(false)).toBe(12));
});

