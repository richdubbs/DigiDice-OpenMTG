/**
 * Commander lane instead, third pass (coordinator D), round edh-d-57: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by
 * the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites are from the real text where the round could check them, else from memory
 * and unverified (the record says which).
 *
 *   CR 614.1a, 614.6, 104.3     "The next time you would lose the game this turn, instead draw cards and your life total becomes N." (Stunning Reversal)
 *   CR 614.1a, 616.1, 707.2     "The first time you would create one or more tokens during each of your turns, you may instead choose a creature other than ~ and create that many copies." (Esix)
 *   CR 614.9, 609.7a, 615.7     "The next time a source of your choice would deal damage to target creature this turn, that source deals that damage to you instead." (Jade Monolith)
 *   CR 614.15, 608.2c           "Exile target creature if it has mana value 3 or less. Exile that creature instead if its controller has three or more poison counters." (Anoint with Affliction)
 *   CR 614.1a, 120.3, 611.3a    "As long as C, if a source you control would deal noncombat damage to an opponent or ..., it deals that much damage plus 2 instead." (Aether Revolt)
 *   CR 614.1a, 121.1, 611.3a    "As long as ~ has six or more quest counters, if you would draw a card, you may instead search your library for a card ..." (Archmage Ascension)
 *   CR 614.1a, 120.3, 701.17a   "If a Zombie you control would deal combat damage to a player, instead that player mills that many cards." (Undead Alchemist)
 *   CR 614.1a, 611.2a, 120.3    "If any source you control would deal damage to a permanent or player this turn, it deals double that damage ... instead." (Quest for Pure Flame)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

/** Answer the decisions that come up until priority (payments automatic; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: ObjectId[]; yes?: boolean; players?: PlayerId[]; pick?: ObjectId[] } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  const players = [...(o.players ?? [])];
  const pick = [...(o.pick ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      const d = p as unknown as { players: PlayerId[]; objects: ObjectId[]; min: number };
      const pl = players.find((x) => d.players.includes(x));
      const ob = targets.find((x) => d.objects.includes(x));
      if (pl !== undefined) { players.splice(players.indexOf(pl), 1); s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: pl }] }); }
      else if (ob !== undefined) { targets.splice(targets.indexOf(ob), 1); s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: ob }] }); }
      else s = answer(s, { kind: 'chooseTargets', targets: d.min === 0 ? [] : d.players.length > 0 ? [{ kind: 'player', id: d.players[0]! }] : [{ kind: 'object', id: d.objects[0]! }] });
    }
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') {
      const want = pick.filter((x) => p.options.includes(x));
      if (want.length > 0) { pick.splice(pick.indexOf(want[0]!), 1); s = answer(s, { kind: 'chooseObjects', ids: [want[0]!] }); }
      else s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    }
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const lib = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
const cast = (s: GameState, name: string, p: PlayerId = 'p1'): GameState => act(s, { type: 'cast', player: p, card: find(s, name, 'hand', p) });
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name);
const exiled = (s: GameState, name: string): number => s.zones.exile.filter((id) => chars(s, id).name === name).length;

const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const ISLAND = card('Test Island', 'Basic Land — Island', '{T}: Add {U}.');
const BURN = card('Test Burn', 'Instant', 'Test Burn deals 3 damage to target opponent.');
const DRAIN = card('Test Drain', 'Instant', 'Target player loses 5 life.');

// ---- Stunning Reversal ------------------------------------------------------------------------------------------------------------------------------------------------
const REVERSAL = card('Test Reversal', 'Instant', 'The next time you would lose the game this turn, instead draw four cards and your life total becomes 1.\nExile Test Reversal.');
describe('CR 614.1a, 614.6, 104.3: "The next time you would lose the game this turn, instead draw four cards and your life total becomes 1."', () => {
  const lose = (extra: number): GameState => {
    const s0 = scenario([], { defs: [REVERSAL, DRAIN, BEAR], life: 3, p1: { hand: ['Test Reversal', 'Test Drain'], library: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] }, p2: { library: ['Test Plain Bear'] } });
    let s = resolveAll(cast(s0, 'Test Reversal'));
    s = resolveAll(cast(s, 'Test Drain'), { players: ['p1'] });
    for (let i = 0; i < extra; i++) s = resolveAll(cast(s, 'Test Drain'), { players: ['p1'] });
    return s;
  };
  it('is fully automated', () => { expect(noManual(REVERSAL) && REVERSAL.automation.level === 'full').toBe(true); });
  it('the first loss is replaced: the game goes on, four cards are drawn and the life total becomes 1', () => {
    const s = lose(0);
    expect(s.result).toBeFalsy();
    expect(life(s, 'p1')).toBe(1);
    expect(hand(s, 'p1')).toBeGreaterThanOrEqual(4);
  });
  it('negative: it is one use; the next loss this turn ends the game', () => {
    const s0 = scenario([], { defs: [REVERSAL, DRAIN, BEAR], life: 3, p1: { hand: ['Test Reversal', 'Test Drain', 'Test Drain'], library: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] }, p2: { library: ['Test Plain Bear'] } });
    let s = resolveAll(cast(s0, 'Test Reversal'));
    s = resolveAll(cast(s, 'Test Drain'), { players: ['p1'] });
    s = resolveAll(cast(s, 'Test Drain'), { players: ['p1'] });
    expect(s.result).toBeTruthy();
  });
  it('negative: the opponent losing the game is not replaced', () => {
    const s0 = scenario([], { defs: [REVERSAL, DRAIN, BEAR], life: 3, p1: { hand: ['Test Reversal', 'Test Drain'] }, p2: { library: ['Test Plain Bear'] } });
    let s = resolveAll(cast(s0, 'Test Reversal'));
    s = resolveAll(cast(s, 'Test Drain'), { players: ['p2'] });
    expect(life(s, 'p2')).toBeLessThanOrEqual(0);
    expect(s.result).toBeTruthy();
  });
});

// ---- Esix ---------------------------------------------------------------------------------------------------------------------------------------------------------------
const ESIX = card('Test Esix', 'Creature — Shapeshifter', 'The first time you would create one or more tokens during each of your turns, you may instead choose a creature other than ~ and create that many tokens that are copies of that creature.', { pt: ['2', '2'] });
const MAKER = card('Test Maker', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.');
const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['3', '3'] });
describe('CR 614.1a, 616.1, 707.2: "The first time you would create one or more tokens during each of your turns, you may instead choose a creature other than ~ and create that many tokens that are copies of that creature."', () => {
  it('is fully automated', () => { expect(noManual(ESIX) && ESIX.automation.level === 'full').toBe(true); });
  it('the first creation of the turn makes that many copies of the chosen creature instead', () => {
    const s0 = scenario([], { defs: [ESIX, MAKER, WOLF], p1: { hand: ['Test Maker', 'Test Maker'], battlefield: ['Test Esix', 'Test Wolf'] } });
    const s = resolveAll(cast(s0, 'Test Maker'), { pick: [findAll(s0, 'Test Wolf', 'battlefield', 'p1')[0]!] });
    expect(onBf(s, 'Test Wolf').length).toBe(3);
    expect(onBf(s, 'Test Esix').length).toBe(1);
    expect(s.zones.battlefield.filter((id) => chars(s, id).name === 'Soldier').length).toBe(0);
  });
  it('the creature chosen is never Esix itself (the only other creature is offered)', () => {
    const s0 = scenario([], { defs: [ESIX, MAKER, WOLF], p1: { hand: ['Test Maker'], battlefield: ['Test Esix', 'Test Wolf'] } });
    const s = resolveAll(cast(s0, 'Test Maker'));
    expect(onBf(s, 'Test Esix').length).toBe(1);
  });
  it('negative: declining keeps the tokens the effect makes', () => {
    const s0 = scenario([], { defs: [ESIX, MAKER, WOLF], p1: { hand: ['Test Maker'], battlefield: ['Test Esix', 'Test Wolf'] } });
    const s = resolveAll(cast(s0, 'Test Maker'), { yes: false });
    expect(onBf(s, 'Test Wolf').length).toBe(1);
    expect(s.zones.battlefield.filter((id) => chars(s, id).name.includes('Soldier')).length).toBe(2);
  });
  it('negative: only the first creation of the turn is replaced', () => {
    const s0 = scenario([], { defs: [ESIX, MAKER, WOLF], p1: { hand: ['Test Maker', 'Test Maker'], battlefield: ['Test Esix', 'Test Wolf'] } });
    let s = resolveAll(cast(s0, 'Test Maker'));
    s = resolveAll(cast(s, 'Test Maker'));
    expect(s.zones.battlefield.filter((id) => chars(s, id).name.includes('Soldier')).length).toBe(2);
  });
});

// ---- Jade Monolith -------------------------------------------------------------------------------------------------------------------------------------------------------
const MONOLITH = card('Test Monolith', 'Artifact', '{0}: The next time a source of your choice would deal damage to target creature this turn, that source deals that damage to you instead.');
const PINGER = card('Test Pinger', 'Creature — Wizard', '{T}: ~ deals 1 damage to target creature.', { pt: ['1', '1'] });
describe('CR 614.9, 609.7a, 615.7: "The next time a source of your choice would deal damage to target creature this turn, that source deals that damage to you instead."', () => {
  it('is fully automated', () => { expect(noManual(MONOLITH) && MONOLITH.automation.level === 'full').toBe(true); });
  it('the chosen source\'s next damage to the creature is dealt to you instead', () => {
    const s0 = scenario([], { defs: [MONOLITH, PINGER, BEAR], p1: { battlefield: ['Test Monolith', 'Test Pinger', 'Test Plain Bear'] } });
    const pinger = find(s0, 'Test Pinger', 'battlefield', 'p1');
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Monolith', 'battlefield', 'p1'), ability: 'p:0:0' } as never);
    s = resolveAll(s, { targets: [bear], pick: [pinger] });
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: pinger, ability: 'p:0:0' } as never), { targets: [bear] });
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 1);
    expect(s.objects[bear]!.damage).toBe(0);
  });
});

// ---- Anoint with Affliction ----------------------------------------------------------------------------------------------------------------------------------------
const ANOINT = card('Test Anoint', 'Instant', 'Exile target creature if it has mana value 3 or less. Exile that creature instead if its controller has three or more poison counters.');
const BIG = card('Test Big Bear', 'Creature — Bear', '', { pt: ['5', '5'], cost: '{4}{G}', colors: ['G'] });
describe('CR 614.15, 608.2c: "Exile target creature if it has mana value 3 or less. Exile that creature instead if its controller has three or more poison counters."', () => {
  it('is fully automated', () => { expect(noManual(ANOINT) && ANOINT.automation.level === 'full').toBe(true); });
  it('a creature of mana value 3 or less is exiled', () => {
    const s0 = scenario([], { defs: [ANOINT, BEAR, BIG], p1: { hand: ['Test Anoint'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const s = resolveAll(cast(s0, 'Test Anoint'), { targets: [find(s0, 'Test Plain Bear', 'battlefield', 'p2')] });
    expect(exiled(s, 'Test Plain Bear')).toBe(1);
  });
  it('negative: a bigger creature stays when its controller has fewer than three poison counters', () => {
    const s0 = scenario([], { defs: [ANOINT, BEAR, BIG], p1: { hand: ['Test Anoint'] }, p2: { battlefield: ['Test Big Bear'] } });
    const s = resolveAll(cast(s0, 'Test Anoint'), { targets: [find(s0, 'Test Big Bear', 'battlefield', 'p2')] });
    expect(exiled(s, 'Test Big Bear')).toBe(0);
    expect(onBf(s, 'Test Big Bear').length).toBe(1);
  });
  it('with three poison counters on its controller the bigger creature is exiled instead', () => {
    const s0 = scenario([], { defs: [ANOINT, BEAR, BIG], p1: { hand: ['Test Anoint'] }, p2: { battlefield: ['Test Big Bear'] } });
    const poisoned: GameState = { ...s0, players: s0.players.map((p) => (p.id === 'p2' ? { ...p, poison: 3 } : p)) };
    const s = resolveAll(cast(poisoned, 'Test Anoint'), { targets: [find(poisoned, 'Test Big Bear', 'battlefield', 'p2')] });
    expect(exiled(s, 'Test Big Bear')).toBe(1);
  });
  it('negative: two poison counters are not enough', () => {
    const s0 = scenario([], { defs: [ANOINT, BEAR, BIG], p1: { hand: ['Test Anoint'] }, p2: { battlefield: ['Test Big Bear'] } });
    const poisoned: GameState = { ...s0, players: s0.players.map((p) => (p.id === 'p2' ? { ...p, poison: 2 } : p)) };
    const s = resolveAll(cast(poisoned, 'Test Anoint'), { targets: [find(poisoned, 'Test Big Bear', 'battlefield', 'p2')] });
    expect(exiled(s, 'Test Big Bear')).toBe(0);
  });
});

// ---- Aether Revolt -----------------------------------------------------------------------------------------------------------------------------------------------------
const REVOLT = card('Test Revolt', 'Enchantment', 'As long as a permanent left the battlefield under your control this turn, if a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.');
const SMASH = card('Test Smash', 'Instant', 'Destroy target artifact.');
const TRINKET = card('Test Trinket', 'Artifact', '');
describe('CR 614.1a, 120.3, 611.3a: "As long as a permanent left the battlefield under your control this turn, ... it deals that much damage plus 2 instead."', () => {
  it('is fully automated', () => { expect(noManual(REVOLT) && REVOLT.automation.level === 'full').toBe(true); });
  it('negative: with no permanent having left, the damage is as printed', () => {
    const s0 = scenario([], { defs: [REVOLT, BURN], p1: { hand: ['Test Burn'], battlefield: ['Test Revolt'] } });
    const s = resolveAll(cast(s0, 'Test Burn'), { players: ['p2'] });
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 3);
  });
  it('after a permanent left the battlefield under your control this turn, noncombat damage to an opponent is 2 more', () => {
    const s0 = scenario([], { defs: [REVOLT, BURN, SMASH, TRINKET], p1: { hand: ['Test Burn', 'Test Smash'], battlefield: ['Test Revolt', 'Test Trinket'] } });
    let s = resolveAll(cast(s0, 'Test Smash'), { targets: [find(s0, 'Test Trinket', 'battlefield', 'p1')] });
    s = resolveAll(cast(s, 'Test Burn'), { players: ['p2'] });
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 5);
  });
  it('negative: damage to yourself is not increased', () => {
    const SELF = card('Test Self Burn', 'Instant', 'Test Self Burn deals 3 damage to you.');
    const s0 = scenario([], { defs: [REVOLT, SELF, SMASH, TRINKET], p1: { hand: ['Test Self Burn', 'Test Smash'], battlefield: ['Test Revolt', 'Test Trinket'] } });
    let s = resolveAll(cast(s0, 'Test Smash'), { targets: [find(s0, 'Test Trinket', 'battlefield', 'p1')] });
    s = resolveAll(cast(s, 'Test Self Burn'));
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 3);
  });
});

// ---- Archmage Ascension ------------------------------------------------------------------------------------------------------------------------------------------------
const ASCENSION = card('Test Ascension', 'Enchantment', 'As long as ~ has six or more quest counters on it, if you would draw a card, you may instead search your library for a card, put that card into your hand, then shuffle.');
const DRAW = card('Test Draw', 'Sorcery', 'You draw a card.');
describe('CR 614.1a, 121.1, 611.3a: "As long as ~ has six or more quest counters on it, if you would draw a card, you may instead search your library for a card, put that card into your hand, then shuffle."', () => {
  it('is fully automated', () => { expect(noManual(ASCENSION) && ASCENSION.automation.level === 'full').toBe(true); });
  it('with six quest counters the draw is replaced by a tutor: the hand grows by the searched card, the library shrinks by one', () => {
    const s0 = scenario([], { defs: [ASCENSION, DRAW, BEAR, ISLAND], p1: { hand: ['Test Draw'], battlefield: [{ name: 'Test Ascension', counters: { quest: 6 } }], library: ['Test Plain Bear', 'Test Island', 'Test Plain Bear'] } });
    const s = resolveAll(cast(s0, 'Test Draw'), { pick: [find(s0, 'Test Island', 'library', 'p1')] });
    expect(hand(s, 'p1')).toBe(1);
    expect(s.zones.hand.p1!.some((id) => chars(s, id).name === 'Test Island')).toBe(true);
    expect(lib(s, 'p1')).toBe(lib(s0, 'p1') - 1);
  });
  it('negative: with five quest counters the draw is an ordinary draw (the top card)', () => {
    const s0 = scenario([], { defs: [ASCENSION, DRAW, BEAR, ISLAND], p1: { hand: ['Test Draw'], battlefield: [{ name: 'Test Ascension', counters: { quest: 5 } }], library: ['Test Plain Bear', 'Test Island', 'Test Plain Bear'] } });
    const s = resolveAll(cast(s0, 'Test Draw'), { pick: [find(s0, 'Test Island', 'library', 'p1')] });
    expect(s.zones.hand.p1!.some((id) => chars(s, id).name === 'Test Plain Bear')).toBe(true);
  });
  it('negative: you may decline, and then you draw', () => {
    const s0 = scenario([], { defs: [ASCENSION, DRAW, BEAR, ISLAND], p1: { hand: ['Test Draw'], battlefield: [{ name: 'Test Ascension', counters: { quest: 6 } }], library: ['Test Plain Bear', 'Test Island', 'Test Plain Bear'] } });
    const s = resolveAll(cast(s0, 'Test Draw'), { yes: false });
    expect(s.zones.hand.p1!.some((id) => chars(s, id).name === 'Test Plain Bear')).toBe(true);
    expect(lib(s, 'p1')).toBe(lib(s0, 'p1') - 1);
  });
});

// ---- Undead Alchemist -------------------------------------------------------------------------------------------------------------------------------------------------
const ALCHEMIST = card('Test Alchemist', 'Creature — Zombie Wizard', 'If a Zombie you control would deal combat damage to a player, instead that player mills that many cards.\nWhenever a creature card is put into an opponent\'s graveyard from their library, exile that card and create a 2/2 black Zombie creature token.', { pt: ['3', '3'] });
describe('CR 614.1a, 120.3, 701.17a: "If a Zombie you control would deal combat damage to a player, instead that player mills that many cards."', () => {
  it('is fully automated', () => { expect(noManual(ALCHEMIST) && ALCHEMIST.automation.level === 'full').toBe(true); });
  const attack = (battlefield: string[]): GameState => {
    let s = scenario([], { defs: [ALCHEMIST, BEAR, ISLAND], p1: { battlefield }, p2: { library: ['Test Island', 'Test Island', 'Test Island', 'Test Island', 'Test Island'] } });
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Alchemist', 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
    for (let guard = 0; guard < 60 && s.turn.step !== 'combatDamage' && s.turn.step !== 'end'; guard++) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : act(s, { type: 'pass', player: s.pending!.player });
    return resolveAll(s);
  };
  it('the Zombie\'s combat damage mills that many cards instead of dealing damage', () => {
    const s = attack(['Test Alchemist']);
    expect(life(s, 'p2')).toBe(20);
    expect(s.zones.graveyard.p2!.length).toBeGreaterThanOrEqual(3);
  });
  it('a creature card milled into an opponent\'s graveyard is exiled and a Zombie token is made', () => {
    const MILL = card('Test Mill', 'Sorcery', 'Target player mills two cards.');
    const s1 = scenario([], { defs: [ALCHEMIST, BEAR, ISLAND, MILL], p1: { hand: ['Test Mill'], battlefield: ['Test Alchemist'] }, p2: { library: ['Test Plain Bear', 'Test Island'] } });
    const s = resolveAll(cast(s1, 'Test Mill'), { players: ['p2'] });
    expect(exiled(s, 'Test Plain Bear')).toBe(1);
    expect(s.zones.battlefield.filter((id) => chars(s, id).name.includes('Zombie')).length).toBe(1);
  });
  it('negative: a milled land is not exiled and makes no token', () => {
    const MILL = card('Test Mill', 'Sorcery', 'Target player mills two cards.');
    const s1 = scenario([], { defs: [ALCHEMIST, ISLAND, MILL], p1: { hand: ['Test Mill'], battlefield: ['Test Alchemist'] }, p2: { library: ['Test Island', 'Test Island'] } });
    const s = resolveAll(cast(s1, 'Test Mill'), { players: ['p2'] });
    expect(s.zones.battlefield.filter((id) => chars(s, id).name.includes('Zombie')).length).toBe(0);
  });
});

// ---- Quest for Pure Flame ---------------------------------------------------------------------------------------------------------------------------------------------
const QUEST = card('Test Quest', 'Enchantment', 'Remove four quest counters from ~ and sacrifice it: If any source you control would deal damage to a permanent or player this turn, it deals double that damage to that permanent or player instead.');
describe('CR 614.1a, 611.2a, 120.3: "If any source you control would deal damage to a permanent or player this turn, it deals double that damage to that permanent or player instead."', () => {
  it('is fully automated', () => { expect(noManual(QUEST) && QUEST.automation.level === 'full').toBe(true); });
  it('after the ability resolves, your damage this turn is doubled', () => {
    const s0 = scenario([], { defs: [QUEST, BURN], p1: { hand: ['Test Burn'], battlefield: [{ name: 'Test Quest', counters: { quest: 4 } }] } });
    let s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Quest', 'battlefield', 'p1'), ability: 'p:0:0' } as never));
    s = resolveAll(cast(s, 'Test Burn'), { players: ['p2'] });
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 6);
  });
  it('negative: without the ability the damage is as printed', () => {
    const s0 = scenario([], { defs: [QUEST, BURN], p1: { hand: ['Test Burn'], battlefield: [{ name: 'Test Quest', counters: { quest: 4 } }] } });
    const s = resolveAll(cast(s0, 'Test Burn'), { players: ['p2'] });
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 3);
  });
  it('negative: damage dealt by a source an opponent controls is not doubled', () => {
    const LURE = card('Test Lure', 'Instant', 'Target creature an opponent controls deals 2 damage to you.');
    const s0 = scenario([], { defs: [QUEST, LURE, BEAR], p1: { hand: ['Test Lure'], battlefield: [{ name: 'Test Quest', counters: { quest: 4 } }] }, p2: { battlefield: ['Test Plain Bear'] } });
    let s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Quest', 'battlefield', 'p1'), ability: 'p:0:0' } as never));
    s = resolveAll(cast(s, 'Test Lure'), { targets: [find(s, 'Test Plain Bear', 'battlefield', 'p2')] });
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 2);
  });
});
