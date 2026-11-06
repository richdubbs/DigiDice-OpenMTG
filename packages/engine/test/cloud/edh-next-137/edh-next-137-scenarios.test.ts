/**
 * edh-next-137 (must-finish round, group planeswalkers): the round's readings played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites
 * were checked against the 2026-09-25 Comprehensive Rules text; the rulings were fetched from Scryfall.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { commanderOptions } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; loyalty?: string; colors?: string[]; layout?: string } = {}): CardDef {
  return compileCard({ name, layout: opts.layout ?? 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const loyaltyOf = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['loyalty'] ?? 0;
const countersOf = (s: GameState, id: ObjectId, k: string): number => s.objects[id]!.counters[k] ?? 0;

interface Script { yes?: boolean | boolean[]; targets?: TargetChoice[][]; pick?: (s: GameState, options: ObjectId[], player: PlayerId) => ObjectId[]; option?: (labels: string[]) => number[]; n?: number }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 200 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: Array.isArray(script.yes) ? (script.yes.shift() ?? false) : (script.yes ?? false) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: script.pick ? script.pick(s, p.options as ObjectId[], p.player as PlayerId) : p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: (script.option ? script.option(p.options.map((o) => o.label)) : [...Array(p.min).keys()]).map((i) => p.options[i]!.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.n ?? p.min });
    else if ((p.kind as string) === 'commanderZone') s = answer(s, { kind: 'commanderZone', command: false } as never); // (a commander stays where it went: Karn's test)
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const offeredOn = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): { key: string; text: string }[] =>
  legalActions(s, player).filter((l) => l.kind === 'activate' && l.object === id).map((l) => ({ key: (l.action as { ability: string }).ability, text: l.label.replace(/^[^:]*: /, '') }));
const activateText = (s: GameState, id: ObjectId, text: RegExp, script: Script = {}, player: PlayerId = 'p1'): GameState => {
  const hit = offeredOn(s, id, player).find((x) => text.test(x.text));
  if (!hit) throw new Error(`no ability ${text} offered on ${id}: ${JSON.stringify(offeredOn(s, id, player))}`);
  return settle(drive(act(s, { type: 'activate', player, source: id, ability: hit.key } as never), script), script);
};
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

// ---- Elspeth Resplendent: "a +1/+1 counter and a counter from among ...", "onto the battlefield with a shield counter on it" ----------------------------------

const RADIANT = card('Test Radiant', 'Legendary Planeswalker — Testy',
  '+1: Choose up to one target creature. Put a +1/+1 counter and a counter from among flying, first strike, lifelink, or vigilance on it.\n'
  + '−3: Look at the top seven cards of your library. You may put a permanent card with mana value 3 or less from among them onto the battlefield with a shield counter on it. Put the rest on the bottom of your library in a random order.',
  { loyalty: '5' });
const SMALL = card('Test Small Golem', 'Artifact Creature — Golem', '', { cost: '{2}', pt: ['2', '2'] });
const BIG = card('Test Big Golem', 'Artifact Creature — Golem', '', { cost: '{5}', pt: ['5', '5'] });

describe('CR 122.1, 122.1b, 608.2d: "Put a +1/+1 counter and a counter from among flying, first strike, lifelink, or vigilance on it." (Elspeth Resplendent)', () => {
  const setup = (): GameState => mpScenario({
    defs: [RADIANT, BEAR, SMALL, BIG],
    zones: { p1: { battlefield: [{ name: 'Test Radiant', counters: { loyalty: 5 } }, 'Test Bear'], library: ['Plains', 'Test Big Golem', 'Test Small Golem'] } },
  } as never);
  it('is automated', () => { expect(full(RADIANT)).toBe(true); });
  it('puts the +1/+1 counter and the chosen keyword counter on the target (ruling 2022-04-29: its controller chooses the kind)', () => {
    let s = setup();
    const me = find(s, 'Test Radiant', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    let labels: string[] = [];
    s = activateText(s, me, /^\+1/, { targets: [[obj(bear)]], option: (l) => { labels = l; return [l.findIndex((x) => /lifelink/.test(x))]; } });
    expect(labels.join(',')).toMatch(/flying.*first strike.*lifelink.*vigilance/);
    expect(countersOf(s, bear, '+1/+1')).toBe(1);
    expect(countersOf(s, bear, 'lifelink')).toBe(1);
    expect(countersOf(s, bear, 'flying')).toBe(0);
    expect(hasKeyword(getChars(s, bear), 'lifelink')).toBe(true);
    expect(loyaltyOf(s, me)).toBe(6);
  });
  it('the negative case: with no target chosen ("up to one"), no counter is put anywhere and the loyalty is still gained', () => {
    let s = setup();
    const me = find(s, 'Test Radiant', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = activateText(s, me, /^\+1/, { targets: [[]], option: () => [0] });
    expect(Object.keys(s.objects[bear]!.counters).length).toBe(0);
    expect(loyaltyOf(s, me)).toBe(6);
  });
  it('−3 puts a permanent card with mana value 3 or less onto the battlefield with a shield counter; a bigger one is never offered; the rest go to the bottom', () => {
    let s = setup();
    const me = find(s, 'Test Radiant', 'battlefield', 'p1');
    const big = find(s, 'Test Big Golem', 'library', 'p1');
    let offered: ObjectId[] = [];
    s = activateText(s, me, /^[−-]3/, { pick: (_s, o) => { offered = o; return o.slice(0, 1); } });
    expect(offered).not.toContain(big);
    const small = find(s, 'Test Small Golem', 'battlefield', 'p1');
    expect(countersOf(s, small, 'shield')).toBe(1);
    expect(s.zones.library['p1']!.slice(-6).map((id) => s.defs[s.objects[id]!.defId]!.name)).toContain('Test Big Golem');
    expect(loyaltyOf(s, me)).toBe(2);
  });
  it('the negative case: declining puts nothing onto the battlefield', () => {
    let s = setup();
    const me = find(s, 'Test Radiant', 'battlefield', 'p1');
    const before = s.zones.library['p1']!.length;
    s = activateText(s, me, /^[−-]3/, { pick: () => [] });
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.counters['shield'])).toEqual([]);
    expect(s.zones.library['p1']!.length).toBe(before);
  });
});

// ---- The Wandering Emperor: loyalty abilities at instant speed as long as it entered this turn -------------------------------------------------------------------

const WANDERER = card('Test Wanderer', 'Legendary Planeswalker — Testy',
  'Flash\nAs long as Test Wanderer entered this turn, you may activate her loyalty abilities any time you could cast an instant.\n+1: You gain 1 life.\n−2: Exile target tapped creature. You gain 2 life.',
  { loyalty: '3' });
const QUICK = card('Test Quick Thought', 'Instant', 'You gain 1 life.');

describe('CR 606.3, 307.1: "As long as ~ entered this turn, you may activate her loyalty abilities any time you could cast an instant." (The Wandering Emperor)', () => {
  const setup = (onBattlefield: boolean): GameState => mpScenario({
    defs: [WANDERER, QUICK, BEAR],
    zones: { p1: { hand: ['Test Quick Thought', ...(onBattlefield ? [] : ['Test Wanderer'])], battlefield: onBattlefield ? [{ name: 'Test Wanderer', counters: { loyalty: 3 } }] : [] }, p2: { battlefield: ['Test Bear'] } },
  } as never);
  it('is automated', () => { expect(full(WANDERER)).toBe(true); });
  it('the turn it entered, its loyalty abilities may be activated while a spell is on the stack (instant timing; ruling: still once each turn)', () => {
    let s = setup(false);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Wanderer', 'hand', 'p1') }));
    const me = find(s, 'Test Wanderer', 'battlefield', 'p1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick Thought', 'hand', 'p1') }));
    expect(s.zones.stack.length).toBe(1);
    expect(offeredOn(s, me).map((x) => x.text).join(' | ')).toMatch(/\+1: You gain 1 life/);
    s = activateText(s, me, /^\+1/);
    expect(loyaltyOf(s, me)).toBe(4);
    // once each turn (CR 606.3): no second loyalty ability this turn
    expect(offeredOn(s, me)).toEqual([]);
  });
  it('the negative case: one that did not enter this turn has only sorcery timing (nothing offered while a spell is on the stack)', () => {
    let s = setup(true);
    const me = find(s, 'Test Wanderer', 'battlefield', 'p1');
    expect(offeredOn(s, me).length).toBeGreaterThan(0); // main phase, empty stack: sorcery timing
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quick Thought', 'hand', 'p1') }));
    expect(s.zones.stack.length).toBe(1);
    expect(offeredOn(s, me)).toEqual([]);
  });
});

// ---- Sarkhan the Masterless: "Until end of turn, each planeswalker you control becomes a 4/4 red Dragon creature and gains flying." -----------------------------

const MASTERLESS = card('Test Masterless', 'Legendary Planeswalker — Testy', '+1: Until end of turn, each planeswalker you control becomes a 4/4 red Dragon creature and gains flying.', { loyalty: '5' });
const OTHER_PW = card('Test Other Walker', 'Legendary Planeswalker — Othery', '+1: You gain 1 life.', { loyalty: '3' });
const LATE_PW = card('Test Late Walker', 'Legendary Planeswalker — Latey', '+1: You gain 1 life.', { loyalty: '2' });
const PING = card('Test Ping', 'Instant', 'Test Ping deals 2 damage to any target.');

describe('CR 205.1a, 611.2c, 613.1d: "Until end of turn, each planeswalker you control becomes a 4/4 red Dragon creature and gains flying." (Sarkhan the Masterless)', () => {
  const setup = (): GameState => mpScenario({
    defs: [MASTERLESS, OTHER_PW, LATE_PW, PING],
    zones: {
      p1: { battlefield: [{ name: 'Test Masterless', counters: { loyalty: 5 } }, { name: 'Test Other Walker', counters: { loyalty: 3 } }], hand: ['Test Late Walker', 'Test Ping'] },
      p2: { battlefield: [{ name: 'Test Other Walker', counters: { loyalty: 3 } }] },
    },
  } as never);
  it('is automated', () => { expect(full(MASTERLESS)).toBe(true); });
  it('each planeswalker you control (itself too) is a 4/4 red Dragon creature with flying and no longer a planeswalker; loyalty counters stay (ruling 2019-05-03)', () => {
    let s = setup();
    const me = find(s, 'Test Masterless', 'battlefield', 'p1');
    const other = find(s, 'Test Other Walker', 'battlefield', 'p1');
    const theirs = find(s, 'Test Other Walker', 'battlefield', 'p2');
    s = activateText(s, me, /^\+1/);
    for (const id of [me, other]) {
      const c = getChars(s, id);
      expect(c.types).toEqual(['Creature']);
      expect(c.subtypes).toEqual(['Dragon']);
      expect(c.colors).toEqual(['R']);
      expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
      expect(hasKeyword(c, 'flying')).toBe(true);
    }
    expect(loyaltyOf(s, me)).toBe(6);
    expect(loyaltyOf(s, other)).toBe(3);
    // the negative case: an opponent's planeswalker is not affected
    expect(getChars(s, theirs).types).toEqual(['Planeswalker']);
    // ruling 2019-05-03: the other one's loyalty ability can still be activated this turn
    expect(offeredOn(s, other).map((x) => x.text).join(' | ')).toMatch(/\+1: You gain 1 life/);
  });
  it('damage dealt to one of them while it is not a planeswalker removes no loyalty (ruling 2019-05-03); a planeswalker that enters later is not affected (CR 611.2c)', () => {
    let s = setup();
    const me = find(s, 'Test Masterless', 'battlefield', 'p1');
    s = activateText(s, me, /^\+1/);
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ping', 'hand', 'p1') }), { targets: [[obj(me)]] }));
    expect(loyaltyOf(s, me)).toBe(6);
    expect(s.objects[me]!.damage ?? 0).toBe(2);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Late Walker', 'hand', 'p1') }));
    const late = find(s, 'Test Late Walker', 'battlefield', 'p1');
    expect(getChars(s, late).types).toEqual(['Planeswalker']);
  });
});

// ---- Valki, God of Lies: each opponent reveals their hand, one creature card of each exiled until it leaves; {X}: become a copy of one with mana value X ---------

const LIAR = card('Test Liar', 'Legendary Creature — God', 'When Test Liar enters, each opponent reveals their hand. For each opponent, exile a creature card they revealed this way until Test Liar leaves the battlefield.\n{X}: Choose a creature card exiled with Test Liar with mana value X. Test Liar becomes a copy of that card.', { pt: ['2', '1'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { cost: '{2}', pt: ['3', '3'] });
const GIANT = card('Test Giant', 'Creature — Giant', '', { cost: '{3}', pt: ['5', '5'] });
const SPELL = card('Test Sorcery', 'Sorcery', 'You gain 1 life.');

describe('CR 701.20a, 610.3, 607.2a, 707.2: Valki, God of Lies ("For each opponent, exile a creature card they revealed this way until ~ leaves the battlefield."; "{X}: ... becomes a copy of that card.")', () => {
  const setup = (): GameState => mpScenario({
    defs: [LIAR, OGRE, GIANT, SPELL, PING],
    zones: {
      p1: { hand: ['Test Liar', 'Test Ping'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] },
      p2: { hand: ['Test Ogre', 'Test Sorcery'] },
      p3: { hand: ['Test Sorcery'] },
      p4: { hand: ['Test Giant', 'Test Ogre'] },
    },
  } as never);
  it('is automated', () => { expect(full(LIAR)).toBe(true); });
  const enter = (): { s: GameState; offeredBy: Record<string, string[]> } => {
    let s = setup();
    const offeredBy: Record<string, string[]> = {};
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Liar', 'hand', 'p1') }), {
      pick: (st, o) => {
        const owner = st.objects[o[0]!]!.owner;
        offeredBy[owner] = o.map((id) => st.defs[st.objects[id]!.defId]!.name);
        return [o.find((id) => /Giant|Ogre/.test(st.defs[st.objects[id]!.defId]!.name))!];
      },
    });
    return { s, offeredBy };
  };
  it('you choose one creature card of each opponent\'s hand (never a noncreature card, nothing from a hand with none) and exile it', () => {
    const { s, offeredBy } = enter();
    expect(offeredBy['p2'] ?? ['Test Ogre']).toEqual(['Test Ogre']); // its one creature card (no choice to make)
    expect(offeredBy['p3']).toBeUndefined();
    expect([...offeredBy['p4']!].sort()).toEqual(['Test Giant', 'Test Ogre']);
    const exiled = s.zones.exile.map((id) => `${s.objects[id]!.owner}:${s.defs[s.objects[id]!.defId]!.name}`).sort();
    expect(exiled).toEqual(['p2:Test Ogre', 'p4:Test Giant']);
    expect(s.zones.hand['p2']!.length).toBe(1);
    expect(s.zones.hand['p4']!.length).toBe(1);
  });
  it('{X}: with X equal to an exiled card\'s mana value it becomes a copy of that card; with no such card, nothing happens (ruling 2021-02-05)', () => {
    let { s } = enter();
    const me = find(s, 'Test Liar', 'battlefield', 'p1');
    s = settle(drive(act(s, { type: 'activate', player: 'p1', source: me, ability: offeredOn(s, me)[0]!.key } as never), { n: 1 }), { n: 1 });
    expect(getChars(s, me).names).toContain('Test Liar');
    s = settle(drive(act(s, { type: 'activate', player: 'p1', source: me, ability: offeredOn(s, me)[0]!.key } as never), { n: 2 }), { n: 2, pick: (_st, o) => o.slice(0, 1) });
    const c = getChars(s, me);
    expect(c.names).toContain('Test Ogre');
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
  });
  it('when it leaves the battlefield, the exiled cards return to their owners\' hands (CR 610.3)', () => {
    let { s } = enter();
    const me = find(s, 'Test Liar', 'battlefield', 'p1');
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ping', 'hand', 'p1') }), { targets: [[obj(me)]] }));
    expect(s.zones.exile.length).toBe(0);
    expect(s.zones.hand['p2']!.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Test Ogre', 'Test Sorcery']);
    expect(s.zones.hand['p4']!.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Test Giant', 'Test Ogre']);
  });
});

// ---- Tibalt, Cosmic Impostor: "As ~ enters, you get an emblem with "You may play cards exiled with ~, and you may spend mana as though ..."" -------------------

const IMPOSTOR = card('Test Impostor', 'Legendary Planeswalker — Testy',
  'As Test Impostor enters, you get an emblem with "You may play cards exiled with Test Impostor, and you may spend mana as though it were mana of any color to cast those spells."\n+2: Exile the top card of each player\'s library.\n−3: Exile target artifact or creature.',
  { loyalty: '5' });
const RED = card('Test Red Brute', 'Creature — Ogre', '', { cost: '{R}', pt: ['2', '2'], colors: ['R'] });
const DOOM = card('Test Doom', 'Instant', 'Destroy target permanent.');
const BANISH = card('Test Banish', 'Instant', 'Exile target permanent.');

describe('CR 614.12, 114.2, 607.2a: "As ~ enters, you get an emblem with "You may play cards exiled with ~ ..."" (Tibalt, Cosmic Impostor)', () => {
  const setup = (): GameState => mpScenario({
    defs: [IMPOSTOR, RED, DOOM, BEAR, OGRE, BANISH],
    zones: {
      p1: { hand: ['Test Impostor', 'Test Doom', 'Test Banish'], battlefield: ['Plains', 'Plains', 'Plains'] },
      p2: { library: ['Test Red Brute'], battlefield: ['Test Bear'] },
      p3: { battlefield: ['Test Ogre'] },
    },
  } as never);
  it('is automated', () => { expect(full(IMPOSTOR)).toBe(true); });
  it('the emblem lets you play the cards its abilities exile, spending mana as any color; still after it has left (ruling 2021-02-05)', () => {
    let s = setup();
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Impostor', 'hand', 'p1') }));
    const me = find(s, 'Test Impostor', 'battlefield', 'p1');
    expect(s.zones.command.filter((id) => s.objects[id]!.kind === 'emblem' && s.objects[id]!.owner === 'p1').length).toBe(1);
    s = activateText(s, me, /^\+2/);
    const brute = find(s, 'Test Red Brute', 'exile', 'p2');
    const castable = (st: GameState): boolean => legalActions(st, 'p1').some((l) => l.kind === 'cast' && (l.action as { card?: ObjectId }).card === brute);
    expect(castable(s)).toBe(true);
    // it leaves the battlefield: the emblem still reads its exiled cards
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand', 'p1') }), { targets: [[obj(me)]] }));
    expect(s.zones.battlefield).not.toContain(me);
    expect(castable(s)).toBe(true);
    s = settle(act(s, { type: 'cast', player: 'p1', card: brute }));
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Red Brute' && s.objects[id]!.controller === 'p1')).toBe(true);
  });
  it('the negative case: a card exiled by something else is not playable with the emblem', () => {
    let s = setup();
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Impostor', 'hand', 'p1') }));
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const me = find(s, 'Test Impostor', 'battlefield', 'p1');
    s = activateText(s, me, /^[−-]3/, { targets: [[obj(bear)]] });
    const exiledBear = find(s, 'Test Bear', 'exile', 'p2');
    expect(legalActions(s, 'p1').some((l) => l.kind === 'cast' && (l.action as { card?: ObjectId }).card === exiledBear)).toBe(true); // exiled WITH it: playable
    // the negative case (review of edh-next-137): a card another spell exiled is not playable with the emblem
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p3');
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Banish', 'hand', 'p1') }), { targets: [[obj(ogre)]] }));
    const exiledOgre = find(s, 'Test Ogre', 'exile', 'p3');
    expect(legalActions(s, 'p1').some((l) => l.kind === 'cast' && (l.action as { card?: ObjectId }).card === exiledOgre)).toBe(false);
  });
});

// ---- Comet, Stellar Pup: loyalty symbols inside a die-roll table, damage to "a creature or player", "two more times this turn" ----------------------------------

const PUP = card('Test Pup', 'Legendary Planeswalker — Testy',
  '0: Roll a six-sided die.\n1 or 2 — [+2], then create two 1/1 green Squirrel creature tokens. They gain haste until end of turn.\n3 — [−1], then return a card with mana value 2 or less from your graveyard to your hand.\n'
  + '4 or 5 — Test Pup deals damage equal to the number of loyalty counters on him to a creature or player, then [−2].\n6 — [+1], and you may activate Test Pup\'s loyalty ability two more times this turn.',
  { loyalty: '5' });

describe('CR 606.1, 706.3a, 120.3, 606.3: Comet, Stellar Pup (each row of its die roll, the loyalty symbols, "a creature or player", "two more times this turn")', () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => `edhn137-pup-${i}`);
  const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d6: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
  const setup = (seed: string): GameState => mpScenario({
    defs: [PUP, OGRE, GIANT],
    seed,
    zones: { p1: { battlefield: [{ name: 'Test Pup', counters: { loyalty: 5 } }], graveyard: ['Test Ogre', 'Test Giant'] } },
  } as never);
  it('is automated', () => { expect(full(PUP)).toBe(true); });
  it('every row does what it says, read from the result the game rolled (the rulings 2022-10-07: the symbols put or remove loyalty counters; no targets)', () => {
    const seen = new Set<number>();
    for (const seed of SEEDS) {
      let s = setup(seed);
      const me = find(s, 'Test Pup', 'battlefield', 'p1');
      const life0 = s.players.find((p) => p.id === 'p2')!.life;
      s = activateText(s, me, /^0/, { option: (l) => [Math.max(0, l.findIndex((x) => /a player|Bob/.test(x)))], pick: (_st, o) => o.slice(0, 1) });
      const r = rolled(s);
      expect(r.length, seed).toBe(1);
      const n = r[0]!;
      seen.add(n);
      const squirrels = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
      const hand = s.zones.hand['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name);
      if (n <= 2) {
        expect(loyaltyOf(s, me), seed).toBe(7);
        expect(squirrels.length, seed).toBe(2);
        for (const t of squirrels) expect(hasKeyword(getChars(s, t), 'haste')).toBe(true);
      } else if (n === 3) {
        expect(loyaltyOf(s, me), seed).toBe(4);
        expect(hand, seed).toContain('Test Ogre');
        expect(hand, seed).not.toContain('Test Giant'); // mana value 3: never returned
      } else if (n <= 5) {
        expect(s.players.find((p) => p.id === 'p2')!.life, seed).toBe(life0 - 5); // 5 damage: the loyalty as the damage is dealt
        expect(loyaltyOf(s, me), seed).toBe(3);
      } else {
        expect(loyaltyOf(s, me), seed).toBe(6);
        // two more activations of its loyalty ability this turn, and no fourth one
        s = activateText(s, me, /^0/, { option: (l) => [Math.max(0, l.findIndex((x) => /a player|Bob/.test(x)))], pick: (_st, o) => o.slice(0, 1) });
        s = activateText(s, me, /^0/, { option: (l) => [Math.max(0, l.findIndex((x) => /a player|Bob/.test(x)))], pick: (_st, o) => o.slice(0, 1) });
        if (s.zones.battlefield.includes(me) && !rolled(s).slice(1).includes(6)) expect(offeredOn(s, me), seed).toEqual([]); // (another 6 gives two more again)
      }
      expect(squirrels.length === 0 || n <= 2 || n === 6, seed).toBe(true);
    }
    expect([...seen].sort().join(','), 'the seeds cover every result').toBe('1,2,3,4,5,6');
  });
  it('the negative case: without a 6, its loyalty ability is activated only once this turn', () => {
    for (const seed of SEEDS) {
      let s = setup(seed);
      const me = find(s, 'Test Pup', 'battlefield', 'p1');
      s = activateText(s, me, /^0/, { option: (l) => [Math.max(0, l.findIndex((x) => /a player|Bob/.test(x)))], pick: (_st, o) => o.slice(0, 1) });
      if (rolled(s)[0] === 6) continue;
      expect(offeredOn(s, me), seed).toEqual([]);
    }
  });
});

// ---- Nissa, Steward of Elements: loyalty X, "a land card or a creature card with mana value ...", lands become 5/5 Elementals ---------------------------------

const STEWARD = card('Test Steward', 'Legendary Planeswalker — Testy',
  '+2: Scry 2.\n0: Look at the top card of your library. If it\'s a land card or a creature card with mana value less than or equal to the number of loyalty counters on Test Steward, you may put that card onto the battlefield.\n'
  + '−6: Untap up to two target lands you control. They become 5/5 Elemental creatures with flying and haste until end of turn. They\'re still lands.',
  { loyalty: 'X', cost: '{X}' });
const FOREST = card('Test Grove', 'Land — Forest', '');

describe('CR 107.3m, 306.5b, 608.2c, 205.1b: Nissa, Steward of Elements (loyalty X, "a land card or a creature card with mana value ...", lands that become creatures)', () => {
  const setup = (top: string[], loyalty?: number): GameState => mpScenario({
    defs: [STEWARD, OGRE, GIANT, FOREST],
    zones: { p1: { hand: loyalty === undefined ? ['Test Steward'] : [], battlefield: [...(loyalty === undefined ? [] : [{ name: 'Test Steward', counters: { loyalty } }]), 'Plains', 'Plains', 'Plains', 'Test Grove'], library: ['Plains', ...top] } },
  } as never);
  it('is automated', () => { expect(full(STEWARD)).toBe(true); });
  it('enters with X loyalty counters (the X it was cast with); with X = 0 it has none and is put into the graveyard (ruling 2017-04-18)', () => {
    let s = setup([]);
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Steward', 'hand', 'p1') }), { n: 3 }), { n: 3 });
    expect(loyaltyOf(s, find(s, 'Test Steward', 'battlefield', 'p1'))).toBe(3);
    let z = setup([]);
    z = settle(drive(act(z, { type: 'cast', player: 'p1', card: find(z, 'Test Steward', 'hand', 'p1') }), { n: 0 }), { n: 0 });
    expect(z.zones.battlefield.some((id) => z.defs[z.objects[id]!.defId]!.name === 'Test Steward')).toBe(false);
    expect(z.zones.graveyard['p1']!.some((id) => z.defs[z.objects[id]!.defId]!.name === 'Test Steward')).toBe(true);
  });
  it('0: a land card or a creature card with mana value up to its loyalty may be put onto the battlefield; a bigger creature stays on top (ruling 2017-04-18)', () => {
    for (const [top, ok] of [['Test Grove', true], ['Test Ogre', true], ['Test Giant', false]] as const) {
      let s = setup([top], 2);
      const me = find(s, 'Test Steward', 'battlefield', 'p1');
      s = activateText(s, me, /^0/, { yes: true });
      const onBf = s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === top).length;
      expect(onBf, top).toBe(top === 'Test Grove' ? (ok ? 2 : 1) : ok ? 1 : 0);
      if (!ok) expect(s.defs[s.objects[s.zones.library['p1']![0]!]!.defId]!.name).toBe(top);
    }
  });
  it('−6: up to two target lands you control untap and are 5/5 Elemental creatures with flying and haste until end of turn, still lands', () => {
    let s = setup([], 7);
    const me = find(s, 'Test Steward', 'battlefield', 'p1');
    const grove = find(s, 'Test Grove', 'battlefield', 'p1');
    s.objects[grove]!.tapped = true;
    s = activateText(s, me, /^[−-]6/, { targets: [[obj(grove)]] });
    const c = getChars(s, grove);
    expect(s.objects[grove]!.tapped).toBe(false);
    expect([...c.types].sort()).toEqual(['Creature', 'Land']);
    expect(c.subtypes).toContain('Elemental');
    expect(c.subtypes).toContain('Forest');
    expect([Number(c.power), Number(c.toughness)]).toEqual([5, 5]);
    expect(hasKeyword(c, 'flying') && hasKeyword(c, 'haste')).toBe(true);
  });
});

// ---- Karn Liberated: "Restart the game, leaving in exile all non-Aura permanent cards exiled with ~. Then put those cards onto the battlefield under your control." ---

const LIBERATED = card('Test Liberated', 'Legendary Planeswalker — Testy',
  '+4: Target player exiles a card from their hand.\n−3: Exile target permanent.\n−14: Restart the game, leaving in exile all non-Aura permanent cards exiled with Test Liberated. Then put those cards onto the battlefield under your control.',
  { loyalty: '6' });
const AURA = card('Test Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1.');

describe('CR 727.1, 727.1a, 727.2, 727.4, 727.5: Karn Liberated ("Restart the game, leaving in exile all non-Aura permanent cards exiled with ~ ...")', () => {
  const setup = (): GameState => mpScenario({
    defs: [LIBERATED, BEAR, AURA, OGRE, BANISH],
    zones: {
      p1: { battlefield: [{ name: 'Test Liberated', counters: { loyalty: 30 } }], hand: ['Test Banish'] },
      p2: { battlefield: ['Test Bear', 'Test Ogre'], hand: ['Test Aura'] },
      p3: { battlefield: ['Test Ogre'] },
    },
  } as never);
  it('is automated', () => { expect(full(LIBERATED)).toBe(true); });
  it('the game restarts: the restarting player takes the first turn, life and hands start over, and only the non-Aura permanent cards exiled WITH it go onto the battlefield under its controller', () => {
    let s = setup();
    const me = find(s, 'Test Liberated', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = activateText(s, me, /^[−-]3/, { targets: [[obj(bear)]] });
    s.turnActivations = {}; // (the test's shortcut for a later turn: one loyalty ability each turn, CR 606.3)
    s = activateText(s, me, /^\+4/, { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]], pick: (_st, o) => o.slice(0, 1) }); // p2 exiles the Aura card (exiled with it, but an Aura)
    // another permanent exiled by something else is not kept
    const ogre3 = find(s, 'Test Ogre', 'battlefield', 'p3');
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Banish', 'hand', 'p1') }), { targets: [[obj(ogre3)]] }));
    s.players.find((p) => p.id === 'p2')!.life = 7;
    s.turnActivations = {};
    s = activateText(s, me, /^[−-]14/);
    expect(s.stage).toBe('playing');
    expect(s.turn.number).toBe(1);
    expect(s.turn.activePlayer).toBe('p1');
    for (const p of s.players) expect(p.life, p.id).toBe(20);
    for (const p of ['p1', 'p2', 'p3', 'p4']) expect(s.zones.hand[p]!.length, p).toBe(7);
    const names = (ids: readonly ObjectId[]): string[] => ids.map((id) => `${s.objects[id]!.owner}:${s.defs[s.objects[id]!.defId]!.name}`);
    expect(names(s.zones.battlefield)).toEqual(['p2:Test Bear']);
    expect(s.objects[s.zones.battlefield[0]!]!.controller).toBe('p1');
    expect(s.zones.exile).toEqual([]);
    expect(s.zones.command.filter((id) => s.objects[id]!.kind === 'emblem')).toEqual([]);
    // every other card of each player is back in that player's deck (library or opening hand): the Aura, the other Ogres, Karn itself, the instant
    const owned = (p: string): string[] => [...s.zones.library[p]!, ...s.zones.hand[p]!].map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(owned('p1')).toEqual(expect.arrayContaining(['Test Liberated', 'Test Banish']));
    expect(owned('p2')).toEqual(expect.arrayContaining(['Test Aura', 'Test Ogre']));
    expect(owned('p2')).not.toContain('Test Bear');
    expect(owned('p3')).toContain('Test Ogre');
  });
  it('the negative case: with no card exiled with it, nothing is put onto the battlefield', () => {
    let s = setup();
    const me = find(s, 'Test Liberated', 'battlefield', 'p1');
    s = activateText(s, me, /^[−-]14/);
    expect(s.turn.number).toBe(1);
    expect(s.zones.battlefield).toEqual([]);
  });
});

// ---- Kaito, Dancing Shadow: "you may return one of them to its owner's hand. If you do, you may activate loyalty abilities of ~ twice this turn ..." ------------

const SHADOW = card('Test Shadow', 'Legendary Planeswalker — Testy',
  'Whenever one or more creatures you control deal combat damage to a player, you may return one of them to its owner\'s hand. If you do, you may activate loyalty abilities of Test Shadow twice this turn rather than only once.\n0: Draw a card.\n+1: You gain 1 life.',
  { loyalty: '3' });
const NINJA = card('Test Ninja', 'Creature — Ninja', '', { pt: ['1', '1'] });

describe('CR 603.2c, 608.2d, 606.3: Kaito, Dancing Shadow (return one of the creatures that dealt combat damage; loyalty abilities twice this turn)', () => {
  const setup = (): GameState => mpScenario({
    defs: [SHADOW, NINJA, BEAR],
    zones: { p1: { battlefield: [{ name: 'Test Shadow', counters: { loyalty: 3 } }, 'Test Ninja', 'Test Bear'] } },
  } as never);
  const play = (yes: boolean): GameState => {
    let s = setup();
    const ninja = find(s, 'Test Ninja', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = passUntilDecision(s, (x) => x.pending?.kind === 'declareAttackers');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: ninja, defender: 'p2' }, { attacker: bear, defender: 'p2' }] } as never);
    s = passUntilDecision(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority' && x.zones.stack.length === 0, { yes, pick: (st, o) => o.filter((id) => st.defs[st.objects[id]!.defId]!.name === 'Test Ninja') });
    return s;
  };
  function passUntilDecision(s0: GameState, done: (s: GameState) => boolean, script: Script = {}): GameState {
    let s = s0;
    for (let i = 0; i < 300; i++) {
      if (done(s)) return s;
      if (s.pending?.kind === 'declareBlockers') { s = answer(s, { kind: 'declareBlockers', blocks: [] }); continue; }
      if (s.pending?.kind === 'declareAttackers') { s = answer(s, { kind: 'declareAttackers', attacks: [] }); continue; }
      if (s.pending && s.pending.kind !== 'priority') { s = drive(s, script); continue; }
      s = act(s, { type: 'pass', player: s.pending!.player });
    }
    throw new Error('never reached');
  }
  it('is automated', () => { expect(full(SHADOW)).toBe(true); });
  it('returning one of them lets its loyalty abilities be activated twice this turn (rulings 2023-02-04: the same one twice, or two different ones)', () => {
    let s = play(true);
    expect(s.zones.hand['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Ninja')).toBe(true);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(true);
    const me = find(s, 'Test Shadow', 'battlefield', 'p1');
    s = activateText(s, me, /^0/);
    s = activateText(s, me, /^\+1/);
    expect(loyaltyOf(s, me)).toBe(4);
    expect(offeredOn(s, me)).toEqual([]); // never a third (not additive)
  });
  it('the negative case: declining to return a creature leaves the one-each-turn limit', () => {
    let s = play(false);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Ninja')).toBe(true);
    const me = find(s, 'Test Shadow', 'battlefield', 'p1');
    s = activateText(s, me, /^0/);
    expect(offeredOn(s, me)).toEqual([]);
  });
});

// ---- Ob Nixilis, the Adversary: "Casualty X. The copy isn't legendary and has starting loyalty X." -----------------------------------------------------------

const ADVERSARY = card('Test Adversary', 'Legendary Planeswalker — Testy', 'Casualty X. The copy isn\'t legendary and has starting loyalty X.\n+1: You gain 1 life.', { loyalty: '3' });
const FODDER = card('Test Fodder', 'Creature — Brute', '', { pt: ['5', '5'] });

describe('CR 702.153a, 601.2b, 707.9b, 707.10, 306.5b: "Casualty X. The copy isn\'t legendary and has starting loyalty X." (Ob Nixilis, the Adversary)', () => {
  const setup = (): GameState => mpScenario({ defs: [ADVERSARY, FODDER], zones: { p1: { hand: ['Test Adversary'], battlefield: ['Test Fodder'] } } } as never);
  it('is automated', () => { expect(full(ADVERSARY)).toBe(true); });
  const named = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Adversary');
  it('with the casualty cost paid (X chosen, a creature with power X or greater sacrificed), a nonlegendary token copy with X loyalty enters too (rulings 2022-04-29)', () => {
    let s = setup();
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Adversary', 'hand', 'p1') }), { yes: true, n: 4, pick: (_st, o) => o.slice(0, 1) }), { yes: true, n: 4, pick: (_st, o) => o.slice(0, 1) });
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Fodder')).toBe(false);
    const both = named(s);
    expect(both.length).toBe(2);
    const token = both.find((id) => s.objects[id]!.kind === 'token')!;
    const card0 = both.find((id) => s.objects[id]!.kind === 'card')!;
    expect(getChars(s, token).supertypes).not.toContain('Legendary');
    expect(loyaltyOf(s, token)).toBe(4);
    expect(getChars(s, card0).supertypes).toContain('Legendary');
    expect(loyaltyOf(s, card0)).toBe(3);
  });
  it('the negative case: without the casualty cost there is no copy (and X is 0)', () => {
    let s = setup();
    s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Adversary', 'hand', 'p1') }), { yes: false }), { yes: false });
    expect(named(s).length).toBe(1);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Fodder')).toBe(true);
  });
});

// ---- Gideon Blackblade: "During your turn, ~ is a 4/4 Human Soldier creature with indestructible that's still a planeswalker."; "up to one other target creature" -----

const BLACKBLADE = card('Test Blackblade', 'Legendary Planeswalker — Gideon',
  'During your turn, Test Blackblade is a 4/4 Human Soldier creature with indestructible that\'s still a planeswalker.\nPrevent all damage that would be dealt to Test Blackblade during your turn.\n'
  + '+1: Up to one other target creature you control gains your choice of vigilance, lifelink, or indestructible until end of turn.\n−6: Exile target nonland permanent.',
  { loyalty: '4' });

describe('CR 611.3a, 613.1d, 109.2, 115.3: Gideon Blackblade (a creature during your turn that is still a planeswalker; "up to one other target creature you control")', () => {
  const setup = (): GameState => mpScenario({
    defs: [BLACKBLADE, BEAR],
    zones: { p1: { battlefield: [{ name: 'Test Blackblade', counters: { loyalty: 4 } }, 'Test Bear'] } },
  } as never);
  it('is automated', () => { expect(full(BLACKBLADE)).toBe(true); });
  it('during your turn it is a 4/4 Human Soldier creature with indestructible and still a Gideon planeswalker; on another player\'s turn it is not a creature', () => {
    let s = setup();
    const me = find(s, 'Test Blackblade', 'battlefield', 'p1');
    let c = getChars(s, me);
    expect([...c.types].sort()).toEqual(['Creature', 'Planeswalker']);
    expect(c.subtypes).toEqual(expect.arrayContaining(['Gideon', 'Human', 'Soldier']));
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
    expect(hasKeyword(c, 'indestructible')).toBe(true);
    expect(loyaltyOf(s, me)).toBe(4);
    for (let i = 0; i < 400 && s.turn.activePlayer === 'p1'; i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending && s.pending.kind !== 'priority') s = drive(s);
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    expect(s.turn.activePlayer).toBe('p2');
    c = getChars(s, me);
    expect(c.types).toEqual(['Planeswalker']);
    expect(hasKeyword(c, 'indestructible')).toBe(false);
  });
  it('+1: the target is another creature you control (never itself, a creature now); the keyword is chosen as it resolves (ruling 2019-05-03)', () => {
    let s = setup();
    const me = find(s, 'Test Blackblade', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const hit = offeredOn(s, me).find((x) => /^\+1/.test(x.text))!;
    s = act(s, { type: 'activate', player: 'p1', source: me, ability: hit.key } as never);
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.pending?.kind).toBe('chooseTargets');
    const offered = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(offered).toContain(bear);
    expect(offered).not.toContain(me);
    s = settle(drive(s, { targets: [[obj(bear)]] }), { option: (l) => [l.findIndex((x) => /lifelink/.test(x))] });
    expect(hasKeyword(getChars(s, bear), 'lifelink')).toBe(true);
    expect(hasKeyword(getChars(s, bear), 'vigilance')).toBe(false);
  });
});

describe('CR 727.2, 730.2, 727.5a, 903.6: Karn Liberated in a merged permanent\'s and a Commander game\'s restart (review of edh-next-137)', () => {
  const legend = (name: string): CardDef => card(name, 'Legendary Creature — Human', '', { cost: '{1}{W}', pt: ['3', '3'], colors: ['W'] });
  it('every card of a merged permanent is a card of its owner in the new game (CR 727.2, 730.2)', () => {
    let s = mpScenario({
      defs: [LIBERATED, BEAR, OGRE],
      zones: { p1: { battlefield: [{ name: 'Test Liberated', counters: { loyalty: 30 } }] }, p2: { battlefield: ['Test Bear'] } },
      setup: (x: GameState) => {
        const id = x.zones.battlefield.find((o) => x.defs[x.objects[o]!.defId]!.name === 'Test Bear')!;
        x.objects[id]!.components = [{ kind: 'card', defId: BEAR.id, cardId: x.objects[id]!.cardId, owner: 'p2', mergedAt: 5 } as never, { kind: 'card', defId: OGRE.id, cardId: 'c9999', owner: 'p2' } as never];
      },
    } as never);
    const me = find(s, 'Test Liberated', 'battlefield', 'p1');
    s = activateText(s, me, /^[−-]14/);
    const owned = [...s.zones.library['p2']!, ...s.zones.hand['p2']!].map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(owned.filter((n) => n === 'Test Bear').length).toBe(1);
    expect(owned.filter((n) => n === 'Test Ogre').length).toBe(1);
  });
  it('in a Commander game: life 40 again, commander casts back to 0, a commander exiled with Karn comes onto the battlefield, the others are in the command zone', () => {
    const cmds = { p1: [legend('Test Alpha Captain')], p2: [legend('Test Beta Captain')], p3: [legend('Test Gamma Captain')], p4: [legend('Test Delta Captain')] };
    let s = mpScenario({
      defs: [LIBERATED], commanders: cmds, options: { commander: commanderOptions('commander') },
      zones: { p1: { battlefield: [{ name: 'Test Liberated', counters: { loyalty: 30 } }] } },
      setup: (x: GameState) => {
        const id = x.zones.command.find((o) => x.defs[x.objects[o]!.defId]!.name === 'Test Gamma Captain')!;
        x.zones.command = x.zones.command.filter((o) => o !== id); x.zones.battlefield.push(id); x.objects[id] = { ...x.objects[id]!, zone: 'battlefield', controlledSinceTurn: 0 };
        x.players.find((p) => p.id === 'p2')!.commanders![0]!.casts = 3;
      },
    } as never);
    const me = find(s, 'Test Liberated', 'battlefield', 'p1');
    const gamma = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Gamma Captain')!;
    const keepExiled = (st: GameState): GameState => (st.pending?.kind === ('commanderZone' as never) ? answer(st, { kind: 'commanderZone', command: false } as never) : st);
    s = activateText(s, me, /^[−-]3/, { targets: [[obj(gamma)]] });
    s = keepExiled(s);
    for (let i = 0; i < 10 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = keepExiled(drive(act(s, { type: 'pass', player: s.pending.player })));
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Gamma Captain')).toBe(true);
    s.turnActivations = {};
    s = activateText(s, me, /^[−-]14/);
    expect(s.turn.activePlayer).toBe('p1');
    for (const p of s.players) expect(p.life, p.id).toBe(40);
    expect(s.players.find((p) => p.id === 'p2')!.commanders![0]!.casts).toBe(0);
    const bf = s.zones.battlefield.map((id) => `${s.defs[s.objects[id]!.defId]!.name}:${s.objects[id]!.controller}`);
    expect(bf).toEqual(['Test Gamma Captain:p1']);
    const cmd = s.zones.command.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
    expect(cmd).toEqual(['Test Alpha Captain', 'Test Beta Captain', 'Test Delta Captain']);
  });
});
