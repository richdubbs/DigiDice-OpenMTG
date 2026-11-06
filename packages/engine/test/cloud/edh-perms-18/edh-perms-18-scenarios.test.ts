/**
 * Commander lane edh-perms, round edh-perms-18: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default
 * compiler. Alice (p1) is the active player. CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 707.2, 608.2h, 701.21a  "Create two tokens that are copies of the sacrificed creature." (a cost's last known information, copiable values only)
 *   CR 701.21a, 118.3, 602.2b  "Sacrifice ~ and three Clue tokens" (both parts are one cost: all or nothing)
 *   CR 608.2d, 110.2a          "You may put a red creature card or an artifact creature card from your hand onto the battlefield."
 *   CR 608.2h, 903.3           "... where X is the power of the creature exiled this way" (last known information) on "a commander creature you control"
 *   CR 109.2, 608.2c           "... if you control a white permanent other than that creature or ~."
 *   CR 603.2, 701.21a          "Whenever you sacrifice another nontoken permanent during your turn, ..."
 *   CR 122.6, 603.4            "... if a counter was put on ~ this turn, ..."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { commanderOptions } from '../../../src/core/commander';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; loyalty?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const obj = (id: string): TargetChoice => ({ kind: 'object', id });

const MORTICIAN = card('Test Mortician', 'Creature — Zombie Horror', '{3}, {T}, Sacrifice another Zombie: Create two tokens that are copies of the sacrificed creature.', { pt: ['2', '2'] });
const GHOUL = card('Test Ghoul', 'Creature — Zombie', '', { pt: ['2', '2'] });
const ROCK = card('Test Rock', 'Creature — Golem', '', { pt: ['2', '2'] });
const RELIC = card('Test Relic', 'Artifact', '{T}, Sacrifice this artifact and three Clue tokens: Each opponent loses 3 life.');
const MAKER = card('Test Maker', 'Artifact', '{0}: Create a Clue token.');
const IDOL = card('Test Idol', 'Artifact', '{0}: You may put a red creature card or an artifact creature card from your hand onto the battlefield. Sacrifice it at the beginning of the next end step.');
const RED_BEAST = card('Test Red Beast', 'Creature — Beast', '', { pt: ['2', '2'], colors: ['R'] });
const GEAR = card('Test Gear', 'Artifact Creature — Construct', '', { pt: ['1', '1'] });
const GREEN_BEAST = card('Test Green Beast', 'Creature — Beast', '', { pt: ['2', '2'], colors: ['G'] });
const BANISH = card('Test Banish', 'Sorcery', 'Exile target creature. Put X +1/+1 counters on a commander creature you control, where X is the power of the creature exiled this way.');
const CHIEF = card('Test Chief', 'Creature — Human', '', { pt: ['2', '2'] });
const GRUNT = card('Test Grunt', 'Creature — Human', '', { pt: ['2', '2'] });
const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['3', '3'] });
const BINDER = card('Test Binder', 'Legendary Planeswalker — Test', '−1: Gain control of target creature. Put a lifelink counter on it if you control a white permanent other than that creature or ~.', { loyalty: '6', colors: ['W'] });
const LANTERN = card('Test Lantern', 'Artifact Creature — Construct', '', { pt: ['1', '1'], colors: ['W'] });
const WHITE_KNIGHT = card('Test White Knight', 'Creature — Knight', '', { pt: ['2', '2'], colors: ['W'] });
const SHEPHERD = card('Test Shepherd', 'Creature — Druid', 'Whenever you sacrifice another nontoken permanent during your turn, put a number of +1/+1 counters equal to ~\'s power on up to one other target creature.', { pt: ['3', '3'] });
const ALTAR = card('Test Altar', 'Artifact', '{0}, Sacrifice a permanent: You gain 1 life.');
const PAIR_ALTAR = card('Test Pair Altar', 'Artifact', '{0}, Sacrifice two permanents: You gain 1 life.');
const FODDER = card('Test Fodder', 'Artifact', '');
const MOUSE = card('Test Mouse', 'Creature — Mouse', '', { pt: ['1', '1'] });
const TREASURE_MAKER = card('Test Gold Maker', 'Artifact', '{0}: Create a Treasure token.');
const GUARDIAN = card('Test Guardian', 'Creature — Warrior', 'At the beginning of your end step, if a counter was put on ~ this turn, put a +1/+1 counter on each other creature you control.', { pt: ['2', '2'] });
const BYSTANDER = card('Test Bystander', 'Creature — Citizen', '', { pt: ['1', '1'] });
const TONIC = card('Test Tonic', 'Sorcery', 'Put a +1/+1 counter on target creature.');

const DEFS = [MORTICIAN, GHOUL, ROCK, RELIC, MAKER, IDOL, RED_BEAST, GEAR, GREEN_BEAST, BANISH, CHIEF, GRUNT, GIANT, BINDER, LANTERN, WHITE_KNIGHT, SHEPHERD, ALTAR, PAIR_ALTAR, FODDER, MOUSE, TREASURE_MAKER, GUARDIAN, BYSTANDER, TONIC];

interface Drive { targets?: TargetChoice[]; pick?: (options: ObjectId[]) => ObjectId[]; offered?: ObjectId[][] }
/** Answer every decision until the stack is empty and nobody has a decision but priority; passes priority only while something is on the stack. */
function settle(s0: GameState, d: Drive = {}): GameState {
  let s = s0;
  for (let g = 0; g < 60; g++) {
    const p = s.pending;
    if (p === undefined || p === null) break;
    if (p.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = pass(s);
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: d.targets ?? [] });
    else if (p.kind === 'chooseObjects') {
      d.offered?.push([...p.options]);
      s = answer(s, { kind: 'chooseObjects', ids: (d.pick ?? ((o) => o.slice(0, p.min)))(p.options) });
    } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
  }
  return s;
}
const activations = (s: GameState, id: ObjectId) => legal(s, 'p1', 'activate').filter((a) => a.object === id && !a.isMana);
const activate = (s: GameState, id: ObjectId, d: Drive = {}): GameState => settle(act(s, activations(s, id)[0]!.action), d);
const names = (s: GameState, zone: 'battlefield' | 'graveyard' | 'exile', owner = 'p1'): string[] =>
  (zone === 'battlefield' ? s.zones.battlefield.filter((id) => s.objects[id]!.controller === owner) : zone === 'exile' ? s.zones.exile : s.zones.graveyard[owner]!).map((id) => s.objects[id]!.defId);
/** Objects of a name on the battlefield, tokens included (`findAll` reads cards only). */
const onField = (s: GameState, name: string, controller = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]?.name === name && s.objects[id]!.controller === controller);
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]!.counters[kind] ?? 0;
const castSpell = (s: GameState, name: string, target: ObjectId | undefined): GameState => {
  const t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
  return settle(t, { targets: target === undefined ? [] : [obj(target)] });
};

describe('design 6.9: the round\'s test cards compile fully', () => {
  it('every card with a rules text is fully automated', () => {
    for (const d of [MORTICIAN, RELIC, MAKER, IDOL, BANISH, BINDER, SHEPHERD, ALTAR, GUARDIAN, TONIC]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 707.2, 608.2h: "Create two tokens that are copies of the sacrificed creature."', () => {
  it('sacrificing another Zombie makes two token copies of it; the sacrificed creature is in the graveyard', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Mortician', 'Test Ghoul', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const s = activate(s0, find(s0, 'Test Mortician', 'battlefield'), { pick: (o) => [o[0]!] });
    expect(onField(s, 'Test Ghoul')).toHaveLength(2);
    expect(names(s, 'graveyard')).toContain('Test Ghoul');
    for (const id of onField(s, 'Test Ghoul')) expect(s.objects[id]!.kind).toBe('token');
  });
  it('the copies get the copiable values only: the +1/+1 counters the sacrificed creature had are not copied (CR 707.2)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Mortician', { name: 'Test Ghoul', counters: { '+1/+1': 2 } }, 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    const s = activate(s0, find(s0, 'Test Mortician', 'battlefield'), { pick: (o) => [o[0]!] });
    const copies = onField(s, 'Test Ghoul');
    expect(copies).toHaveLength(2);
    for (const id of copies) { expect(Number(getChars(s, id)!.power)).toBe(2); expect(counters(s, id)).toBe(0); }
  });
  it('only another Zombie can be sacrificed: with a non-Zombie alone, the ability cannot be activated', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Mortician', 'Test Rock', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    expect(activations(s0, find(s0, 'Test Mortician', 'battlefield'))).toEqual([]);
  });
  it('the source alone is not "another" Zombie', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Mortician', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
    expect(activations(s0, find(s0, 'Test Mortician', 'battlefield'))).toEqual([]);
  });
  it('the sacrificed creature is the only thing copied: an action on it other than a copy stays manual (the creature is in the graveyard, CR 400.7)', () => {
    expect(full(card('Test Pivot', 'Creature — Zombie Horror', '{3}, Sacrifice another Zombie: Return the sacrificed creature to the battlefield.', { pt: ['1', '1'] }))).toBe(false);
  });
});

describe('CR 701.21a, 118.3, 602.2b: "Sacrifice ~ and three Clue tokens" is one cost', () => {
  const makeClues = (s0: GameState, n: number): GameState => {
    let s = s0;
    const maker = find(s0, 'Test Maker', 'battlefield');
    for (let i = 0; i < n; i++) s = activate(s, maker);
    return s;
  };
  it('with three Clue tokens, the relic and the three tokens are sacrificed and each opponent loses 3 life', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Relic', 'Test Maker'] }, defs: DEFS });
    const s1 = makeClues(s0, 3);
    expect(onField(s1, 'Clue Token')).toHaveLength(3);
    const relic = find(s1, 'Test Relic', 'battlefield');
    const s = activate(s1, relic, { pick: (o) => o });
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(17);
    expect(names(s, 'battlefield')).not.toContain('Test Relic');
    expect(onField(s, 'Clue Token')).toHaveLength(0);
  });
  it('with two Clue tokens the ability cannot be activated (the whole cost cannot be paid, CR 118.3)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Relic', 'Test Maker'] }, defs: DEFS });
    const s1 = makeClues(s0, 2);
    expect(activations(s1, find(s1, 'Test Relic', 'battlefield'))).toEqual([]);
  });
});

describe('CR 608.2d, 110.2a: "You may put a red creature card or an artifact creature card from your hand onto the battlefield." and Sacrifice it at the beginning of the next end step', () => {
  it('offers the red creature and the artifact creature, not the green one; the one chosen enters and is sacrificed at the next end step', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Idol'], hand: ['Test Red Beast', 'Test Gear', 'Test Green Beast'] }, defs: DEFS });
    const offered: ObjectId[][] = [];
    const gear = find(s0, 'Test Gear', 'hand', 'p1');
    const s1 = activate(s0, find(s0, 'Test Idol', 'battlefield'), { pick: () => [gear], offered });
    expect(offered).toHaveLength(1);
    expect(offered[0]!.map((id) => s0.objects[id]!.defId).sort()).toEqual(['Test Gear', 'Test Red Beast']);
    expect(names(s1, 'battlefield')).toContain('Test Gear');
    const s2 = settle(advanceTo(s1, 1, 'end'));
    expect(names(s2, 'battlefield')).not.toContain('Test Gear');
    expect(names(s2, 'graveyard')).toContain('Test Gear');
  });
  it('a hand with only a green creature offers nothing and puts nothing onto the battlefield', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Idol'], hand: ['Test Green Beast'] }, defs: DEFS });
    const s1 = activate(s0, find(s0, 'Test Idol', 'battlefield'));
    expect(names(s1, 'battlefield')).not.toContain('Test Green Beast');
    expect(s1.zones.hand['p1']!.map((id) => s1.objects[id]!.defId)).toContain('Test Green Beast');
  });
  it('declining (choosing none) leaves the hand alone', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Idol'], hand: ['Test Red Beast'] }, defs: DEFS });
    const s1 = activate(s0, find(s0, 'Test Idol', 'battlefield'), { pick: () => [] });
    expect(names(s1, 'battlefield')).not.toContain('Test Red Beast');
  });
});

describe('CR 608.2h, 903.3: "Exile target creature. Put X +1/+1 counters on a commander creature you control, where X is the power of the creature exiled this way."', () => {
  const setup = (withCommander: boolean): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Banish'], battlefield: ['Test Chief', 'Test Grunt'] }, p2: { battlefield: [{ name: 'Test Giant', counters: { '+1/+1': 2 } }] }, defs: DEFS });
    if (withCommander) {
      const chief = s0.objects[find(s0, 'Test Chief', 'battlefield')]!;
      s0.options.commander = commanderOptions('commander');
      s0.players.find((p) => p.id === 'p1')!.commanders = [{ card: chief.cardId!, defId: chief.defId, casts: 0, identity: [] }];
    }
    return s0;
  };
  it('X is the power the exiled creature last had (3 base + 2 counters = 5), counters go on the commander creature only', () => {
    const s0 = setup(true);
    const s = castSpell(s0, 'Test Banish', find(s0, 'Test Giant', 'battlefield', 'p2'));
    expect(counters(s, find(s0, 'Test Chief', 'battlefield'))).toBe(5);
    expect(counters(s, find(s0, 'Test Grunt', 'battlefield'))).toBe(0);
    expect(names(s, 'exile')).toContain('Test Giant');
  });
  it('with no commander creature the creature is still exiled and no counters are put', () => {
    const s0 = setup(false);
    const s = castSpell(s0, 'Test Banish', find(s0, 'Test Giant', 'battlefield', 'p2'));
    expect(counters(s, find(s0, 'Test Chief', 'battlefield'))).toBe(0);
    expect(counters(s, find(s0, 'Test Grunt', 'battlefield'))).toBe(0);
    expect(names(s, 'exile')).toContain('Test Giant');
  });
  it('"the creature exiled this way" is read only after an exile: the same words after a destroy are not read', () => {
    expect(full(card('Test Smite', 'Sorcery', 'Destroy target creature. Put X +1/+1 counters on a creature you control, where X is the power of the creature exiled this way.'))).toBe(false);
  });
});

describe('CR 109.2, 608.2c: "Put a lifelink counter on it if you control a white permanent other than that creature or ~."', () => {
  it('with another white permanent besides the stolen creature and the planeswalker, the stolen creature gets the counter', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Binder', counters: { loyalty: 6 } }, 'Test Lantern'] }, p2: { battlefield: ['Test Giant'] }, defs: DEFS });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const s = activate(s0, find(s0, 'Test Binder', 'battlefield'), { targets: [obj(giant)] });
    expect(s.objects[giant]!.controller).toBe('p1');
    expect(counters(s, giant, 'lifelink')).toBe(1);
  });
  it('the planeswalker is white itself but is excluded, and so is a stolen white creature: no counter', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Binder', counters: { loyalty: 6 } }] }, p2: { battlefield: ['Test White Knight'] }, defs: DEFS });
    const knight = find(s0, 'Test White Knight', 'battlefield', 'p2');
    const s = activate(s0, find(s0, 'Test Binder', 'battlefield'), { targets: [obj(knight)] });
    expect(s.objects[knight]!.controller).toBe('p1');
    expect(counters(s, knight, 'lifelink')).toBe(0);
  });
  it('a white permanent an opponent controls does not count', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Binder', counters: { loyalty: 6 } }] }, p2: { battlefield: ['Test Giant', 'Test Lantern'] }, defs: DEFS });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    const s = activate(s0, find(s0, 'Test Binder', 'battlefield'), { targets: [obj(giant)] });
    expect(counters(s, giant, 'lifelink')).toBe(0);
  });
});

describe('CR 603.2, 701.21a: "Whenever you sacrifice another nontoken permanent during your turn, put a number of +1/+1 counters equal to ~\'s power on up to one other target creature."', () => {
  it('on your turn, sacrificing a nontoken permanent puts counters equal to its power on the other creature', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shepherd', 'Test Altar', 'Test Fodder', 'Test Mouse'] }, defs: DEFS });
    const mouse = find(s0, 'Test Mouse', 'battlefield');
    const fodder = find(s0, 'Test Fodder', 'battlefield');
    const s = activate(s0, find(s0, 'Test Altar', 'battlefield'), { pick: () => [fodder], targets: [obj(mouse)] });
    expect(counters(s, mouse)).toBe(3);
  });
  it('a token sacrificed does not trigger it', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shepherd', 'Test Altar', 'Test Gold Maker', 'Test Mouse'] }, defs: DEFS });
    const mouse = find(s0, 'Test Mouse', 'battlefield');
    const s1 = activate(s0, find(s0, 'Test Gold Maker', 'battlefield'));
    const treasure = onField(s1, 'Treasure Token')[0]!;
    const s = activate(s1, find(s1, 'Test Altar', 'battlefield'), { pick: () => [treasure], targets: [obj(mouse)] });
    expect(onField(s, 'Treasure Token')).toHaveLength(0);
    expect(counters(s, mouse)).toBe(0);
  });
  it('during an opponent\'s turn it does not trigger', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shepherd', 'Test Altar', 'Test Fodder', 'Test Mouse'] }, defs: DEFS });
    const mouse = find(s0, 'Test Mouse', 'battlefield');
    const fodder = find(s0, 'Test Fodder', 'battlefield');
    let s = advanceTo(s0, 2, 'main1');
    s = pass(s); // Bob passes; Alice gets priority in Bob's main phase
    expect(s.turn.activePlayer).toBe('p2');
    s = activate(s, find(s, 'Test Altar', 'battlefield'), { pick: () => [fodder], targets: [obj(mouse)] });
    expect(names(s, 'graveyard')).toContain('Test Fodder');
    expect(counters(s, mouse)).toBe(0);
  });
  it('the Shepherd sacrificed together with another nontoken permanent still triggers for the other one, and its power is read as it last existed (Scryfall 2025-07-25)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shepherd', 'Test Pair Altar', 'Test Fodder', 'Test Mouse'] }, defs: DEFS });
    const mouse = find(s0, 'Test Mouse', 'battlefield');
    const pair = [find(s0, 'Test Shepherd', 'battlefield'), find(s0, 'Test Fodder', 'battlefield')];
    const s = activate(s0, find(s0, 'Test Pair Altar', 'battlefield'), { pick: () => pair, targets: [obj(mouse)] });
    expect(names(s, 'graveyard')).toContain('Test Shepherd');
    expect(counters(s, mouse)).toBe(3);
  });
  it('the Shepherd itself being sacrificed is not "another" permanent', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shepherd', 'Test Altar', 'Test Mouse'] }, defs: DEFS });
    const mouse = find(s0, 'Test Mouse', 'battlefield');
    const shepherd = find(s0, 'Test Shepherd', 'battlefield');
    const s = activate(s0, find(s0, 'Test Altar', 'battlefield'), { pick: () => [shepherd], targets: [obj(mouse)] });
    expect(counters(s, mouse)).toBe(0);
  });
});

describe('CR 122.6, 603.4: "At the beginning of your end step, if a counter was put on ~ this turn, put a +1/+1 counter on each other creature you control."', () => {
  const toEnd = (s: GameState): GameState => settle(advanceTo(s, 1, 'end'));
  it('a counter put on the Guardian this turn: each other creature you control gets a counter at the end step', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Guardian', 'Test Bystander'] }, defs: DEFS });
    const guardian = find(s0, 'Test Guardian', 'battlefield');
    const bystander = find(s0, 'Test Bystander', 'battlefield');
    const s = toEnd(castSpell(s0, 'Test Tonic', guardian));
    expect(counters(s, guardian)).toBe(1);
    expect(counters(s, bystander)).toBe(1);
  });
  it('no counter put on it this turn: nothing happens (the intervening "if", CR 603.4)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Guardian', 'Test Bystander'] }, defs: DEFS });
    const s = toEnd(s0);
    expect(counters(s, find(s0, 'Test Bystander', 'battlefield'))).toBe(0);
  });
  it('a counter put on another creature does not count', () => {
    const s0 = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Guardian', 'Test Bystander'] }, defs: DEFS });
    const bystander = find(s0, 'Test Bystander', 'battlefield');
    const s = toEnd(castSpell(s0, 'Test Tonic', bystander));
    expect(counters(s, bystander)).toBe(1);
  });
  it('a counter it already had from before this turn does not count', () => {
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Guardian', counters: { '+1/+1': 1 } }, 'Test Bystander'] }, defs: DEFS });
    const s = toEnd(s0);
    expect(counters(s, find(s0, 'Test Bystander', 'battlefield'))).toBe(0);
  });
});
