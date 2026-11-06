/**
 * Commander lane edh-c, round edh-c-68 (EDHREC ranks 26,001-26,500, second pass): the round's readings played through the engine with synthetic cards (invented
 * names, design 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its
 * negative case. CR cites checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 601.2d, 107.3          "~ deals X damage divided as you choose among any number of target creatures, where X is the number of creatures on the battlefield as you cast ~." (Volcanic Wind)
 *   CR 119.3, 107.3           "You gain X plus 1 life, where X is the number of green creatures on the battlefield." (An-Havva Inn)
 *   CR 102.3, 603.4           "Whenever ~ attacks, if your team controls another Warrior, ~ gains first strike until end of turn." (Bull-Rush Bruiser)
 *   CR 701.9a, 608.2c         "Target player discards two cards, then draws as many cards as they discarded this way." (Forget)
 *   CR 603.2, 120.3           "Whenever a Swamp, Mountain, black permanent, or red permanent becomes tapped, ~ deals 1 damage to that permanent's controller." (Royal Decree)
 *   CR 120.1, 120.3, 109.5    "Whenever a noncreature source you control deals damage, you gain that much life." (Tamanoa)
 *   CR 509.3c, 508.1b         "Whenever ~ becomes blocked, it deals 1 damage to the player or planeswalker it's attacking." (Rakdos Roustabout)
 *   CR 502.3, 611.2b          "That creature doesn't untap during its controller's untap step for as long as ~ remains on the battlefield." (Somnophore)
 *   CR 303.4f, 303.4g         "Put target Aura card from a graveyard onto the battlefield under your control attached to ~." (Iridescent Drake)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { cast, pt, resolveAll, settle } from '../cmd3/helpers';

/** Pay costs only: the decisions of targets and divisions are answered by the test. */
const payOnly = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
const resolveStack = (s0: GameState): GameState => {
  let s = payOnly(s0);
  for (let g = 0; g < 30 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = payOnly(pass(s));
  return s;
};

type Color = 'W' | 'U' | 'B' | 'R' | 'G';
function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d).length === 0;
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const pickT = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) });
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
const player = (id: string) => ({ kind: 'player' as const, id });
const hand = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;
const inYard = (s: GameState, name: string, p: string): boolean => (s.zones.graveyard[p] ?? []).some((id) => s.objects[id]!.defId === name);
const toMain1 = (s: GameState): GameState => passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'main phase');
const nextTurn = (s0: GameState, n: number): GameState => {
  let s = s0;
  for (let guard = 0; s.turn.number < n && guard < 400; guard++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
  return s;
};

const WALL = card('Test Wall', 'Creature — Wall', '', { pt: ['0', '30'], cost: '{1}' });
const WALLB = card('Test Wall Twin', 'Creature — Wall', '', { pt: ['0', '30'], cost: '{1}' });
const BIG = card('Test Big', 'Creature — Giant', '', { pt: ['3', '3'], cost: '{1}' });
const SMALL = card('Test Small', 'Creature — Elf', '', { pt: ['1', '1'], cost: '{1}' });

describe('CR 601.2d, 107.3: "~ deals X damage divided as you choose among any number of target creatures, where X is the number of creatures on the battlefield as you cast this spell." (Volcanic Wind)', () => {
  const GUST = card('Test Gust', 'Sorcery', 'Test Gust deals X damage divided as you choose among any number of target creatures, where X is the number of creatures on the battlefield as you cast this spell.', { colors: ['R'] });
  const board = (): GameState => scenario([], { defs: [GUST, WALL, WALLB, BIG, SMALL], p1: { hand: ['Test Gust'], battlefield: ['Test Big', 'Test Small'] }, p2: { battlefield: ['Test Wall', 'Test Wall Twin'] } });
  it('is automated', () => expect(full(GUST), JSON.stringify(GUST.automation)).toBe(true));
  it('X is every creature on the battlefield (4, both players\'): the division asked is of 4 and the damage is dealt as divided', () => {
    let s = payOnly(act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Gust', 'hand', 'p1') } as never));
    expect(s.pending?.kind).toBe('chooseTargets');
    const walls = [find(s, 'Test Wall', 'battlefield', 'p2'), find(s, 'Test Wall Twin', 'battlefield', 'p2')];
    s = answer(s, pickT(...walls));
    expect(s.pending?.kind).toBe('chooseDivision');
    expect((s.pending as unknown as { total: number }).total).toBe(4);
    s = resolveStack(answer(s, { kind: 'chooseDivision', amounts: [3, 1] } as DecisionAnswer));
    expect(walls.map((id) => s.objects[id]!.damage)).toEqual([3, 1]);
  });
  it('negative: a division of 5 is not accepted; with one creature fewer on the battlefield the total is 3', () => {
    let s = payOnly(act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Gust', 'hand', 'p1') } as never));
    s = answer(s, pickT(find(s, 'Test Wall', 'battlefield', 'p2'), find(s, 'Test Wall Twin', 'battlefield', 'p2')));
    expect(() => answer(s, { kind: 'chooseDivision', amounts: [3, 2] } as DecisionAnswer)).toThrow();
    const b = board();
    const small = find(b, 'Test Small', 'battlefield', 'p1');
    const fewer = { ...b, objects: { ...b.objects, [small]: { ...b.objects[small]!, zone: 'graveyard' } }, zones: { ...b.zones, battlefield: b.zones.battlefield.filter((id) => id !== small) } } as GameState;
    let t = payOnly(act(fewer, { type: 'cast', player: 'p1', card: find(fewer, 'Test Gust', 'hand', 'p1') } as never));
    t = answer(t, pickT(find(t, 'Test Wall', 'battlefield', 'p2'), find(t, 'Test Wall Twin', 'battlefield', 'p2')));
    expect((t.pending as unknown as { total: number }).total).toBe(3);
  });
  it('the number is fixed as the spell is cast: a creature leaving before it resolves does not lower the damage (CR 601.2d)', () => {
    let s = payOnly(act(board(), { type: 'cast', player: 'p1', card: find(board(), 'Test Gust', 'hand', 'p1') } as never));
    const wall = find(s, 'Test Wall', 'battlefield', 'p2');
    s = answer(s, pickT(wall)); // one target: it gets everything, no division asked
    const small = find(s, 'Test Small', 'battlefield', 'p1');
    s = { ...s, objects: { ...s.objects, [small]: { ...s.objects[small]!, zone: 'graveyard' } }, zones: { ...s.zones, battlefield: s.zones.battlefield.filter((id) => id !== small) } } as GameState;
    s = resolveStack(s);
    expect(s.objects[wall]!.damage).toBe(4);
  });
});

describe('CR 119.3, 107.3: "You gain X plus 1 life, where X is the number of green creatures on the battlefield." (An-Havva Inn)', () => {
  const INN = card('Test Inn', 'Sorcery', 'You gain X plus 1 life, where X is the number of green creatures on the battlefield.', { colors: ['G'] });
  const ELF = card('Test Green Elf', 'Creature — Elf', '', { pt: ['1', '1'], colors: ['G'] });
  const OGRE = card('Test Red Ogre', 'Creature — Ogre', '', { pt: ['1', '1'], colors: ['R'] });
  const board = (): GameState => scenario([], { defs: [INN, ELF, OGRE], p1: { hand: ['Test Inn'], battlefield: ['Test Green Elf', 'Test Red Ogre'] }, p2: { battlefield: ['Test Green Elf'] } });
  it('is automated', () => expect(full(INN), JSON.stringify(INN.automation)).toBe(true));
  it('gains one more than the green creatures of both players (2 + 1 = 3); the red creature does not count', () => {
    const s0 = board();
    expect(life(resolveAll(cast(s0, 'Test Inn')), 'p1')).toBe(life(s0, 'p1') + 3);
  });
  it('negative: with no green creature it gains exactly 1', () => {
    const s0 = scenario([], { defs: [INN, OGRE], p1: { hand: ['Test Inn'], battlefield: ['Test Red Ogre'] } });
    expect(life(resolveAll(cast(s0, 'Test Inn')), 'p1')).toBe(life(s0, 'p1') + 1);
  });
});

describe('CR 102.3, 603.4: "Whenever ~ attacks, if your team controls another Warrior, ~ gains first strike until end of turn." (Bull-Rush Bruiser)', () => {
  const BRUISER = card('Test Bruiser', 'Creature — Human Warrior', 'Whenever this creature attacks, if your team controls another Warrior, this creature gains first strike until end of turn.', { pt: ['2', '2'] });
  const WARRIOR = card('Test Warrior', 'Creature — Human Warrior', '', { pt: ['1', '1'] });
  const attack = (battlefield: string[]): { s: GameState; id: ObjectId } => {
    const s0 = scenario([], { defs: [BRUISER, WARRIOR, BIG], p1: { battlefield } });
    const id = find(s0, 'Test Bruiser', 'battlefield', 'p1');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[id, 'p2']]), (x) => x.zones.stack.length > 0 || x.turn.step === 'declareBlockers', 'trigger');
    return { s: resolveAll(s), id };
  };
  it('is automated', () => expect(full(BRUISER)).toBe(true));
  it('with another Warrior it has first strike', () => {
    const { s, id } = attack(['Test Bruiser', 'Test Warrior']);
    expect(hasKeyword(getChars(s, id)!, 'first strike')).toBe(true);
  });
  it('negative: alone (the Bruiser is not "another" Warrior), or with a non-Warrior, no first strike', () => {
    for (const bf of [['Test Bruiser'], ['Test Bruiser', 'Test Big']]) {
      const { s, id } = attack(bf);
      expect(hasKeyword(getChars(s, id)!, 'first strike'), bf.join()).toBe(false);
    }
  });
});

describe('CR 701.9a, 608.2c: "Target player discards two cards, then draws as many cards as they discarded this way." (Forget)', () => {
  const FORGET = card('Test Forget', 'Sorcery', 'Target player discards two cards, then draws as many cards as they discarded this way.', { colors: ['U'] });
  const board = (cards: string[]): GameState => scenario([], { defs: [FORGET, BIG, SMALL, WALL], p1: { hand: ['Test Forget'] }, p2: { hand: cards } });
  it('is automated', () => expect(full(FORGET), JSON.stringify(FORGET.automation)).toBe(true));
  it('with three cards in hand the player discards two and draws two (three cards afterwards, two more in the graveyard)', () => {
    const s0 = board(['Test Big', 'Test Small', 'Test Wall']);
    const s = resolveAll(cast(s0, 'Test Forget', { targets: [player('p2')] }));
    expect(hand(s, 'p2')).toBe(3);
    expect((s.zones.graveyard['p2'] ?? []).length).toBe(2);
    expect(s.zones.library['p2']!.length).toBe(s0.zones.library['p2']!.length - 2);
  });
  it('negative: with one card in hand only that card is discarded, and only one card is drawn (the cards actually discarded, CR 608.2c)', () => {
    const s0 = board(['Test Big']);
    const s = resolveAll(cast(s0, 'Test Forget', { targets: [player('p2')] }));
    expect(inYard(s, 'Test Big', 'p2')).toBe(true);
    expect(hand(s, 'p2')).toBe(1);
    expect(s.zones.library['p2']!.length).toBe(s0.zones.library['p2']!.length - 1);
  });
  it('negative: with an empty hand nothing is discarded and nothing is drawn', () => {
    const s0 = board([]);
    const s = resolveAll(cast(s0, 'Test Forget', { targets: [player('p2')] }));
    expect(hand(s, 'p2')).toBe(0);
    expect(s.zones.library['p2']!.length).toBe(s0.zones.library['p2']!.length);
  });
});

describe('CR 603.2, 120.3: "Whenever a Swamp, Mountain, black permanent, or red permanent becomes tapped, ~ deals 1 damage to that permanent\'s controller." (Royal Decree)', () => {
  const DECREE = card('Test Decree', 'Enchantment', "Whenever a Swamp, Mountain, black permanent, or red permanent becomes tapped, this enchantment deals 1 damage to that permanent's controller.");
  const TAP = card('Test Tap', 'Sorcery', 'Tap target permanent.', { colors: ['U'] });
  const SWAMP = card('Test Swamp', 'Land — Swamp', '');
  const FOREST = card('Test Forest', 'Land — Forest', '');
  const BLACK = card('Test Black Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['B'] });
  const RED = card('Test Red Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['R'] });
  const GREEN = card('Test Green Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
  const BOTH = card('Test Marsh Bear', 'Creature — Swamp Bear', '', { pt: ['2', '2'], colors: ['B'] });
  const DEFS = [DECREE, TAP, SWAMP, FOREST, BLACK, RED, GREEN, BOTH];
  const tapped = (name: string): { s0: GameState; s: GameState } => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Tap'], battlefield: ['Test Decree'] }, p2: { battlefield: [name] } });
    return { s0, s: resolveAll(cast(s0, 'Test Tap', { targets: [obj(find(s0, name, 'battlefield', 'p2'))] })) };
  };
  it('is automated', () => expect(full(DECREE), JSON.stringify(DECREE.automation)).toBe(true));
  it('each of the four descriptions deals 1 damage to the controller of the permanent that became tapped (not to the Decree\'s controller)', () => {
    for (const name of ['Test Swamp', 'Test Black Bear', 'Test Red Bear']) {
      const { s0, s } = tapped(name);
      expect(life(s, 'p2'), name).toBe(life(s0, 'p2') - 1);
      expect(life(s, 'p1'), name).toBe(life(s0, 'p1'));
    }
  });
  it('negative: a Forest or a green creature becoming tapped deals no damage', () => {
    for (const name of ['Test Forest', 'Test Green Bear']) {
      const { s0, s } = tapped(name);
      expect(life(s, 'p2'), name).toBe(life(s0, 'p2'));
    }
  });
  it('a permanent that fits two descriptions (a black Swamp) is one tap and one trigger: 1 damage, not 2 (CR 603.2)', () => {
    const { s0, s } = tapped('Test Marsh Bear');
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 1);
  });
});

describe('CR 120.1, 120.3, 109.5: "Whenever a noncreature source you control deals damage, you gain that much life." (Tamanoa)', () => {
  const TAMANOA = card('Test Tamanoa', 'Creature — Spirit', 'Whenever a noncreature source you control deals damage, you gain that much life.', { pt: ['2', '2'], colors: ['W'] });
  const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.', { colors: ['R'] });
  const PINGER = card('Test Pinger', 'Artifact', '{T}: This artifact deals 1 damage to any target.');
  const FIGHTER = card('Test Fighter', 'Creature — Goblin', '{T}: This creature deals 1 damage to any target.', { pt: ['1', '1'] });
  const DEFS = [TAMANOA, SHOCK, PINGER, FIGHTER];
  it('is automated', () => expect(full(TAMANOA), JSON.stringify(TAMANOA.automation)).toBe(true));
  it('a noncreature spell you control deals 2 damage: you gain 2 life', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Shock'], battlefield: ['Test Tamanoa'] } });
    const s = resolveAll(cast(s0, 'Test Shock', { targets: [player('p2')] }));
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 2);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 2);
  });
  it('a noncreature permanent\'s ability deals 1 damage: you gain 1 life', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tamanoa', 'Test Pinger'] } });
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Pinger', 'battlefield', 'p1'), ability: 'p:0:0' } as never), { targets: [player('p2')] }));
    expect(life(s, 'p1')).toBe(life(s0, 'p1') + 1);
  });
  it('negative: damage dealt by a creature (its own ability) gains nothing', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tamanoa', 'Test Fighter'] } });
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Fighter', 'battlefield', 'p1'), ability: 'p:0:0' } as never), { targets: [player('p2')] }));
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 1);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
  });
  it('negative: damage dealt by a noncreature source an opponent controls gains nothing', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tamanoa'] }, p2: { battlefield: ['Test Pinger'] } });
    const s1 = pass(s0); // priority passes to p2, who may activate during p1's main phase
    const s = resolveAll(settle(act(s1, { type: 'activate', player: 'p2', source: find(s1, 'Test Pinger', 'battlefield', 'p2'), ability: 'p:0:0' } as never), { targets: [player('p1')] }));
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 1);
  });
});

describe('CR 509.3c, 508.1b: "Whenever ~ becomes blocked, it deals 1 damage to the player or planeswalker it\'s attacking." (Rakdos Roustabout)', () => {
  const ROUSTABOUT = card('Test Roustabout', 'Creature — Human Rogue', "Whenever this creature becomes blocked, it deals 1 damage to the player or planeswalker it's attacking.", { pt: ['0', '4'] });
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Test', '+1: You gain 1 life.', { loyalty: '5' });
  const DEFS = [ROUSTABOUT, WALL, WALKER];
  const block = (defender: 'p2' | 'walker', blocked: boolean): { s0: GameState; s: GameState; walker: ObjectId | undefined } => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Roustabout'] }, p2: { battlefield: ['Test Wall', { name: 'Test Walker', counters: { loyalty: 5 } }] } });
    const walker = find(s0, 'Test Walker', 'battlefield', 'p2');
    const rb = find(s0, 'Test Roustabout', 'battlefield', 'p1');
    let s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[rb, defender === 'p2' ? 'p2' : walker]]));
    if (blocked) s = declareBlockers(s, [[find(s, 'Test Wall', 'battlefield', 'p2'), rb]]);
    else s = answer(s, { kind: 'declareBlockers', blocks: [] } as DecisionAnswer);
    return { s0, s: resolveAll(passUntil(s, (x) => x.zones.stack.length > 0 || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'trigger')), walker };
  };
  it('is automated', () => expect(full(ROUSTABOUT), JSON.stringify(ROUSTABOUT.automation)).toBe(true));
  it('blocked while attacking a player: that player takes 1', () => {
    const { s0, s } = block('p2', true);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 1);
  });
  it('blocked while attacking a planeswalker: the planeswalker takes 1 (loyalty 5 to 4), the player nothing', () => {
    const { s0, s, walker } = block('walker', true);
    expect(s.objects[walker!]!.counters['loyalty']).toBe(4);
    expect(life(s, 'p2')).toBe(life(s0, 'p2'));
  });
  it('becoming blocked by an effect (no blocker declared) deals the damage too: the defender is read from the combat state however it became blocked (CR 509.1h, 509.3c)', () => {
    const RUNNER = card('Test Runner', 'Artifact', '{T}: Target unblocked attacking creature becomes blocked. Activate only during combat after blockers are declared.');
    const s0 = scenario([], { defs: [ROUSTABOUT, RUNNER], p1: { battlefield: ['Test Roustabout'] }, p2: { battlefield: ['Test Runner'] } });
    const rb = find(s0, 'Test Roustabout', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[rb, 'p2']]);
    for (let i = 0; i < 20 && !(s.turn.step === 'declareBlockers' && s.pending?.kind === 'priority'); i++) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] } as DecisionAnswer) : pass(s);
    for (let i = 0; i < 5 && !(s.pending?.kind === 'priority' && (s.pending as { player?: string }).player === 'p2'); i++) s = pass(s);
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p2', source: find(s, 'Test Runner', 'battlefield', 'p2'), ability: 'p:0:0' } as never), { targets: [obj(rb)] }));
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 1);
  });
  it('negative: not blocked, no damage from the trigger (it has 0 power)', () => {
    const { s0, s } = block('p2', false);
    expect(life(s, 'p2')).toBe(life(s0, 'p2'));
  });
});

describe('CR 502.3, 611.2b: "That creature doesn\'t untap during its controller\'s untap step for as long as ~ remains on the battlefield." (Somnophore)', () => {
  const SOMNO = card('Test Somnophore', 'Creature — Spirit', "{T}: Tap target creature. That creature doesn't untap during its controller's untap step for as long as this creature remains on the battlefield.", { pt: ['1', '1'] });
  const board = (): GameState => scenario([], { defs: [SOMNO, WALL], p1: { battlefield: ['Test Somnophore'] }, p2: { battlefield: ['Test Wall'] } });
  const lock = (): GameState => {
    const s0 = board();
    return resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Somnophore', 'battlefield', 'p1'), ability: 'p:0:0' } as never), { targets: [obj(find(s0, 'Test Wall', 'battlefield', 'p2'))] }));
  };
  it('is automated', () => expect(full(SOMNO), JSON.stringify(SOMNO.automation)).toBe(true));
  it('the tapped creature stays tapped through its controller\'s untap step while the Somnophore remains', () => {
    let s = lock();
    expect(s.objects[find(s, 'Test Wall', 'battlefield', 'p2')]!.tapped).toBe(true);
    s = nextTurn(s, 2);
    expect(s.objects[find(s, 'Test Wall', 'battlefield', 'p2')]!.tapped).toBe(true);
  });
  it('negative: once the Somnophore has left the battlefield the creature untaps normally', () => {
    let s = lock();
    const id = find(s, 'Test Somnophore', 'battlefield', 'p1');
    s = { ...s, objects: { ...s.objects, [id]: { ...s.objects[id]!, zone: 'graveyard' } }, zones: { ...s.zones, battlefield: s.zones.battlefield.filter((x) => x !== id) } } as GameState;
    s = nextTurn(s, 2);
    expect(s.objects[find(s, 'Test Wall', 'battlefield', 'p2')]!.tapped).toBe(false);
  });
  it('negative: an untapped creature the effect never touched is unaffected (the lock is on the target only)', () => {
    const s0 = scenario([], { defs: [SOMNO, WALL, WALLB], p1: { battlefield: ['Test Somnophore'] }, p2: { battlefield: [{ name: 'Test Wall', tapped: true }, { name: 'Test Wall Twin', tapped: true }] } });
    let s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Somnophore', 'battlefield', 'p1'), ability: 'p:0:0' } as never), { targets: [obj(find(s0, 'Test Wall', 'battlefield', 'p2'))] }));
    s = nextTurn(s, 2);
    expect(s.objects[find(s, 'Test Wall', 'battlefield', 'p2')]!.tapped).toBe(true);
    expect(s.objects[find(s, 'Test Wall Twin', 'battlefield', 'p2')]!.tapped).toBe(false);
  });
});

describe('CR 303.4f, 303.4g: "Put target Aura card from a graveyard onto the battlefield under your control attached to ~." (Iridescent Drake)', () => {
  const DRAKE = card('Test Drake', 'Creature — Drake', 'Flying\nWhen this creature enters, put target Aura card from a graveyard onto the battlefield under your control attached to this creature.', { pt: ['2', '2'], cost: '{0}' });
  const BOON = card('Test Boon', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.', { colors: ['W'] });
  const MIRE = card('Test Mire', 'Enchantment — Aura', 'Enchant land\nEnchanted land has "{T}: Add {B}."', { colors: ['B'] });
  const board = (aura: string): GameState => scenario([], { defs: [DRAKE, BOON, MIRE], p1: { hand: ['Test Drake'] }, p2: { graveyard: [aura] } });
  it('is automated', () => expect(full(DRAKE), JSON.stringify(DRAKE.automation)).toBe(true));
  it('an Aura in an opponent\'s graveyard comes onto the battlefield under your control attached to the Drake (3/3 with +1/+1)', () => {
    const s0 = board('Test Boon');
    const boon = find(s0, 'Test Boon', 'graveyard', 'p2');
    const s = resolveAll(cast(s0, 'Test Drake'), { targets: [obj(boon)] });
    const drake = find(s, 'Test Drake', 'battlefield', 'p1');
    const onBf = find(s, 'Test Boon', 'battlefield', 'p2'); // a new object (CR 400.7), owned by Bob, under your control
    expect(s.objects[onBf]!.controller).toBe('p1');
    expect(s.objects[onBf]!.attachedTo).toBe(drake);
    expect(pt(s, drake)).toBe('3/3');
  });
  it('negative: an Aura that enchants a player (a Curse) cannot be attached to the Drake and stays in the graveyard; nothing is left to a manual step (CR 303.4g)', () => {
    const CURSE = card('Test Curse', 'Enchantment — Aura Curse', 'Enchant player\nAt the beginning of enchanted player\'s upkeep, that player loses 1 life.', { colors: ['B'] });
    const s0 = scenario([], { defs: [DRAKE, CURSE], p1: { hand: ['Test Drake'] }, p2: { graveyard: ['Test Curse'] } });
    const curse = find(s0, 'Test Curse', 'graveyard', 'p2');
    const s = resolveAll(cast(s0, 'Test Drake'), { targets: [obj(curse)] });
    expect(s.objects[curse]!.zone).toBe('graveyard');
  });
  it('negative: an Aura that cannot enchant a creature (Enchant land) stays in the graveyard (CR 303.4g)', () => {
    const s0 = board('Test Mire');
    const mire = find(s0, 'Test Mire', 'graveyard', 'p2');
    const s = resolveAll(cast(s0, 'Test Drake'), { targets: [obj(mire)] });
    expect(s.objects[mire]!.zone).toBe('graveyard');
  });
});
