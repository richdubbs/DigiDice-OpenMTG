/**
 * Commander lane edh-misc, round edh-misc-2: the round's engine and parser concepts played through the engine with synthetic cards (invented names and wordings,
 * design 6.10), compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 106.12, 614.1a, 608.2h   "If you tap a permanent for mana, it produces twice as much of that mana instead.": a nonland permanent of yours tapped for mana adds twice
 *                               the mana; a permanent sacrificed as part of the cost of a {T} mana ability (a Treasure) is still a permanent tapped for mana, its factor
 *                               read before the cost was paid; an opponent's permanent, and a mana ability without {T} ("Sacrifice this artifact: Add ...") are unaffected
 *   CR 111.7, 400.7, 701.21a    "Whenever an opponent sacrifices a nontoken permanent, put that card onto the battlefield under your control.": the card the sacrifice put into
 *                               its owner's graveyard comes back under the trigger's controller; a token, or a permanent you sacrificed yourself, does nothing
 *   CR 903.6, 408.1, 400.7      "When ~ enters, you may put a commander you own from the command zone onto the battlefield. It gains haste. Return it to the command zone at the
 *                               beginning of the next end step.": only your own commander, optional, with haste, and it goes back at the end step (not if it left)
 *   CR 608.2c, 118.12a          "Repeat the following process X times. Each opponent loses 2 life unless that player sacrifices a creature of their choice or discards a card.": the
 *                               whole sentence runs X times, the opponent deciding each time; X = 0 does nothing
 *   CR 113.6, 903.6             "{2}{G}: Put ~ onto the battlefield from the command zone.": an ability of a commander that functions in the command zone only: its owner may
 *                               activate it there (no cast, no commander tax), it is not offered on the battlefield, and an opponent can't use it
 *   CR 608.2c, 608.2d, 400.7    "Whenever one or more artifact cards are put into your graveyard from your library, put one of them onto the battlefield.": you choose one of
 *                               the cards the event put there (not another card already in the graveyard) and it enters the battlefield
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, put, scenario } from '../../m3/scenario';
import { card as mcard, commanderScenario, legend } from '../../m11/rules/helpers';
import { passUntil } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
/** Activate the (one) mana ability `source` has now, for `player`. */
function tapForMana(s: GameState, source: ObjectId, player: 'p1' | 'p2' = 'p1'): GameState {
  const a = legalActions(s, player).find((x) => x.kind === 'activate' && x.isMana === true && x.object === source);
  if (!a) throw new Error(`no mana ability of ${source}`);
  return act(s, a.action);
}
function card2(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return card(name, type, text, pt);
}
/** Answer every decision: yes/no by `yes`, objects by `pick`, mana automatically. */
function drive(s0: GameState, o: { pick?: (options: ObjectId[], s: GameState) => ObjectId[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
const poolOf = (s: GameState, p = 0): string => s.players[p]!.manaPool.map((u) => u.type).join('');

describe('CR 106.12, 614.1a, 608.2h: "If you tap a permanent for mana, it produces twice as much of that mana instead" (rule tapManaMultiplier on any permanent)', () => {
  const MIRROR = card('Test Echo Mirror', 'Enchantment', 'If you tap a permanent for mana, it produces twice as much of that mana instead.');
  const DOUBLER = card('Test Triple Mirror', 'Enchantment', 'If you tap a permanent for mana, it produces three times as much of that mana instead.');
  const ROCK = card('Test Green Stone', 'Artifact', '{T}: Add {G}.');
  const COIN = card('Test Gold Coin', 'Artifact', '{T}, Sacrifice this artifact: Add {R}.');
  const SPENT = card('Test Spent Gem', 'Artifact', 'Sacrifice this artifact: Add {U}.');
  const ELF = card('Test Leaf Elf', 'Creature — Elf', '{T}: Add {G}.', ['1', '1']);
  const FIELD = card('Test Plain Field', 'Land', '{T}: Add {G}.');
  const DEFS = [MIRROR, DOUBLER, ROCK, COIN, SPENT, ELF, FIELD];
  it('is parsed and automated (the multiplier of any permanent, no capability left over)', () => {
    expect(automated(MIRROR)).toBe(true);
    expect(automated(DOUBLER)).toBe(true);
    const rule = (MIRROR.faces[0]!.abilities[0] as { effects: { rule: string; of?: unknown; value: number }[] }).effects[0]!;
    expect(rule.rule).toBe('tapManaMultiplier');
    expect(rule.value).toBe(2);
  });
  it('a nonland artifact, a creature and a land of yours each add two mana for one', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo Mirror', 'Test Green Stone', 'Test Leaf Elf', 'Test Plain Field'] }, defs: DEFS });
    expect(poolOf(tapForMana(s0, find(s0, 'Test Green Stone', 'battlefield', 'p1')))).toBe('GG');
    expect(poolOf(tapForMana(s0, find(s0, 'Test Leaf Elf', 'battlefield', 'p1')))).toBe('GG');
    expect(poolOf(tapForMana(s0, find(s0, 'Test Plain Field', 'battlefield', 'p1')))).toBe('GG');
  });
  it('without the enchantment the same permanent adds one mana', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Green Stone'] }, defs: DEFS });
    expect(poolOf(tapForMana(s0, find(s0, 'Test Green Stone', 'battlefield', 'p1')))).toBe('G');
  });
  it('a permanent sacrificed as part of the cost of its {T} mana ability is still tapped for mana: two mana, and it is in the graveyard (the factor is read before the cost)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo Mirror', 'Test Gold Coin'] }, defs: DEFS });
    const s = tapForMana(s0, find(s0, 'Test Gold Coin', 'battlefield', 'p1'));
    expect(poolOf(s)).toBe('RR');
    expect(() => find(s, 'Test Gold Coin', 'battlefield', 'p1')).toThrow();
    expect(find(s, 'Test Gold Coin', 'graveyard', 'p1')).toBeDefined();
  });
  it('negative: a mana ability without {T} in its cost does not tap the permanent: one mana', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo Mirror', 'Test Spent Gem'] }, defs: DEFS });
    expect(poolOf(tapForMana(s0, find(s0, 'Test Spent Gem', 'battlefield', 'p1')))).toBe('U');
  });
  it('negative: an opponent\'s permanent adds one mana (the effect says "you tap")', () => {
    let s = scenario([], { p1: { battlefield: ['Test Echo Mirror'] }, p2: { battlefield: ['Test Green Stone'] }, defs: DEFS });
    s = pass(s); // p2 gets priority in p1's main phase
    expect(poolOf(tapForMana(s, find(s, 'Test Green Stone', 'battlefield', 'p2'), 'p2'), 1)).toBe('G');
  });
  it('two of them multiply: a sacrificed coin makes six mana with a doubler and a tripler', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo Mirror', 'Test Triple Mirror', 'Test Gold Coin'] }, defs: DEFS });
    expect(poolOf(tapForMana(s0, find(s0, 'Test Gold Coin', 'battlefield', 'p1')))).toBe('RRRRRR');
  });
});

describe('CR 111.7, 400.7, 701.21a: "Whenever an opponent sacrifices a nontoken permanent, put that card onto the battlefield under your control"', () => {
  const BETRAYER = card2('Test Betrayer', 'Creature — Eldrazi', 'Whenever an opponent sacrifices a nontoken permanent, put that card onto the battlefield under your control.', ['3', '3']);
  const DEMAND = card2('Test Demand', 'Sorcery', 'Each opponent sacrifices a creature.');
  const SELFISH = card2('Test Selfish', 'Sorcery', 'Sacrifice a creature.');
  const SPIRITS = card2('Test Spirit Gift', 'Sorcery', 'Each opponent creates a 1/1 white Spirit creature token.');
  const BEAR = card2('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [BETRAYER, DEMAND, SELFISH, SPIRITS, BEAR];
  const names = (s: GameState, owner: 'p1' | 'p2'): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === owner).map((id) => getChars(s, id).name);
  it('is parsed and automated', () => expect(automated(BETRAYER)).toBe(true));
  it('the opponent sacrifices their only creature, a card: it comes back under the Betrayer\'s controller', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Demand'], battlefield: ['Test Betrayer'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Demand');
    expect(names(s, 'p1')).toContain('Test Bear');
    expect(names(s, 'p2')).not.toContain('Test Bear');
  });
  it('negative: a token the opponent sacrifices is not a card and nothing returns', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Spirit Gift', 'Test Demand'], battlefield: ['Test Betrayer'] } });
    s = cast(s, 'Test Spirit Gift');
    expect(names(s, 'p2')).toEqual(['Spirit Token']);
    s = cast(s, 'Test Demand');
    expect(names(s, 'p2')).toEqual([]);
    expect(names(s, 'p1')).toEqual(['Test Betrayer']);
  });
  it('negative: a permanent its controller sacrifices (not an opponent of the Betrayer\'s controller) does not trigger it', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Selfish'], battlefield: ['Test Betrayer', 'Test Bear'] } });
    s = cast(s, 'Test Selfish', { pick: (o, st) => [o.find((id) => getChars(st, id).name === 'Test Bear')!] });
    expect(names(s, 'p1')).toEqual(['Test Betrayer']);
    expect(s.zones.graveyard.p1!.map((id) => getChars(s, id).name)).toContain('Test Bear');
  });
});

describe('CR 608.2c, 608.2d, 400.7: "Whenever one or more artifact cards are put into your graveyard from your library, put one of them onto the battlefield"', () => {
  const REAPER = card2('Test Grave Warden', 'Creature — Horror', 'Whenever one or more artifact cards are put into your graveyard from your library, put one of them onto the battlefield.', ['2', '2']);
  const DIG = card2('Test Dig', 'Sorcery', 'Mill three cards.');
  const RING = card2('Test Ring', 'Artifact', '');
  const GEM = card2('Test Gem', 'Artifact', '');
  const ROCK = card2('Test Rock', 'Instant', '');
  const OLD = card2('Test Old Relic', 'Artifact', '');
  const DEFS = [REAPER, DIG, RING, GEM, ROCK, OLD];
  const setup = (library: string[], graveyard: string[] = []): GameState => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Dig'], battlefield: ['Test Grave Warden'], graveyard } });
    s.zones.library.p1 = [];
    for (const n of library) put(s, 'p1', 'library', n); // the first is the top card
    return s;
  };
  it('is parsed and automated', () => expect(automated(REAPER)).toBe(true));
  it('you choose one of the artifact cards milled and it enters; the other milled artifact and the nonartifact stay in the graveyard', () => {
    let s = setup(['Test Ring', 'Test Gem', 'Test Rock', 'Test Rock']);
    let offered: string[] = [];
    s = cast(s, 'Test Dig', { pick: (o, st) => { offered = o.map((id) => getChars(st, id).name).sort(); return [o.find((id) => getChars(st, id).name === 'Test Gem')!]; } });
    expect(offered).toEqual(['Test Gem', 'Test Ring']);
    expect(s.zones.battlefield.map((id) => getChars(s, id).name).sort()).toEqual(['Test Gem', 'Test Grave Warden']);
    expect(s.zones.graveyard.p1!.map((id) => getChars(s, id).name).sort()).toEqual(['Test Dig', 'Test Ring', 'Test Rock']);
  });
  it('negative: an artifact card already in the graveyard is not one of "them"', () => {
    let s = setup(['Test Ring', 'Test Rock', 'Test Rock', 'Test Rock'], ['Test Old Relic']);
    s = cast(s, 'Test Dig', { pick: (o, st) => { expect(o.map((id) => getChars(st, id).name)).toEqual(['Test Ring']); return [o[0]!]; } }); // one choice: the milled artifact only (a lone option may be taken without asking)
    expect(s.zones.battlefield.map((id) => getChars(s, id).name)).toContain('Test Ring');
    expect(s.zones.graveyard.p1!.map((id) => getChars(s, id).name)).toContain('Test Old Relic');
  });
  it('negative: milling no artifact card does not trigger it', () => {
    let s = setup(['Test Rock', 'Test Rock', 'Test Rock', 'Test Ring']);
    s = cast(s, 'Test Dig');
    expect(s.zones.battlefield.map((id) => getChars(s, id).name)).toEqual(['Test Grave Warden']);
  });
});

describe('CR 903.6, 408.1, 400.7: "you may put a commander you own from the command zone onto the battlefield. It gains haste. Return it to the command zone at the beginning of the next end step"', () => {
  const COURSER = mcard('Test Dragon Courser', '{0}', 'Creature — Dragon', 'Flying\nWhen this creature enters, you may put a commander you own from the command zone onto the battlefield. It gains haste. Return it to the command zone at the beginning of the next end step.', ['4', '4']);
  const BOSS = legend('Test Alice Boss', '{G}', ['2', '2'], ['G']);
  const FOE = legend('Test Bob Boss', '{G}', ['3', '3'], ['G']);
  const KILL = mcard('Test Smite', '{0}', 'Instant', 'Destroy target creature.');
  const game = (): GameState => commanderScenario({ p1Commanders: [BOSS], p2Commanders: [FOE], defs: [COURSER, KILL], p1: { hand: ['Test Dragon Courser', 'Test Smite'] } });
  const nameOf = (st: GameState, id: ObjectId): string => getChars(st, id).name;
  const answerPending = (s0: GameState, pick: (options: ObjectId[], st: GameState) => ObjectId[]): GameState => {
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending; guard++) {
      const p = s.pending;
      if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick(p.options, s) });
      else if (p.kind === 'commanderZone') s = answer(s, { kind: 'commanderZone', command: false }); // CR 903.9a: it stays in the graveyard
      else if (p.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
      else break;
    }
    return s;
  };
  /** Pass priority to the end step, declaring no attackers. */
  const toEnd = (s0: GameState): GameState => {
    let s = s0;
    for (let guard = 0; guard < 60 && s.turn.step !== 'end'; guard++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else s = passUntil(s, (x) => x.turn.step === 'end' || x.pending?.kind !== 'priority', 'the end step');
    }
    for (let guard = 0; guard < 20 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; guard++) s = pass(s); // the delayed trigger of the end step resolves
    return s;
  };
  const castCourser = (s0: GameState, pick: (options: ObjectId[], st: GameState) => ObjectId[]): GameState => answerPending(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Dragon Courser', 'hand', 'p1') }), pick);
  it('is parsed and automated', () => expect(automated(COURSER)).toBe(true));
  it('your commander comes onto the battlefield with haste, and goes back to the command zone at the beginning of the next end step', () => {
    let s = castCourser(game(), (o) => [o[0]!]);
    const boss = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Alice Boss')!;
    expect(boss).toBeDefined();
    expect(getChars(s, boss).keywords.some((k) => k.keyword === 'haste')).toBe(true);
    expect(s.zones.command.map((id) => nameOf(s, id))).not.toContain('Test Alice Boss');
    s = toEnd(s);
    expect(s.zones.command.map((id) => nameOf(s, id))).toContain('Test Alice Boss');
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Alice Boss')).toBe(false);
  });
  it('negative: you may decline (nothing is chosen), and an opponent\'s commander is never offered', () => {
    let offered: string[] = [];
    const s = castCourser(game(), (o, st) => { offered = o.map((id) => nameOf(st, id)); return []; });
    expect(offered).toEqual(['Test Alice Boss']);
    expect(s.zones.command.map((id) => nameOf(s, id)).sort()).toEqual(['Test Alice Boss', 'Test Bob Boss']);
  });
  it('negative: a commander destroyed before the end step is not pulled out of wherever it went (a new object, CR 400.7)', () => {
    let s = castCourser(game(), (o) => [o[0]!]);
    const boss = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Alice Boss')!;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') });
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: boss }] });
    s = answerPending(s, (o) => [o[0]!]);
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id))).toContain('Test Alice Boss');
    s = toEnd(s);
    // the destroyed commander (a new object in the graveyard) is left where it is: the delayed trigger names the permanent that was, not the card (CR 400.7)
    expect(s.zones.graveyard.p1!.map((id) => nameOf(s, id))).toContain('Test Alice Boss');
    expect(s.zones.command.map((id) => nameOf(s, id))).not.toContain('Test Alice Boss');
  });
});

describe('CR 608.2c, 118.12a: "Repeat the following process X times. Each opponent loses 2 life unless that player sacrifices a creature of their choice or discards a card"', () => {
  const STORM = card('Test Hail Storm', 'Sorcery', 'Repeat the following process X times. Each opponent loses 2 life unless that player sacrifices a creature of their choice or discards a card.', undefined, '{X}');
  const BEAR = card2('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [STORM, BEAR];
  const life = (s: GameState, i: number): number => s.players[i]!.life;
  const play = (x: number, p2: { hand?: string[]; battlefield?: string[] }, yes = true): GameState => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Hail Storm'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2 });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hail Storm', 'hand', 'p1') });
    for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, Math.max(d.min, 1)).slice(0, d.max) });
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  };
  it('is parsed and automated', () => expect(automated(STORM)).toBe(true));
  it('X = 3: the opponent sacrifices their creature the first time, discards their card the second, and loses 2 life the third', () => {
    const s = play(3, { hand: ['Plains'], battlefield: ['Test Bear'] });
    expect(life(s, 1)).toBe(20 - 2);
    expect(s.zones.battlefield.some((id) => getChars(s, id).name === 'Test Bear')).toBe(false);
    expect(s.zones.hand.p2).toHaveLength(0);
  });
  it('X = 2: the opponent pays both times and loses no life', () => {
    const s = play(2, { hand: ['Plains'], battlefield: ['Test Bear'] });
    expect(life(s, 1)).toBe(20);
  });
  it('negative: X = 0 does nothing, and an opponent who declines every time loses 2 life each time', () => {
    expect(life(play(0, { hand: ['Plains'], battlefield: ['Test Bear'] }), 1)).toBe(20);
    const s = play(2, { hand: ['Plains'], battlefield: ['Test Bear'] }, false);
    expect(life(s, 1)).toBe(20 - 4);
    expect(s.zones.battlefield.some((id) => getChars(s, id).name === 'Test Bear')).toBe(true);
  });
});

describe('CR 113.6, 903.6: "{2}{G}: Put ~ onto the battlefield from the command zone" (an ability that functions in the command zone)', () => {
  const HERALD = legend('Test Command Herald', '{3}{G}', ['3', '3'], ['G'], '{2}{G}: Put ~ onto the battlefield from the command zone.');
  const FOE = legend('Test Foe Boss', '{G}', ['3', '3'], ['G']);
  const game = (): GameState => commanderScenario({ p1Commanders: [HERALD], p2Commanders: [FOE], p1: { battlefield: ['Forest', 'Forest', 'Forest'] } });
  const activations = (s: GameState, player: 'p1' | 'p2'): number => legalActions(s, player).filter((a) => a.kind === 'activate' && !a.isMana && getChars(s, a.object!).name === 'Test Command Herald').length;
  it('is parsed and automated, the ability functioning in the command zone only', () => {
    expect(automated(HERALD)).toBe(true);
    expect(JSON.stringify(HERALD.faces[0]!.abilities.find((a) => a.kind === 'activated'))).toContain('"zone":["command"]');
  });
  it('its owner activates it from the command zone, pays {2}{G} and the commander enters the battlefield (no commander tax: it is not cast)', () => {
    let s = game();
    expect(activations(s, 'p1')).toBe(1);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && !x.isMana && getChars(s, x.object!).name === 'Test Command Herald')!;
    s = act(s, a.action);
    for (let guard = 0; guard < 20 && s.pending && (s.pending.kind === 'payCost' || (s.pending.kind === 'priority' && s.zones.stack.length > 0)); guard++) {
      s = s.pending.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : pass(s);
    }
    expect(s.zones.battlefield.some((id) => getChars(s, id).name === 'Test Command Herald')).toBe(true);
    expect(s.zones.command.map((id) => getChars(s, id).name)).not.toContain('Test Command Herald');
    expect(activations(s, 'p1')).toBe(0); // on the battlefield the ability does not function
  });
  it('negative: the other player, whose commander is not Test Command Herald, is offered nothing', () => {
    let s = game();
    s = pass(s); // Bob gets priority in Alice's main phase
    expect(activations(s, 'p2')).toBe(0);
  });
});

describe('CR 113.6, 614.1a, 601.2h: a doubler sacrificed as part of the cost no longer doubles; a process of two sentences is not read', () => {
  const TOWER = card2('Test Pit Tower', 'Land', '{T}, Sacrifice a creature: Add {B}{B}.');
  const TRIPLER = card2('Test Triple Heart', 'Creature — Treefolk', 'If you tap a permanent for mana, it produces three times as much of that mana instead.', ['2', '2']);
  const BEAR = card2('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS = [TOWER, TRIPLER, BEAR];
  const run = (victim: string): string => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pit Tower', 'Test Triple Heart', 'Test Bear'] } });
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && x.isMana === true && x.object === find(s0, 'Test Pit Tower', 'battlefield', 'p1'))!;
    let s = act(s0, a.action);
    for (let g = 0; g < 10 && s.pending && s.pending.kind !== 'priority'; g++) {
      const d = s.pending;
      s = d.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: [d.options.find((id) => getChars(s, id).name === victim)!] }) : answer(s, { kind: 'payCost', auto: true });
    }
    return poolOf(s);
  };
  it('sacrificing another creature: the tripler is still there, six mana', () => expect(run('Test Bear')).toBe('BBBBBB'));
  it('negative: sacrificing the tripler itself: it is gone when the mana is made, two mana', () => expect(run('Test Triple Heart')).toBe('BB'));
  it('negative: a process of two sentences stays manual', () => {
    const c = card('Test Two Step', 'Sorcery', 'Repeat the following process three times. You gain 1 life. Draw a card.', undefined, '{X}');
    expect(automated(c)).toBe(false);
  });
});
