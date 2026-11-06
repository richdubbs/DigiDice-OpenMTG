/**
 * edh-next-136 (must-finish round, group planeswalkers): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites
 * were checked against the 2026-09-25 Comprehensive Rules text; the rulings were fetched from Scryfall.
 *
 *   CR 610.3, 610.3a-b, 608.2b  "Exile target creature or enchantment you don't control until target enchantment you control leaves the battlefield." (Calix, Destiny's
 *                               Hand, ruling 2020-01-24)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, put } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { getChars } from '../../../src/rules/characteristics';
import { cantDo } from '../../../src/rules/cant';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; loyalty?: string; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const loyaltyOf = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['loyalty'] ?? 0;

interface Script { num?: number; yes?: boolean; targets?: TargetChoice[][]; pick?: (s: GameState, options: ObjectId[], player: PlayerId) => ObjectId[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: script.pick ? script.pick(s, p.options as ObjectId[], p.player as PlayerId) : p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.num ?? p.min });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
/** The activate actions offered for one object, with the text of each ability. */
const offeredOn = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): { key: string; text: string }[] =>
  legalActions(s, player).filter((l) => l.kind === 'activate' && l.object === id).map((l) => ({ key: (l.action as { ability: string }).ability, text: l.label }));
const activateText = (s: GameState, id: ObjectId, text: RegExp, script: Script = {}, player: PlayerId = 'p1'): GameState => {
  const hit = offeredOn(s, id, player).find((x) => text.test(x.text));
  if (!hit) throw new Error(`no ability ${text} offered on ${id}: ${JSON.stringify(offeredOn(s, id, player))}`);
  return settle(drive(act(s, { type: 'activate', player, source: id, ability: hit.key } as never), script), script);
};

// ---- Calix, Destiny's Hand: exile until ANOTHER target leaves the battlefield ---------------------------------------------------------------------------------------

const WARDEN = card('Test Warden', 'Legendary Planeswalker — Testy', '−3: Exile target creature or enchantment you don\'t control until target enchantment you control leaves the battlefield.', { loyalty: '6' });
const SHRINE = card('Test Shrine', 'Enchantment', '');
const OTHER_SHRINE = card('Test Other Shrine', 'Enchantment', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const KILL_SHRINE = card('Test Shrine Breaker', 'Instant', 'Destroy target enchantment.');

describe('CR 610.3: "Exile target creature or enchantment you don\'t control until target enchantment you control leaves the battlefield."', () => {
  const setup = (): GameState => mpScenario({
    defs: [WARDEN, SHRINE, OTHER_SHRINE, BEAR, KILL_SHRINE],
    zones: {
      p1: { battlefield: [{ name: 'Test Warden', counters: { loyalty: 6 } }, 'Test Shrine', 'Test Other Shrine'], hand: ['Test Shrine Breaker', 'Test Shrine Breaker'] },
      p2: { battlefield: ['Test Bear'] },
    },
  } as never);
  it('is automated', () => { expect(full(WARDEN)).toBe(true); });
  it('exiles the creature; it stays while the enchantment stays, and returns under its owner\'s control when THAT enchantment leaves (not another one)', () => {
    let s = setup();
    const me = find(s, 'Test Warden', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const shrine = find(s, 'Test Shrine', 'battlefield', 'p1');
    const other = find(s, 'Test Other Shrine', 'battlefield', 'p1');
    s = activateText(s, me, /−3|-3/, { targets: [[obj(bear)], [obj(shrine)]] });
    expect(s.objects[bear]?.zone ?? 'gone').not.toBe('battlefield');
    expect(s.zones.exile.length).toBe(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p2').length).toBe(0);
    // the other enchantment leaves: nothing returns
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shrine Breaker', 'hand', 'p1') } as never), { targets: [[obj(other)]] }));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p2').length).toBe(0);
    expect(s.zones.exile.length).toBe(1);
    // now the watched one leaves
    const s2 = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shrine Breaker', 'hand', 'p1') } as never), { targets: [[obj(shrine)]] }));
    const back = s2.zones.battlefield.filter((id) => s2.objects[id]!.owner === 'p2');
    expect(back.length).toBe(1);
    expect(s2.objects[back[0]!]!.controller).toBe('p2');
    expect(s2.zones.exile.length).toBe(0);
  });
  it('negative (ruling 2020-01-24): the target enchantment is gone before the ability resolves: the creature is not exiled', () => {
    let s = setup();
    const me = find(s, 'Test Warden', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const shrine = find(s, 'Test Shrine', 'battlefield', 'p1');
    s = drive(act(s, { type: 'activate', player: 'p1', source: me, ability: offeredOn(s, me).find((x) => /3/.test(x.text))!.key } as never), { targets: [[obj(bear)], [obj(shrine)]] });
    // respond: destroy the shrine first
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shrine Breaker', 'hand', 'p1') } as never), { targets: [[obj(shrine)]] });
    s = settle(s);
    expect(s.objects[bear]!.zone).toBe('battlefield');
    expect(s.zones.exile.length).toBe(0);
  });
});

// ---- Karn, Scion of Urza: an opponent chooses one of the revealed cards; the other is exiled with a silver counter; a silver card comes back -------------------------

const SCION = card('Test Scion', 'Legendary Planeswalker — Testy', '+1: Reveal the top two cards of your library. An opponent chooses one of them. Put that card into your hand and exile the other with a silver counter on it.\n−1: Put a card you own with a silver counter on it from exile into your hand.', { loyalty: '5' });
const ROCK = card('Test Rock', 'Artifact', '');
const PEBBLE = card('Test Pebble', 'Artifact', '');

describe('CR 608.2d, 122.1: "An opponent chooses one of them. Put that card into your hand and exile the other with a silver counter on it."', () => {
  const setup = (): GameState => mpScenario({
    defs: [SCION, ROCK, PEBBLE],
    zones: {
      p1: { battlefield: [{ name: 'Test Scion', counters: { loyalty: 5 } }], library: ['Test Rock', 'Test Pebble', 'Test Rock'] },
      p2: { library: ['Test Pebble'] },
    },
  } as never);
  it('is automated', () => { expect(full(SCION)).toBe(true); });
  it('the opponent (not you) chooses; the chosen card goes to your hand, the other into exile with one silver counter', () => {
    let s = setup();
    const me = find(s, 'Test Scion', 'battlefield', 'p1');
    const handBefore = new Set(Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1').map((o) => o.id));
    let chooser: PlayerId | undefined;
    s = activateText(s, me, /\+1/, { pick: (st, options, player) => { if (options.every((o) => st.objects[o]!.zone === 'library')) chooser = player; return [options.find((o) => st.objects[o]!.defId === PEBBLE.id) ?? options[0]!]; } });
    expect(chooser).toBeDefined();
    expect(chooser).not.toBe('p1');
    const hand = Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1' && !handBefore.has(o.id));
    expect(hand.map((o) => o.defId)).toEqual([PEBBLE.id]);
    const exiled = Object.values(s.objects).filter((o) => o.zone === 'exile' && o.owner === 'p1');
    expect(exiled.length).toBe(1);
    expect(exiled[0]!.defId).toBe(ROCK.id);
    expect(exiled[0]!.counters['silver']).toBe(1);
  });
  it('−1 puts a card you own with a silver counter from exile into your hand; never one without the counter, never an opponent\'s', () => {
    let s = mpScenario({
      defs: [SCION, ROCK, PEBBLE],
      zones: {
        p1: { battlefield: [{ name: 'Test Scion', counters: { loyalty: 5 } }], exile: [{ name: 'Test Rock', counters: { silver: 1 } }, 'Test Pebble'] },
        p2: { exile: [{ name: 'Test Pebble', counters: { silver: 1 } }] },
      },
    } as never);
    const me = find(s, 'Test Scion', 'battlefield', 'p1');
    const handBefore = new Set(Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1').map((o) => o.id));
    let offered: ObjectId[] = [];
    s = activateText(s, me, /−1|-1/, { pick: (_st, options) => { offered = options; return [options[0]!]; } });
    const hand = Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1' && !handBefore.has(o.id));
    expect(hand.map((o) => o.defId)).toEqual([ROCK.id]);
    expect(offered.length <= 1).toBe(true);
    expect(Object.values(s.objects).filter((o) => o.zone === 'exile').length).toBe(2);
  });
});

// ---- Karn, Living Legacy: pay any amount of mana, look at that many -------------------------------------------------------------------------------------------------

const LEGACY = card('Test Legacy', 'Legendary Planeswalker — Testy', '−1: Pay any amount of mana. Look at that many cards from the top of your library, then put one of those cards into your hand and the rest on the bottom of your library in a random order.', { loyalty: '4' });

describe('CR 118.12, 608.2d: "Pay any amount of mana. Look at that many cards from the top of your library, then put one of those cards into your hand ..."', () => {
  const setup = (): GameState => mpScenario({
    defs: [LEGACY, ROCK, PEBBLE],
    zones: { p1: { battlefield: [{ name: 'Test Legacy', counters: { loyalty: 4 } }, 'Plains', 'Plains', 'Plains'], library: ['Test Rock', 'Test Pebble', 'Test Rock', 'Test Rock'] } },
  } as never);
  it('is automated', () => { expect(full(LEGACY)).toBe(true); });
  it('paying two mana looks at two cards: one goes to your hand (you must take one, ruling 2022-09-09), the other to the bottom; two lands are tapped', () => {
    let s = setup();
    const s0 = s;
    const me = find(s, 'Test Legacy', 'battlefield', 'p1');
    const lib0 = [...(s.zones as never as { library: Record<string, ObjectId[]> }).library.p1!];
    const hand0 = new Set(Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1').map((o) => o.id));
    let offered: ObjectId[] = [];
    s = activateText(s, me, /−1|-1/, { num: 2, pick: (_st, options) => { offered = options; return [options.find((o) => o === lib0[1]) ?? options[0]!]; } });
    expect(offered.sort()).toEqual([lib0[0]!, lib0[1]!].sort());
    const added = Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1' && !hand0.has(o.id));
    expect(added.length).toBe(1);
    const lib = (s.zones as never as { library: Record<string, ObjectId[]> }).library.p1!;
    expect(lib.length).toBe(lib0.length - 1);
    expect(s.objects[lib[lib.length - 1]!]!.defId).toBe(s0.objects[lib0[0]!]!.defId); // the other card, on the bottom (a new object there, CR 400.7)
    expect(added[0]!.defId).toBe(s0.objects[lib0[1]!]!.defId);
    expect(lib[0]).toBe(lib0[2]);
    expect(Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.tapped === true).length).toBe(2);
  });
  it('negative (ruling 2022-09-09): paying no mana looks at no cards and puts none into your hand', () => {
    let s = setup();
    const me = find(s, 'Test Legacy', 'battlefield', 'p1');
    const hand0 = Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1').length;
    const lib00 = (s.zones as never as { library: Record<string, ObjectId[]> }).library.p1!.length;
    s = activateText(s, me, /−1|-1/, { num: 0 });
    expect(Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1').length).toBe(hand0);
    expect((s.zones as never as { library: Record<string, ObjectId[]> }).library.p1!.length).toBe(lib00);
  });
});

// ---- Nissa of Shadowed Boughs: a creature card from your hand or graveyard, mana value at most your lands, with two +1/+1 counters ---------------------------------

const BOUGHS = card('Test Boughs', 'Legendary Planeswalker — Testy', '−5: You may put a creature card with mana value less than or equal to the number of lands you control onto the battlefield from your hand or graveyard with two +1/+1 counters on it.', { loyalty: '6' });
const SMALL = card('Test Small Beast', 'Creature — Beast', '', { cost: '{1}{G}', pt: ['2', '2'] });
const BIG = card('Test Big Beast', 'Creature — Beast', '', { cost: '{4}{G}{G}', pt: ['6', '6'] });

describe('CR 608.2d, 122.6: "You may put a creature card with mana value less than or equal to the number of lands you control onto the battlefield from your hand or graveyard with two +1/+1 counters on it."', () => {
  const setup = (): GameState => mpScenario({
    defs: [BOUGHS, SMALL, BIG],
    zones: {
      p1: { battlefield: [{ name: 'Test Boughs', counters: { loyalty: 6 } }, 'Plains', 'Plains', 'Plains'], graveyard: ['Test Small Beast', 'Test Big Beast'], hand: ['Test Big Beast'] },
      p2: { graveyard: ['Test Small Beast'] },
    },
  } as never);
  it('is automated', () => { expect(full(BOUGHS)).toBe(true); });
  it('offers only your own creature cards in your hand or graveyard with mana value up to your land count; it enters under your control with two +1/+1 counters', () => {
    let s = setup();
    const me = find(s, 'Test Boughs', 'battlefield', 'p1');
    const mine = find(s, 'Test Small Beast', 'graveyard', 'p1');
    let offered: ObjectId[] = [];
    s = activateText(s, me, /−5|-5/, { pick: (_st, options) => { offered = options; return options.slice(0, 1); } });
    expect(offered).toEqual([mine]); // not the 6-mana cards (3 lands), not the opponent's card
    const beast = Object.values(s.objects).find((o) => o.zone === 'battlefield' && o.defId === SMALL.id)!;
    expect(beast.controller).toBe('p1');
    expect(beast.counters['+1/+1']).toBe(2);
  });
  it('negative: you may put none ("you may")', () => {
    let s = setup();
    const me = find(s, 'Test Boughs', 'battlefield', 'p1');
    s = activateText(s, me, /−5|-5/, { pick: () => [] });
    expect(Object.values(s.objects).some((o) => o.zone === 'battlefield' && o.defId === SMALL.id)).toBe(false);
  });
});

// ---- Chandra, Legacy of Fire: remove a loyalty counter from each of any number of permanents you control, exile that many, play them this turn ---------------------

const LEGACY_FIRE = card('Test Flame', 'Legendary Planeswalker — Testy', '0: Remove a loyalty counter from each of any number of permanents you control. Exile that many cards from the top of your library. You may play them this turn.', { loyalty: '5' });
const OTHER_WALKER = card('Test Other Walker', 'Legendary Planeswalker — Othery', '+1: You gain 1 life.', { loyalty: '3' });

describe('CR 608.2c, 611.2c: "Remove a loyalty counter from each of any number of permanents you control. Exile that many cards from the top of your library. You may play them this turn."', () => {
  const setup = (): GameState => mpScenario({
    defs: [LEGACY_FIRE, OTHER_WALKER, ROCK, PEBBLE],
    zones: { p1: { battlefield: [{ name: 'Test Flame', counters: { loyalty: 5 } }, { name: 'Test Other Walker', counters: { loyalty: 3 } }, 'Test Rock'], library: ['Test Pebble', 'Test Pebble', 'Test Pebble'] } },
  } as never);
  it('is automated', () => { expect(full(LEGACY_FIRE)).toBe(true); });
  it('exiles as many cards as loyalty counters were removed (a chosen permanent with none counts nothing), and they may be played this turn only', () => {
    let s = setup();
    const me = find(s, 'Test Flame', 'battlefield', 'p1');
    const other = find(s, 'Test Other Walker', 'battlefield', 'p1');
    const rock = find(s, 'Test Rock', 'battlefield', 'p1');
    s = activateText(s, me, /: 0:/, { pick: (_st, options) => options.filter((o) => o === me || o === other || o === rock) });
    expect(loyaltyOf(s, me)).toBe(4);
    expect(loyaltyOf(s, other)).toBe(2);
    const exiled = Object.values(s.objects).filter((o) => o.zone === 'exile' && o.owner === 'p1');
    expect(exiled.length).toBe(2); // the Rock had no loyalty counter: two removed, two exiled
    expect(exiled.every((o) => o.defId === PEBBLE.id)).toBe(true);
    const cast = legalActions(s, 'p1').filter((l) => l.kind === 'cast' && exiled.some((o) => o.id === (l.action as { card?: string }).card));
    expect(cast.length).toBeGreaterThan(0);
    const later = advanceTo(s, s.turn.number + 1, 'main1');
    const castLater = legalActions(later, 'p1').filter((l) => l.kind === 'cast' && exiled.some((o) => o.id === (l.action as { card?: string }).card));
    expect(castLater.length).toBe(0);
  });
  it('negative: choosing no permanent exiles nothing', () => {
    let s = setup();
    const me = find(s, 'Test Flame', 'battlefield', 'p1');
    s = activateText(s, me, /: 0:/, { pick: () => [] });
    expect(Object.values(s.objects).filter((o) => o.zone === 'exile').length).toBe(0);
    expect(loyaltyOf(s, me)).toBe(5);
  });
});

// ---- Jace, Mirror Mage: a kicked copy that isn't legendary with a starting loyalty of 1; draw a card and reveal it -------------------------------------------------

const MIRROR = card('Test Mirror', 'Legendary Planeswalker — Testy', 'Kicker {2}\nWhen Test Mirror enters, if Test Mirror was kicked, create a token that\'s a copy of Test Mirror, except it\'s not legendary and its starting loyalty is 1.\n0: Draw a card and reveal it. Remove a number of loyalty counters equal to that card\'s mana value from Test Mirror.', { loyalty: '4', cost: '{1}' });
const THREE = card('Test Three Drop', 'Creature — Beast', '', { cost: '{2}{G}', pt: ['3', '3'] });

describe('CR 707.9b, 306.5b: "create a token that\'s a copy of ~, except it\'s not legendary and its starting loyalty is 1." (rulings 2020-09-25)', () => {
  const setup = (): GameState => mpScenario({ defs: [MIRROR], zones: { p1: { hand: ['Test Mirror'], battlefield: ['Plains', 'Plains', 'Plains'] } } } as never);
  it('is automated', () => { expect(full(MIRROR)).toBe(true); });
  it('kicked: a nonlegendary token copy enters with one loyalty counter; the original keeps its four (no legend rule)', () => {
    const s = settle(drive(act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Mirror', 'hand', 'p1') } as never), { yes: true }), { yes: true });
    const mirrors = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && s.objects[o.id]!.defId !== 'Plains' && getChars(s, o.id).name === 'Test Mirror');
    expect(mirrors.length).toBe(2);
    const token = mirrors.find((o) => o.kind === 'token')!;
    const card0 = mirrors.find((o) => o.kind !== 'token')!;
    expect(token.counters['loyalty']).toBe(1);
    expect(getChars(s, token.id).supertypes).not.toContain('Legendary');
    expect(getChars(s, token.id).loyalty).toBe('1');
    expect(card0.counters['loyalty']).toBe(4);
    expect(getChars(s, card0.id).supertypes).toContain('Legendary');
  });
  it('negative: not kicked, no token', () => {
    const s = settle(drive(act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Mirror', 'hand', 'p1') } as never), { yes: false }), { yes: false });
    expect(Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.kind === 'token').length).toBe(0);
  });
});

describe('CR 121.1, 701.20a: "Draw a card and reveal it. Remove a number of loyalty counters equal to that card\'s mana value from ~."', () => {
  const setup = (top: string): GameState => {
    const s = mpScenario({ defs: [MIRROR, THREE], zones: { p1: { battlefield: [{ name: 'Test Mirror', counters: { loyalty: 4 } }] } } } as never);
    const id = put(s, 'p1', 'library', top);
    const lib = (s.zones as never as { library: Record<string, ObjectId[]> }).library.p1!;
    lib.splice(lib.indexOf(id), 1);
    lib.unshift(id); // on top of the library
    return s;
  };
  it('draws the card, reveals it to every player, and removes loyalty counters equal to its mana value', () => {
    let s = setup('Test Three Drop');
    const me = find(s, 'Test Mirror', 'battlefield', 'p1');
    s = activateText(s, me, /: 0:/);
    expect(loyaltyOf(s, me)).toBe(1);
    const drawn = Object.values(s.objects).find((o) => o.zone === 'hand' && o.owner === 'p1' && o.defId === THREE.id)!;
    expect(drawn).toBeDefined();
    expect(s.log.some((l) => /reveals/.test(l.text) && /Test Three Drop/.test(l.text))).toBe(true);
  });
  it('negative (ruling 2020-09-25): a replaced draw reveals no card and removes no counter', () => {
    const TWICE = card('Test Twice', 'Enchantment', 'If you would draw a card, draw two cards instead.');
    expect(full(TWICE)).toBe(true);
    let s = mpScenario({ defs: [MIRROR, THREE, TWICE], zones: { p1: { battlefield: [{ name: 'Test Mirror', counters: { loyalty: 4 } }, 'Test Twice'] } } } as never);
    const lib = (s.zones as never as { library: Record<string, ObjectId[]> }).library.p1!;
    for (let i = 0; i < 2; i++) { const id = put(s, 'p1', 'library', 'Test Three Drop'); lib.splice(lib.indexOf(id), 1); lib.unshift(id); }
    const me = find(s, 'Test Mirror', 'battlefield', 'p1');
    s = activateText(s, me, /: 0:/);
    expect(loyaltyOf(s, me)).toBe(4);
    expect(s.log.some((l) => /reveals/.test(l.text))).toBe(false);
  });
  it('a land (mana value 0) removes no counter', () => {
    let s = setup('Plains');
    const me = find(s, 'Test Mirror', 'battlefield', 'p1');
    s = activateText(s, me, /: 0:/);
    expect(loyaltyOf(s, me)).toBe(4);
  });
});

// ---- Ashiok, Nightmare Muse: cast up to three spells from among face-up cards your opponents own from exile, free -------------------------------------------------

const MUSE = card('Test Muse', 'Legendary Planeswalker — Testy', '−7: You may cast up to three spells from among face-up cards your opponents own from exile without paying their mana costs.', { loyalty: '8' });
const PRICEY = card('Test Pricey Beast', 'Creature — Beast', '', { cost: '{5}{G}{G}', pt: ['7', '7'] });

describe('CR 608.2g, 118.9: "You may cast up to three spells from among face-up cards your opponents own from exile without paying their mana costs." (rulings 2020-01-24)', () => {
  const setup = (): GameState => {
    const s = mpScenario({
      defs: [MUSE, PRICEY, BEAR],
      zones: { p1: { battlefield: [{ name: 'Test Muse', counters: { loyalty: 8 } }], exile: ['Test Bear'] }, p2: { exile: ['Test Pricey Beast', 'Plains', 'Test Bear'] } },
    } as never);
    // one of the opponent's exiled cards is face down (CR 406.3): it can't be chosen
    const down = Object.values(s.objects).find((o) => o.zone === 'exile' && o.owner === 'p2' && o.defId === BEAR.id)!;
    (s.objects[down.id] as { faceDown?: boolean }).faceDown = true;
    return s;
  };
  it('is automated', () => { expect(full(MUSE)).toBe(true); });
  it('offers only face-up nonland cards opponents own in exile (not yours, not a face-down one, not a land); the one cast is yours, free, as the ability resolves', () => {
    let s = setup();
    const me = find(s, 'Test Muse', 'battlefield', 'p1');
    const pricey = find(s, 'Test Pricey Beast', 'exile', 'p2');
    let offered: ObjectId[] = [];
    s = activateText(s, me, /−7|-7/, { pick: (_st, options) => { if (offered.length === 0) offered = options; return options.filter((o) => o === pricey); } });
    expect(offered).toEqual([pricey]);
    const beast = Object.values(s.objects).find((o) => o.zone === 'battlefield' && o.defId === PRICEY.id)!;
    expect(beast).toBeDefined();
    expect(beast.controller).toBe('p1');
  });
  it('negative: you may cast none', () => {
    let s = setup();
    const me = find(s, 'Test Muse', 'battlefield', 'p1');
    s = activateText(s, me, /−7|-7/, { pick: () => [] });
    expect(Object.values(s.objects).some((o) => o.zone === 'battlefield' && o.defId === PRICEY.id)).toBe(false);
  });
});

// ---- Nicol Bolas, Planeswalker: 7 damage to target player or planeswalker; that player or that planeswalker's controller discards and sacrifices --------------------

const ELDER = card('Test Elder', 'Legendary Planeswalker — Testy', '−9: Test Elder deals 7 damage to target player or planeswalker. That player or that planeswalker\'s controller discards seven cards, then sacrifices seven permanents of their choice.', { loyalty: '9' });

describe('CR 115.1, 109.4, 701.9a, 701.21a: "~ deals 7 damage to target player or planeswalker. That player or that planeswalker\'s controller discards seven cards, then sacrifices seven permanents of their choice."', () => {
  const setup = (): GameState => mpScenario({
    defs: [ELDER, OTHER_WALKER, BEAR],
    zones: {
      p1: { battlefield: [{ name: 'Test Elder', counters: { loyalty: 9 } }] },
      p2: { battlefield: ['Test Bear', 'Plains'], hand: ['Test Bear'] },
      p3: { battlefield: [{ name: 'Test Other Walker', counters: { loyalty: 3 } }, 'Test Bear', 'Plains'], hand: ['Test Bear', 'Test Bear'] },
    },
  } as never);
  const count = (s: GameState, p: PlayerId, zone: string): number => Object.values(s.objects).filter((o) => o.zone === zone && (zone === 'battlefield' ? o.controller === p : o.owner === p)).length;
  it('is automated', () => { expect(full(ELDER)).toBe(true); });
  it('a target player is dealt 7 damage, discards their whole hand (fewer than seven) and sacrifices every permanent (fewer than seven); no other player is touched', () => {
    let s = setup();
    const me = find(s, 'Test Elder', 'battlefield', 'p1');
    const life = lifeOf(s, 'p2');
    const p3hand = count(s, 'p3', 'hand');
    s = activateText(s, me, /−9|-9/, { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]], pick: (_st, options) => options });
    expect(lifeOf(s, 'p2')).toBe(life - 7);
    expect(count(s, 'p2', 'hand')).toBe(0);
    expect(count(s, 'p2', 'battlefield')).toBe(0);
    expect(count(s, 'p3', 'hand')).toBe(p3hand);
    expect(count(s, 'p3', 'battlefield')).toBe(3);
  });
  it('a target planeswalker is dealt the damage; ITS controller discards and sacrifices (not the other players)', () => {
    let s = setup();
    const me = find(s, 'Test Elder', 'battlefield', 'p1');
    const walker = find(s, 'Test Other Walker', 'battlefield', 'p3');
    const p2hand = count(s, 'p2', 'hand');
    const life3 = lifeOf(s, 'p3');
    s = activateText(s, me, /−9|-9/, { targets: [[obj(walker)]], pick: (_st, options) => options });
    expect(count(s, 'p3', 'hand')).toBe(0);
    expect(count(s, 'p3', 'battlefield')).toBe(0);
    expect(count(s, 'p2', 'hand')).toBe(p2hand);
    expect(count(s, 'p2', 'battlefield')).toBe(2);
    expect(lifeOf(s, 'p3')).toBe(life3); // the damage went to the planeswalker
  });
});

// ---- Jace, Architect of Thought: piles (one to your hand, the other to the bottom); search every player's library, exile, cast free -------------------------------

const ARCHITECT = card('Test Architect', 'Legendary Planeswalker — Testy', '−2: Reveal the top three cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other on the bottom of your library in any order.\n−8: For each player, search that player\'s library for a nonland card and exile it, then that player shuffles. You may cast those cards without paying their mana costs.', { loyalty: '8' });

describe('CR 700.3, 401.4: "An opponent separates those cards into two piles. Put one pile into your hand and the other on the bottom of your library in any order." (ruling 2012-10-01)', () => {
  it('is automated', () => { expect(full(ARCHITECT)).toBe(true); });
  it('the opponent separates; YOU choose the pile for your hand; the other goes to the bottom', () => {
    let s = mpScenario({ defs: [ARCHITECT, ROCK, PEBBLE], zones: { p1: { battlefield: [{ name: 'Test Architect', counters: { loyalty: 8 } }] } } } as never);
    const lib = (s.zones as never as { library: Record<string, ObjectId[]> }).library.p1!;
    for (const n of ['Test Rock', 'Test Pebble', 'Test Rock']) { const id = put(s, 'p1', 'library', n); lib.splice(lib.indexOf(id), 1); lib.unshift(id); }
    const top3 = lib.slice(0, 3);
    const hand0 = new Set(Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1').map((o) => o.id));
    const deciders: PlayerId[] = [];
    const me = find(s, 'Test Architect', 'battlefield', 'p1');
    s = activateText(s, me, /−2|-2/, { pick: (_st, options, player) => { deciders.push(player); return options.filter((o) => o === top3[0]); } });
    const added = Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1' && !hand0.has(o.id));
    expect(added.length === 1 || added.length === 2).toBe(true);
    const libAfter = (s.zones as never as { library: Record<string, ObjectId[]> }).library.p1!;
    expect(libAfter.length).toBe(lib.length - added.length);
    expect(deciders.some((p) => p !== 'p1')).toBe(true); // an opponent separated the piles
  });
});

describe('CR 608.2f, 701.23a, 608.2g: "For each player, search that player\'s library for a nonland card and exile it, then that player shuffles. You may cast those cards without paying their mana costs." (rulings 2012-10-01)', () => {
  it('you search every library (yours too), one nonland card from each is exiled, and you cast the ones you choose for free; the rest stay exiled', () => {
    let s = mpScenario({
      defs: [ARCHITECT, BEAR, PRICEY],
      zones: { p1: { battlefield: [{ name: 'Test Architect', counters: { loyalty: 8 } }], library: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { library: ['Test Pricey Beast'] }, p3: { library: ['Test Bear'] }, p4: { library: ['Test Bear'] } },
    } as never);
    const me = find(s, 'Test Architect', 'battlefield', 'p1');
    const searchers: PlayerId[] = [];
    s = activateText(s, me, /−8|-8/, {
      pick: (st, options, player) => {
        if (options.every((o) => st.objects[o]!.zone === 'library')) { searchers.push(player); return options.filter((o) => st.objects[o]!.defId !== 'Plains').slice(0, 1); }
        return options.filter((o) => st.objects[o]!.defId === PRICEY.id);
      },
    });
    expect(searchers).toEqual(['p1', 'p1', 'p1', 'p1']);
    expect(Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.defId === PRICEY.id && o.controller === 'p1').length).toBe(1);
    expect(Object.values(s.objects).filter((o) => o.zone === 'exile' && o.defId === BEAR.id).length).toBe(3); // yours, Carol's, Dan's: not cast, they stay exiled
    expect(Object.values(s.objects).filter((o) => o.zone === 'exile' && o.defId === BEAR.id && o.owner === 'p1').length).toBe(1);
  });
});

// ---- Tamiyo, Collector of Tales: opponents' spells and abilities can't cause you to discard cards or sacrifice permanents -------------------------------------------

const COLLECTOR = card('Test Collector', 'Legendary Planeswalker — Testy', 'Spells and abilities your opponents control can\'t cause you to discard cards or sacrifice permanents.', { loyalty: '5' });
const MIND_ROT = card('Test Mind Rot', 'Sorcery', 'Target player discards two cards.');
const EDICT = card('Test Edict', 'Sorcery', 'Each player sacrifices a creature of their choice.');

describe('CR 701.9a, 701.21a, 109.5: "Spells and abilities your opponents control can\'t cause you to discard cards or sacrifice permanents." (rulings 2019-05-03)', () => {
  const setup = (): GameState => mpScenario({
    defs: [COLLECTOR, MIND_ROT, EDICT, BEAR],
    zones: {
      p1: { battlefield: [{ name: 'Test Collector', counters: { loyalty: 5 } }, 'Test Bear'], hand: ['Test Bear', 'Test Bear', 'Test Mind Rot'] },
      p2: { battlefield: ['Test Bear'], hand: ['Test Mind Rot', 'Test Edict', 'Test Bear', 'Test Bear'] },
    },
  } as never);
  const handOf = (s: GameState, p: PlayerId): number => Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === p).length;
  const bearsOf = (s: GameState, p: PlayerId): number => Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.controller === p && o.defId === BEAR.id).length;
  const castAs = (s0: GameState, p: PlayerId, name: string, targets: TargetChoice[][] = []): GameState => {
    expect(s0.turn.activePlayer).toBe(p);
    return settle(drive(act(s0, { type: 'cast', player: p, card: find(s0, name, 'hand', p) } as never), { targets, pick: (_st, options) => options.slice(0, 1) }));
  };
  it('is automated', () => { expect(full(COLLECTOR)).toBe(true); expect(full(MIND_ROT)).toBe(true); expect(full(EDICT)).toBe(true); });
  it('an opponent\'s discard spell makes you discard nothing; your own makes you discard', () => {
    let s = advanceTo(setup(), 2, 'main1'); // p2's turn
    const before = handOf(s, 'p1');
    s = castAs(s, 'p2', 'Test Mind Rot', [[{ kind: 'player', id: 'p1' } as TargetChoice]]);
    expect(handOf(s, 'p1')).toBe(before);
  });
  it('negative: your own spell can make you discard', () => {
    let s = setup();
    const before = handOf(s, 'p1');
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mind Rot', 'hand', 'p1') } as never), { targets: [[{ kind: 'player', id: 'p1' } as TargetChoice]] }));
    expect(handOf(s, 'p1')).toBe(before - 1 - 2); // the spell left the hand, then two discarded
  });
  it('an opponent\'s edict: you sacrifice nothing, the other players do', () => {
    let s = advanceTo(setup(), 2, 'main1');
    s = castAs(s, 'p2', 'Test Edict');
    expect(bearsOf(s, 'p1')).toBe(1);
    expect(bearsOf(s, 'p2')).toBe(0);
  });
});

// ---- Jace, Multiverse Architect: at the beginning of combat on each opponent's turn, they may pay {2}; if they don't, their creatures can't attack your Jaces --------

const MULTI = card('Test Multi', 'Legendary Planeswalker — Jace', 'At the beginning of combat on each opponent\'s turn, they may pay {2}. If they don\'t, creatures they control can\'t attack Jaces you control this turn.', { loyalty: '4' });

describe('CR 508.1b, 506.3, 118.12: "At the beginning of combat on each opponent\'s turn, they may pay {2}. If they don\'t, creatures they control can\'t attack Jaces you control this turn."', () => {
  const setup = (): GameState => mpScenario({
    defs: [MULTI, BEAR],
    zones: { p1: { battlefield: [{ name: 'Test Multi', counters: { loyalty: 4 } }] }, p2: { battlefield: ['Test Bear', 'Plains', 'Plains'] }, p3: { battlefield: ['Test Bear'] } },
  } as never);
  it('is automated', () => { expect(full(MULTI)).toBe(true); });
  const atCombat = (yes: boolean): GameState => {
    let s = advanceTo(setup(), 2, 'beginCombat');
    s = settle(s, { yes });
    return s;
  };
  it('the opponent declines: their creatures can\'t attack your Jace this turn (they may still attack you); another opponent\'s creatures are not affected', () => {
    const s = atCombat(false);
    const jace = find(s, 'Test Multi', 'battlefield', 'p1');
    const bear2 = find(s, 'Test Bear', 'battlefield', 'p2');
    const bear3 = find(s, 'Test Bear', 'battlefield', 'p3');
    expect(s.turn.activePlayer).toBe('p2');
    expect(cantDo(s, 'attack', bear2, jace)).not.toBeNull();
    expect(cantDo(s, 'attackPlayer', bear2, 'p1')).toBeNull();
    expect(cantDo(s, 'attack', bear3, jace)).toBeNull();
    const next = advanceTo(s, 6, 'main1');
    expect(cantDo(next, 'attack', bear2, jace)).toBeNull(); // "this turn" only
  });
  it('negative: the opponent pays {2}: their creatures may attack your Jace', () => {
    const s = atCombat(true);
    const jace = find(s, 'Test Multi', 'battlefield', 'p1');
    const bear2 = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(cantDo(s, 'attack', bear2, jace)).toBeNull();
    expect(Object.values(s.objects).filter((o) => o.controller === 'p2' && o.tapped === true).length).toBe(2); // the two Plains paid for it
  });
});
