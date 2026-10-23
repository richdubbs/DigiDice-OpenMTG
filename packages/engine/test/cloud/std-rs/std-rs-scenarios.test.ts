/**
 * Standard round S (std-rs, card wave 2 slice s3): the readings this round added, played through the engine with synthetic cards compiled by the game's default
 * compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case (CR cites from memory, unverified:
 * rules/cr/ is not in the cloud checkout).
 *
 *   CR 406.1, 608.2c, 101.4  "each opponent exiles cards from the top of their library until they exile a nonland card": from the opponent's own library, the
 *                            lands above it exiled too; your library untouched
 *   CR 607.2a, 608.2g        "you may cast a card exiled with this creature without paying its mana cost": only the nonland cards its other ability exiled
 *   CR 607.2a, 609.4b        "As long as you control an artifact, you may cast the exiled card, and mana of any type can be spent to cast that spell.": a red
 *                            card cast with white mana while you control an artifact; no permission without one
 *   CR 406.3, 701.20e        "Target opponent exiles the top two cards of their library face down. You may look at and play those cards for as long as they
 *                            remain exiled. If you cast a spell this way, ...": face down, you see them and the opponent does not; a red spell cast with white
 *                            mana; the land played as your land play
 *   CR 707.9b, 205.1b        "If you do, create a token that's a copy of the exiled card, except it's a 3/3 Golem artifact creature in addition to its other
 *                            types.": a 3/3 Bear Golem artifact creature token; nothing when no card is exiled
 */
import { describe, expect, it } from 'vitest';
import { canSee, compileCard, getChars, legalActions, ptNumbers, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** The option lists of the object choices asked so far. */
const offered: ObjectId[][] = [];

/** Answer the decisions until priority: payments automatic, player targets `p2`, object choices the first `max` options (none with `pick: 'none'`), `yes`. */
function drive(s0: GameState, o: { yes?: boolean; pick?: 'none' | 'all'; targets?: ObjectId[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      const t = o.targets && o.targets.length > 0 ? o.targets.map((id) => ({ kind: 'object' as const, id })) : [{ kind: 'player' as const, id: 'p2' }];
      s = answer(s, { kind: 'chooseTargets', targets: t });
    } else if (p.kind === 'chooseObjects') {
      offered.push([...p.options]);
      s = answer(s, { kind: 'chooseObjects', ids: o.pick === 'none' ? p.options.slice(0, p.min) : p.options.slice(0, Math.max(p.min, Math.min(1, p.options.length))) });
    } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o), o);
const exiledNames = (s: GameState, owner?: PlayerId): string[] => s.zones.exile.filter((id) => !owner || s.objects[id]!.owner === owner).map((id) => s.objects[id]!.defId);
const castable = (s: GameState, id: ObjectId, player: PlayerId = 'p1'): boolean => legalActions(s, player).some((a) => a.kind === 'cast' && a.action.type === 'cast' && a.action.card === id);

const INSIGHT = card('Test Insight', 'Sorcery', 'Draw a card.', { cost: '{3}' });
const EMBER = card('Test Ember', 'Sorcery', 'You gain 3 life.', { cost: '{R}' });
const PEBBLE = card('Test Pebble', 'Artifact', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('std-rs cards compile fully', () => {
  it('the synthetic cards of these scenarios are fully automated', () => {
    for (const d of [RAIDER(), SUMMONER(), HEIST(), FORGE()]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

function RAIDER(): CardDef {
  return card('Test Vault Raider', 'Creature — Human Rogue', 'When this creature enters, each opponent exiles cards from the top of their library until they exile a nonland card.\n{0}: You may cast a card exiled with this creature without paying its mana cost.', { pt: ['2', '2'] });
}

describe('CR 406.1, 608.2c, 101.4: "each opponent exiles cards from the top of their library until they exile a nonland card"', () => {
  it('the opponent exiles from their own library down to the first nonland card; your library is untouched', () => {
    const s0 = scenario([], { defs: [RAIDER(), INSIGHT], p1: { hand: ['Test Vault Raider'] }, p2: { library: ['Plains', 'Plains', 'Test Insight'] } });
    const mine = s0.zones.library.p1!.length;
    const s = cast(s0, 'Test Vault Raider');
    expect(exiledNames(s, 'p2')).toEqual(['Plains', 'Plains', 'Test Insight']);
    expect(s.zones.library.p1!.length).toBe(mine);
  });
});

describe('CR 607.2a, 608.2g: "you may cast a card exiled with this creature without paying its mana cost"', () => {
  it('the nonland card its other ability exiled is offered alone, and cast without paying its mana cost', () => {
    const s0 = scenario([], { defs: [RAIDER(), INSIGHT], p1: { hand: ['Test Vault Raider'] }, p2: { library: ['Plains', 'Test Insight'] } });
    let s = cast(s0, 'Test Vault Raider');
    const hand = s.zones.hand.p1!.length;
    offered.length = 0;
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === find(s, 'Test Vault Raider', 'battlefield', 'p1'))!;
    s = resolveAll(drive(act(s, la.action)));
    expect(offered).toHaveLength(1);
    expect(offered[0]!.map((id) => s.objects[id]?.defId ?? 'gone')).toEqual(['gone']); // (the one option, Test Insight, has left exile since)
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Insight']); // cast by p1, its owner's graveyard (CR 400.3)
    expect(s.zones.hand.p1!.length).toBe(hand + 1);
  });
  it('a card exiled by something else is not offered (CR 607.2a): nothing to cast', () => {
    const s0 = scenario([], { defs: [RAIDER(), INSIGHT], p1: { battlefield: ['Test Vault Raider'], exile: ['Test Insight'] } });
    offered.length = 0;
    const la = legalActions(s0, 'p1').find((a) => a.kind === 'activate' && a.object === find(s0, 'Test Vault Raider', 'battlefield', 'p1'))!;
    const s = resolveAll(drive(act(s0, la.action)));
    expect(offered.flat()).toEqual([]);
    expect(exiledNames(s)).toEqual(['Test Insight']);
  });
});

function SUMMONER(): CardDef {
  return card('Test Hand Thief', 'Creature — Human Warlock', 'When this creature enters, target opponent reveals their hand. You choose a nonland card from it. Exile that card.\nAs long as you control an artifact, you may cast the exiled card, and mana of any type can be spent to cast that spell.', { pt: ['2', '2'] });
}

describe('CR 607.2a, 609.4b: "As long as you control an artifact, you may cast the exiled card, and mana of any type can be spent to cast that spell."', () => {
  const setup = (artifact: boolean): GameState => {
    const s0 = scenario([], { defs: [SUMMONER(), EMBER, PEBBLE], p1: { hand: ['Test Hand Thief'], battlefield: ['Plains', ...(artifact ? ['Test Pebble'] : [])] }, p2: { hand: ['Test Ember'] } });
    return cast(s0, 'Test Hand Thief');
  };
  it('with an artifact, the red card exiled from the opponent\'s hand is cast with white mana', () => {
    let s = setup(true);
    const ember = find(s, 'Test Ember', 'exile', 'p2');
    expect(castable(s, ember)).toBe(true);
    const before = life(s, 'p1');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: ember })));
    expect(life(s, 'p1')).toBe(before + 3);
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Ember']);
  });
  it('without an artifact, the permission does not apply (CR 604.1)', () => {
    const s = setup(false);
    expect(castable(s, find(s, 'Test Ember', 'exile', 'p2'))).toBe(false);
  });
});

function HEIST(): CardDef {
  return card('Test Heist', 'Sorcery', 'Target opponent exiles the top two cards of their library face down. You may look at and play those cards for as long as they remain exiled. If you cast a spell this way, you may spend mana as though it were mana of any type to cast it.');
}

describe('CR 406.3, 701.20e, 609.4b: "... face down. You may look at and play those cards for as long as they remain exiled. If you cast a spell this way, ..."', () => {
  const setup = (): GameState => {
    const s0 = scenario([], { defs: [HEIST(), EMBER], p1: { hand: ['Test Heist'], battlefield: ['Plains'] }, p2: { library: ['Test Ember', 'Plains'] } });
    return cast(s0, 'Test Heist');
  };
  it('the two cards are exiled face down: you may look at them, their owner may not', () => {
    const s = setup();
    const ids = s.zones.exile.filter((id) => s.objects[id]!.owner === 'p2');
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(s.objects[id]!.faceDown).toBe(true);
      expect(canSee(s, s.objects[id]!, 'p1')).toBe(true);
      expect(canSee(s, s.objects[id]!, 'p2')).toBe(false);
    }
  });
  it('the red spell is cast with white mana, and the land is played as your land for the turn', () => {
    let s = setup();
    const ember = find(s, 'Test Ember', 'exile', 'p2');
    const before = life(s, 'p1');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: ember })));
    expect(life(s, 'p1')).toBe(before + 3);
    const land = find(s, 'Plains', 'exile', 'p2');
    const play = legalActions(s, 'p1').find((a) => a.action.type === 'playLand' && a.action.card === land);
    expect(play).toBeDefined();
    s = act(s, play!.action);
    expect(s.objects[land] === undefined || s.objects[land]!.zone !== 'exile').toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p2' && s.objects[id]!.controller === 'p1')).toHaveLength(1);
  });
  it('a card exiled face down by something else stays hidden from you and is not playable', () => {
    const s0 = scenario([], { defs: [HEIST(), EMBER], p1: { battlefield: ['Plains'] }, p2: { exile: ['Test Ember'] } });
    const id = find(s0, 'Test Ember', 'exile', 'p2');
    s0.objects[id]!.faceDown = true;
    expect(canSee(s0, s0.objects[id]!, 'p1')).toBe(false);
    expect(castable(s0, id)).toBe(false);
  });
});

function FORGE(): CardDef {
  return card('Test Golem Forge', 'Artifact', 'At the beginning of combat on your turn, draw a card. Then you may exile an artifact or creature card from your hand. If you do, create a token that\'s a copy of the exiled card, except it\'s a 3/3 Golem artifact creature in addition to its other types.');
}

describe('CR 707.9b, 205.1b: "create a token that\'s a copy of the exiled card, except it\'s a 3/3 Golem artifact creature in addition to its other types"', () => {
  const setup = (): GameState => scenario([], { defs: [FORGE(), BEAR], p1: { battlefield: ['Test Golem Forge'], hand: ['Test Bear'] } });
  it('the Bear card exiled from your hand becomes a 3/3 Bear Golem artifact creature token', () => {
    let s = advanceTo(setup(), 1, 'beginCombat');
    s = resolveAll(drive(s));
    expect(exiledNames(s, 'p1')).toEqual(['Test Bear']);
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(1);
    const c = getChars(s, tokens[0]!);
    expect(c.name).toBe('Test Bear');
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect([...c.subtypes].sort()).toEqual(['Bear', 'Golem']);
    const n = ptNumbers(c);
    expect([n.power, n.toughness]).toEqual([3, 3]);
  });
  it('no card exiled (the option declined): no token (CR 608.2c "if you do")', () => {
    let s = advanceTo(setup(), 1, 'beginCombat');
    const no = { pick: 'none' as const, yes: false };
    s = resolveAll(drive(s, no), no);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'hand', 'p1')).toHaveLength(1);
  });
});
