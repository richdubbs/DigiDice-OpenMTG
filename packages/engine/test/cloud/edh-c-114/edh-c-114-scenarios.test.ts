/**
 * Commander lane edh-c, round edh-c-114 (EDHREC ranks 19,001-19,500, third pass): the round's readings played through the engine with synthetic cards (invented names),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked
 * against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 120.3, 119.3, 608.2c, 105.1    "~ deals N damage to target creature and each other creature that shares a color with it. You gain life equal to the damage dealt this way." (Brightflame)
 *   CR 725.1, 725.2, 603.4, 508.1     "At the beginning of your end step, if there is no monarch, target opponent becomes the monarch." / "Whenever a creature attacks one of your opponents, if that player is the monarch, ..." (M'Baku)
 *   CR 702.68a, 702.68b               "Frenzy N" (Frenzy Sliver)
 *   CR 607.2a, 601.3, 305.1           "Until end of turn, you may play cards you own exiled with ~." (Kayla's Music Box)
 *   CR 118.9, 608.2g, 305.1           "Reveal the top card of your library. You may play that card without paying its mana cost. If you don't, exile it." (Djinn of Wishes)
 *   CR 701.20e, 401.4, 608.2c         "Put a land card from among them into your hand and the rest on the bottom of your library in a random order. If you didn't put a card into your hand this way, draw a card." (Inscribed Tablet)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, reject } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const applyActionError = (s: GameState, a: unknown) => applyAction(s, a as never).error;
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;

/** Answer the decisions that come up until priority (payments automatic; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: (ObjectId | PlayerId)[]; yes?: boolean; option?: string } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.splice(0, 1).map((id) => (id.startsWith('p') && !id.startsWith('o') ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) } as never);
    else if (p.kind === 'chooseOption') {
      const pick = o.option !== undefined ? p.options.filter((x) => x.label === o.option || x.id === o.option) : p.options.slice(0, p.min);
      s = answer(s, { kind: 'chooseOption', ids: pick.map((x) => x.id) });
    }
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (o.option ?? p.options[0]) as never });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const castBy = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never);
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}, player: PlayerId = 'p1'): GameState => resolveAll(drive(castBy(s, name, player), o), o);
const activate = (s: GameState, source: ObjectId, ability: string, o: Parameters<typeof drive>[1] = {}, player: PlayerId = 'p1'): GameState =>
  resolveAll(drive(act(s, { type: 'activate', player, source, ability } as never), o), o);
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const onBf = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (p === undefined || s.objects[id]!.controller === p));
const inGy = (s: GameState, name: string): number => Object.values(s.objects).filter((o) => o.zone === 'graveyard' && s.defs[o.defId]?.name === name).length;
const energy = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;
const stat = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const subtypes = (s: GameState, id: ObjectId): string => [...chars(s, id).subtypes].sort().join(' ');

/** Pass priority (answering decisions) until the next declare-attackers decision. */
function toAttackers(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 120 && s.pending?.kind !== 'declareAttackers'; i++) {
    if (s.result) throw new Error('The game ended');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  expect(s.pending?.kind).toBe('declareAttackers');
  return s;
}
const declareAction = (s: GameState, attacks: [ObjectId, PlayerId][]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: attacks.map(([attacker, defender]) => ({ attacker, defender })) } });
const declare = (s: GameState, attacks: [ObjectId, PlayerId][]): GameState => act(s, declareAction(s, attacks) as never);
function toBlockers(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 80 && s.pending?.kind !== 'declareBlockers'; i++) {
    if (s.turn.step === 'main2') throw new Error('No declare blockers decision came');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  return s;
}
/** Pass until `done`, declaring no blocks and no attackers when asked. */
function runUntil(s0: GameState, done: (s: GameState) => boolean, what: string, max = 400): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`The game ended while waiting for ${what}`);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  throw new Error(`Never reached ${what}`);
}


const damageOn = (s: GameState, id: ObjectId): number => s.objects[id]!.damage;
const mk = (name: string, colors: string[], text = '', type = 'Creature — Bear', pt: [string, string] = ['1', '5']): CardDef => card(name, type, text, { pt, colors });
const RED5 = mk('Test Red Five', ['R']);
const GRN5 = mk('Test Green Five', ['G']);
const GW5 = mk('Test Gw Five', ['G', 'W']);
const GOLEM5 = mk('Test Golem Five', [], '', 'Artifact Creature — Golem');
const FLAME = card('Test Flame', 'Sorcery', '~ deals 2 damage to target creature and each other creature that shares a color with it. You gain life equal to the damage dealt this way.', { colors: ['R'] });
const MBAKU = card('Test Chieftain', 'Legendary Creature — Human Noble', "At the beginning of your end step, if there is no monarch, target opponent becomes the monarch.\nWhenever a creature attacks one of your opponents, if that player is the monarch, that creature gets +1/+1 and gains trample until end of turn.", { pt: ['3', '3'] });
const BERSERK = card('Test Berserker', 'Creature — Human Berserker', 'Frenzy 2', { pt: ['2', '2'] });
const SLIVER = card('Test Frenzy Hive', 'Creature — Sliver', 'All Sliver creatures have frenzy 1.', { pt: ['1', '1'] });
const BOX = card('Test Music Box', 'Legendary Artifact', '{0}: Look at the top card of your library, then exile it face down.\n{T}: Until end of turn, you may play cards you own exiled with ~.');
const DJINN = card('Test Wish Djinn', 'Sorcery', 'Reveal the top card of your library. You may play that card without paying its mana cost. If you don\'t, exile it.');
const TABLET = card('Test Tablet', 'Artifact', '{0}, {T}, Sacrifice this artifact: Reveal the top five cards of your library. Put a land card from among them into your hand and the rest on the bottom of your library in a random order. If you didn\'t put a card into your hand this way, draw a card.');
const SPARK = card('Test Spark Wizard', 'Creature — Wizard', '', { pt: ['1', '1'], colors: ['U'] });
const SPELLCARD = card('Test Plain Charm', 'Sorcery', 'You gain 1 life.', { colors: ['W'] });

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [RED5, GRN5, GW5, GOLEM5, FLAME, MBAKU, BERSERK, SLIVER, BOX, DJINN, TABLET, SPARK, SPELLCARD]) expect(noManual(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('every real card of the round plays fully', async () => {
    const { compiledDefs } = await import('../../fixtures');
    for (const d of compiledDefs(['Brightflame', "M'Baku, Jabari Chieftain", 'Frenzy Sliver', "Kayla's Music Box", 'Djinn of Wishes', 'Inscribed Tablet'])) {
      expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
      expect(noManual(d), d.name).toBe(true);
    }
  });
});

describe('CR 120.3, 105.1, 608.2c: "~ deals N damage to target creature and each other creature that shares a color with it. You gain life equal to the damage dealt this way." (Brightflame)', () => {
  const defs = [FLAME, RED5, GRN5, GW5, GOLEM5];
  const setup = () => mpScenario({ defs, zones: { p1: { hand: ['Test Flame'], battlefield: [{ name: 'Test Green Five', since: -1 }, { name: 'Test Golem Five', since: -1 }, { name: 'Test Red Five', since: -1 }] }, p2: { battlefield: [{ name: 'Test Gw Five', since: -1 }, { name: 'Test Red Five', since: -1 }] } } });
  it('a green-white target and every other creature sharing a color (green, its own too) take the damage, the rest do not; the controller gains the total damage dealt', () => {
    const s0 = setup();
    const gw = onBf(s0, 'Test Gw Five', 'p2')[0]!;
    const s = cast(s0, 'Test Flame', { targets: [gw] });
    expect(damageOn(s, gw)).toBe(2);
    expect(damageOn(s, onBf(s, 'Test Green Five', 'p1')[0]!)).toBe(2);
    expect(damageOn(s, onBf(s, 'Test Golem Five', 'p1')[0]!)).toBe(0);
    expect(damageOn(s, onBf(s, 'Test Red Five', 'p1')[0]!)).toBe(0);
    expect(damageOn(s, onBf(s, 'Test Red Five', 'p2')[0]!)).toBe(0);
    expect(life(s, 'p1')).toBe(20 + 4);
  });
  it('a red target damages every red creature, whoever controls it (ruling 2005-10-01: even your own): three creatures, 6 life gained is 2 each', () => {
    const s0 = setup();
    const red = onBf(s0, 'Test Red Five', 'p2')[0]!;
    const s = cast(s0, 'Test Flame', { targets: [red] });
    expect(damageOn(s, red)).toBe(2);
    expect(damageOn(s, onBf(s, 'Test Red Five', 'p1')[0]!)).toBe(2);
    expect(damageOn(s, onBf(s, 'Test Gw Five', 'p2')[0]!)).toBe(0);
    expect(life(s, 'p1')).toBe(20 + 4);
  });
  it('negative: a colorless target shares a color with nothing, not even other colorless creatures: only it is damaged', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Flame'], battlefield: [{ name: 'Test Golem Five', since: -1 }] }, p2: { battlefield: [{ name: 'Test Golem Five', since: -1 }, { name: 'Test Green Five', since: -1 }] } } });
    const target = onBf(s0, 'Test Golem Five', 'p2')[0]!;
    const s = cast(s0, 'Test Flame', { targets: [target] });
    expect(damageOn(s, target)).toBe(2);
    expect(damageOn(s, onBf(s, 'Test Golem Five', 'p1')[0]!)).toBe(0);
    expect(damageOn(s, onBf(s, 'Test Green Five', 'p2')[0]!)).toBe(0);
    expect(life(s, 'p1')).toBe(20 + 2);
  });
});

/** Pass (answering what comes up, targets from `targets`) until the turn after the current one begins. */
function throughTurn(s0: GameState, targets: (ObjectId | PlayerId)[] = ['p2']): GameState {
  let s = s0;
  const turn = s.turn.number;
  for (let i = 0; i < 400 && s.turn.number === turn; i++) {
    if (s.result) throw new Error('The game ended');
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = s.pending?.kind === 'priority' ? pass(s) : drive(s, { targets: [...targets] });
  }
  return s;
}
const monarch = (s: GameState): PlayerId | undefined => s.designations.monarch as PlayerId | undefined;
/** Resolve everything on the stack (the pending decision is priority afterwards). */
const settle = (s0: GameState): GameState => { let s = drive(s0); for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = drive(pass(s)); return s; };

describe('CR 725.1, 725.2, 603.4: "At the beginning of your end step, if there is no monarch, target opponent becomes the monarch." (M\'Baku)', () => {
  const defs = [MBAKU];
  it('with no monarch, the chosen opponent becomes the monarch at your end step', () => {
    const s = throughTurn(mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Chieftain', since: -1 }] } } }), ['p2']);
    expect(monarch(s)).toBe('p2');
  });
  it('negative: with a monarch already (you or anyone), the intervening "if" is false and nobody changes', () => {
    for (const m of ['p1', 'p3'] as PlayerId[]) {
      const s = throughTurn(mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Chieftain', since: -1 }] } }, setup: (x) => { x.designations.monarch = m; } }), ['p2']);
      expect(monarch(s)).toBe(m);
    }
  });
});

describe('CR 725.2, 508.1, 603.4: "Whenever a creature attacks one of your opponents, if that player is the monarch, that creature gets +1/+1 and gains trample until end of turn." (M\'Baku)', () => {
  const defs = [MBAKU, BERSERK];
  const attackWith = (mon: PlayerId | undefined, attackee: PlayerId): { s: GameState; id: ObjectId } => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Chieftain', since: -1 }, { name: 'Test Berserker', since: -1 }] } }, setup: (x) => { if (mon !== undefined) x.designations.monarch = mon; } });
    const id = onBf(s0, 'Test Berserker', 'p1')[0]!;
    const s = settle(declare(toAttackers(s0), [[id, attackee]]));
    return { s, id };
  };
  it('a creature attacking the monarch opponent gets +1/+1 and trample until end of turn', () => {
    const { s, id } = attackWith('p2', 'p2');
    expect(stat(s, id)).toBe('3/3');
    expect(chars(s, id).keywords?.some((k) => k.keyword === 'trample') ?? JSON.stringify(chars(s, id)).includes('trample')).toBe(true);
  });
  it('negative: attacking an opponent who is not the monarch, or with no monarch, gives nothing', () => {
    expect(stat(attackWith('p3', 'p2').s, attackWith('p3', 'p2').id)).toBe('2/2');
    const none = attackWith(undefined, 'p2');
    expect(stat(none.s, none.id)).toBe('2/2');
  });
  it("negative: you being the monarch does not count (\"that player\" is the player attacked)", () => {
    const { s, id } = attackWith('p1', 'p2');
    expect(stat(s, id)).toBe('2/2');
  });
});

describe('CR 702.68a, 702.68b: "Frenzy N" (Whenever this creature attacks and isn\'t blocked, it gets +N/+0 until end of turn.) (Frenzy Sliver)', () => {
  const defs = [BERSERK, SLIVER, RED5];
  /** p1 attacks p2 with `name`; p2 blocks it with their Red Five when `block`; the state after blockers were declared and the triggers resolved. */
  function afterBlockers(p1: string[], name: string, block: boolean): { s: GameState; id: ObjectId } {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: p1.map((n) => ({ name: n, since: -1 })) }, p2: { battlefield: [{ name: 'Test Red Five', since: -1 }] } } });
    const id = onBf(s0, name, 'p1')[0]!;
    let s = toBlockers(declare(toAttackers(s0), [[id, 'p2']]));
    s = answer(s, { kind: 'declareBlockers', blocks: block ? [{ blocker: onBf(s0, 'Test Red Five', 'p2')[0]!, attacker: id }] : [] });
    return { s: settle(s), id };
  }
  it('an unblocked creature with frenzy 2 gets +2/+0 until end of turn', () => {
    const { s, id } = afterBlockers(['Test Berserker'], 'Test Berserker', false);
    expect(stat(s, id)).toBe('4/2');
  });
  it('negative: a blocked creature with frenzy gets nothing', () => {
    const { s, id } = afterBlockers(['Test Berserker'], 'Test Berserker', true);
    expect(stat(s, id)).toBe('2/2');
  });
  it('"All Sliver creatures have frenzy 1": an unblocked Sliver is 2/1 (CR 702.68b: instances trigger separately; it has one from itself)', () => {
    const { s, id } = afterBlockers(['Test Frenzy Hive'], 'Test Frenzy Hive', false);
    expect(stat(s, id)).toBe('2/1');
  });
  it('negative: a creature that is not a Sliver gets no frenzy from the Sliver', () => {
    const { s, id } = afterBlockers(['Test Frenzy Hive', 'Test Berserker'], 'Test Berserker', false);
    expect(stat(s, id)).toBe('4/2'); // its own frenzy 2 only, not 6/2
  });
});

describe('CR 607.2a, 601.3, 305.1: "Until end of turn, you may play cards you own exiled with ~." (Kayla\'s Music Box)', () => {
  const defs = [BOX, SPARK];
  it('the card the box exiled face down can be played this turn after the second ability; not before it', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Music Box', since: -1 }], library: ['Plains', 'Plains'] } } });
    const box = onBf(s0, 'Test Music Box', 'p1')[0]!;
    let s = activate(s0, box, 'p:0:0');
    const exiledId = s.zones.exile[0]!;
    expect(s.objects[exiledId]!.zone).toBe('exile');
    expect(applyActionError(s, { type: 'playLand', player: 'p1', card: exiledId })).toBeDefined();
    s = activate(s, box, 'p:0:1');
    s = act(s, { type: 'playLand', player: 'p1', card: exiledId } as never);
    expect(onBf(s, 'Plains', 'p1').length).toBe(1);
  });
  it("negative: a card the box exiled but another player owns (control changed the owner's card) is not playable: you play only cards you own", () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: [{ name: 'Test Music Box', since: -1 }], library: ['Plains', 'Plains'] } } });
    const box = onBf(s0, 'Test Music Box', 'p1')[0]!;
    let s = activate(s0, box, 'p:0:0');
    const exiledId = s.zones.exile[0]!;
    s.objects[exiledId]!.owner = 'p2'; // (as if the card were another player's: e.g. exiled from their library by a copy of the effect)
    s = activate(s, box, 'p:0:1');
    expect(applyActionError(s, { type: 'playLand', player: 'p1', card: exiledId })).toBeDefined();
  });
});

describe('CR 118.9, 608.2g, 305.1: "Reveal the top card of your library. You may play that card without paying its mana cost. If you don\'t, exile it." (Djinn of Wishes)', () => {
  const defs = [DJINN, SPELLCARD];
  // (the first player draws in turn 1: the first library card is the draw)
  const run = (top: string, yes: boolean): GameState => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Wish Djinn'], library: ['Plains', top] } } });
    return cast(s0, 'Test Wish Djinn', yes ? { option: top === 'Plains' ? 'land' : 'cast' } : { yes: false });
  };
  it('a land card revealed is played without paying; a spell card is cast for free', () => {
    const land = run('Plains', true);
    expect(onBf(land, 'Plains', 'p1').length).toBe(1);
    const spell = run('Test Plain Charm', true);
    expect(life(spell, 'p1')).toBe(21);
    expect(inGy(spell, 'Test Plain Charm')).toBe(1);
  });
  it('negative: declining exiles the card and it is not played or cast', () => {
    const land = run('Plains', false);
    expect(onBf(land, 'Plains', 'p1').length).toBe(0);
    expect(land.zones.exile.some((id) => land.objects[id]!.defId === 'Plains')).toBe(true);
    const spell = run('Test Plain Charm', false);
    expect(life(spell, 'p1')).toBe(20);
    expect(spell.zones.exile.some((id) => spell.objects[id]!.defId === 'Test Plain Charm')).toBe(true);
  });
});

describe('CR 701.20e, 401.4, 608.2c: "Put a land card from among them into your hand and the rest on the bottom of your library in a random order. If you didn\'t put a card into your hand this way, draw a card." (Inscribed Tablet)', () => {
  const defs = [TABLET, SPARK];
  const run = (top: string[]): { s: GameState; revealed: ObjectId[] } => {
    const s0 = mpScenario({ defs, cards: ['Forest'], zones: { p1: { battlefield: [{ name: 'Test Tablet', since: -1 }], library: ['Plains', ...top] } } });
    const revealed = s0.zones.library['p1']!.slice(0, 5);
    return { s: activate(s0, onBf(s0, 'Test Tablet', 'p1')[0]!, 'p:0:0'), revealed };
  };
  it('a land among the five goes to your hand, the other four to the bottom of the library, and you draw nothing', () => {
    const { s, revealed } = run(['Test Spark Wizard', 'Test Spark Wizard', 'Forest', 'Test Spark Wizard', 'Test Spark Wizard']);
    const hand = s.zones.hand['p1']!;
    expect(hand.length).toBe(2); // the turn's draw and the land
    expect(hand.map((id) => s.objects[id]!.defId).sort()).toEqual(['Forest', 'Plains']);
    expect(revealed.length).toBe(5);
    expect(s.zones.library['p1']!.slice(-4).map((id) => s.objects[id]!.defId)).toEqual(Array(4).fill('Test Spark Wizard'));
  });
  it('negative: with no land among the five, none goes to your hand and you draw a card instead (the next card of the library)', () => {
    const { s, revealed } = run(['Test Spark Wizard', 'Test Spark Wizard', 'Test Spark Wizard', 'Test Spark Wizard', 'Test Spark Wizard']);
    const hand = s.zones.hand['p1']!;
    expect(hand.length).toBe(2); // the turn's draw and the card the tablet drew
    expect(hand.map((id) => s.objects[id]!.defId)).toEqual(['Plains', 'Plains']);
    expect(revealed.length).toBe(5);
    expect(s.zones.library['p1']!.slice(-5).map((id) => s.objects[id]!.defId)).toEqual(Array(5).fill('Test Spark Wizard'));
  });
});

describe('collateral: "Whenever a creature attacks one of your opponents, that player loses 1 life." (Calculating Lich) and "You may play target Elemental card from your graveyard without paying its mana cost." (Horde of Notions)', () => {
  const LICH = card('Test Siphon Lich', 'Creature — Zombie', "Whenever a creature attacks one of your opponents, that player loses 1 life.", { pt: ['2', '2'] });
  const HORDE = card('Test Horde', 'Creature — Elemental', '{0}: You may play target Elemental card from your graveyard without paying its mana cost.', { pt: ['1', '1'] });
  const ELEM = card('Test Fire Elemental', 'Creature — Elemental', '', { pt: ['2', '2'], colors: ['R'] });
  it('the defending player (not the attacking player, not the others) loses 1 life per attacking creature', () => {
    const s0 = mpScenario({ defs: [LICH, BERSERK], zones: { p1: { battlefield: [{ name: 'Test Siphon Lich', since: -1 }, { name: 'Test Berserker', since: -1 }] } } });
    const s = settle(declare(toAttackers(s0), [[onBf(s0, 'Test Berserker', 'p1')[0]!, 'p2']]));
    expect([life(s, 'p1'), life(s, 'p2'), life(s, 'p3'), life(s, 'p4')]).toEqual([20, 19, 20, 20]);
  });
  it('an Elemental card in your graveyard is cast without paying; a card that is not an Elemental is not a legal target', () => {
    const s0 = mpScenario({ defs: [HORDE, ELEM, RED5], zones: { p1: { battlefield: [{ name: 'Test Horde', since: -1 }], graveyard: ['Test Fire Elemental', 'Test Red Five'] } } });
    const horde = onBf(s0, 'Test Horde', 'p1')[0]!;
    const elem = find(s0, 'Test Fire Elemental', 'graveyard', 'p1');
    const s = activate(s0, horde, 'p:0:0', { targets: [elem], option: 'cast' });
    expect(onBf(s, 'Test Fire Elemental', 'p1').length).toBe(1);
    const bear = find(s0, 'Test Red Five', 'graveyard', 'p1');
    expect(() => activate(s0, horde, 'p:0:0', { targets: [bear], option: 'cast' })).toThrow();
  });
});
