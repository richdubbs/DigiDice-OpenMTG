/**
 * Commander coordinator D, round edh-d-43 (lane counter-modes, second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10).
 * Alice (p1) is the active player of turn 1, Bob (p2) holds the counterspells. Each test is named after the rule it checks, with its negative case.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/index';
import { castMethods } from '../../../src/actions/cast';
import { act, card, cast, drive, find, full, legal, passBoth, resolveAll, scenario } from '../r5-cost/support';

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => nameOf(s, id));
const zoneNames = (s: GameState, zone: 'hand' | 'graveyard' | 'library' | 'exile', p: 'p1' | 'p2'): string[] => names(s, zone === 'exile' ? s.zones.exile.filter((id) => s.objects[id]!.owner === p) : s.zones[zone][p]!);
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const FILLER = card('Test Filler', 'Sorcery', '', '{0}');

describe('"Choose target player. They may discard up to X cards. Then they draw a card for each card discarded this way." (CR 115.1, 601.2c, 701.9a, 608.2c; Mishra\'s Command)', () => {
  const CMD = card('Test Command', 'Sorcery', 'Choose one --\n• Choose target player. They may discard up to X cards. Then they draw a card for each card discarded this way.\n• ~ deals X damage to target creature.', '{X}');
  const defs = [BEAR, FILLER, CMD];
  it('is automated', () => { expect(full(CMD), JSON.stringify(CMD.automation)).toBe(true); });
  const start = (x: number) => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Command', 'Test Filler'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Filler', 'Test Filler', 'Test Filler'], library: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    return passBoth(cast(s0, 'Test Command', { options: [['0']], targets: [[{ kind: 'player', id: 'p2' }]], x: [x] }));
  };
  it('the chosen player (Bob) picks up to X of his own cards (not Alice), discards exactly those and draws that many', () => {
    let s = start(2);
    const p = s.pending as unknown as { kind: string; player: string; options: string[]; min: number; max: number };
    expect(p.kind).toBe('chooseObjects');
    expect(p.player).toBe('p2');
    expect([p.min, p.max]).toEqual([0, 2]);
    expect(p.options).toHaveLength(3); // only Bob's three cards
    s = resolveAll(drive(s, { objects: [p.options.slice(0, 2)] }));
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Filler', 'Test Filler']);
    expect(zoneNames(s, 'hand', 'p2').sort()).toEqual(['Test Bear', 'Test Bear', 'Test Filler']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Filler']); // Alice discards and draws nothing
  });
  it('the negative case: choosing none discards none and draws none ("a card for each card discarded this way")', () => {
    const s = resolveAll(drive(start(2), { objects: [[]] }));
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual([]);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Filler', 'Test Filler', 'Test Filler']);
  });
});

describe('"Choose three. You may choose the same mode more than once." with "Target player returns a creature card from their graveyard to their hand." (CR 700.2d, 115.1, 404.1, 400.3; Obscura Confluence)', () => {
  const CONF = card('Test Confluence', 'Instant', 'Choose three. You may choose the same mode more than once.\n• Target creature connives.\n• Target player returns a creature card from their graveyard to their hand.\n• You gain 1 life.', '{0}');
  const SPELL = card('Test Sorcery', 'Sorcery', '', '{0}');
  const defs = [BEAR, FILLER, CONF, SPELL];
  it('is automated', () => { expect(full(CONF), JSON.stringify(CONF.automation)).toBe(true); });
  it('the chosen player returns a creature card of THEIR graveyard (not a noncreature card, not the caster\'s)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Confluence'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Bear', 'Test Sorcery'] } });
    let s = cast(s0, 'Test Confluence', { options: [['1', '1', '2']], targets: [[{ kind: 'player', id: 'p2' }], [{ kind: 'player', id: 'p2' }]] });
    console.log(JSON.stringify(s.pending));
    s = resolveAll(s);
    expect(zoneNames(s, 'hand', 'p2')).toEqual(['Test Bear']); // once: the second mode is a card of the graveyard, then the 2nd instance finds none
    expect(zoneNames(s, 'graveyard', 'p2')).toEqual(['Test Sorcery']);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Confluence']);
    expect(life(s, 'p1')).toBe(21);
  });
});

describe('"...exile it instead of putting it into its owner\'s graveyard" + a free cast of that card (CR 701.6a, 614.15, 118.9, 601.2b, 400.7; Kheru Spellsnatcher, Transcendent Dragon)', () => {
  const GAIN = card('Test Boon', 'Instant', 'You gain 3 life.', '{0}');
  const SNATCH = card('Test Snatcher', 'Creature — Wizard', 'Flash\nWhen ~ enters, counter target spell. If that spell is countered this way, exile it instead of putting it into its owner\'s graveyard. You may cast that card without paying its mana cost for as long as it remains exiled.', '{0}', ['2', '2']);
  const DRAGON = card('Test Drake', 'Creature — Dragon', 'Flash\nWhen ~ enters, if you cast it, counter target spell. If that spell is countered this way, exile it instead of putting it into its owner\'s graveyard, then you may cast it without paying its mana cost.', '{0}', ['2', '2']);
  const defs = [BEAR, GAIN, SNATCH, DRAGON];
  const respond = (s0: GameState, creature: string): GameState => {
    let s = cast(s0, 'Test Boon');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, creature, 'hand', 'p2') }));
    s = passBoth(s); // the creature resolves, its trigger goes on the stack and asks for a target
    return drive(s, { targets: [[{ kind: 'object', id: spell }]] });
  };
  it('are automated', () => { for (const d of [SNATCH, DRAGON]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
  it('Kheru: the countered spell is exiled, not put into its owner\'s graveyard, and its controller may cast it later for free', () => {
    let s = respond(scenario([], { defs, p1: { hand: ['Test Boon'] }, p2: { hand: ['Test Snatcher'] } }), 'Test Snatcher');
    s = resolveAll(s);
    expect(zoneNames(s, 'exile', 'p1')).toEqual(['Test Boon']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
    expect(life(s, 'p1')).toBe(20); // never resolved
    const exiled = s.zones.exile.find((id) => nameOf(s, id) === 'Test Boon')!;
    expect(castMethods(s, exiled, 0, 'p1').some((m) => m.includes(':named:'))).toBe(false); // Alice (its owner) may not cast it: the permission is Bob's
    expect(castMethods(s, exiled, 0, 'p2').some((m) => m.includes(':named:'))).toBe(true); // Bob may, for as long as it remains exiled (any later turn too)
  });
  it('Transcendent Dragon: the cast follows at once, in the same resolution; declining leaves the card in exile with no later permission', () => {
    let s = respond(scenario([], { defs, p1: { hand: ['Test Boon'] }, p2: { hand: ['Test Drake'] } }), 'Test Drake');
    s = resolveAll(s, { yes: [true] });
    expect(life(s, 'p2')).toBe(23); // Bob cast the exiled Boon for free
    expect(life(s, 'p1')).toBe(20);
    expect(zoneNames(s, 'exile', 'p1')).toEqual([]);
    let n = respond(scenario([], { defs, p1: { hand: ['Test Boon'] }, p2: { hand: ['Test Drake'] } }), 'Test Drake');
    n = resolveAll(n, { yes: [false] });
    expect(life(n, 'p2')).toBe(20);
    expect(zoneNames(n, 'exile', 'p1')).toEqual(['Test Boon']);
    const exiled = n.zones.exile.find((id) => nameOf(n, id) === 'Test Boon')!;
    expect(castMethods(n, exiled, 0, 'p2').some((m) => m.includes(':named:'))).toBe(false);
  });
});

describe('"~ can\'t be the target of nongreen spells your opponents control or abilities from nongreen sources your opponents control." (CR 115.1, 113.7a, 101.2, 105.2; Thrun, Breaker of Silence)', () => {
  const THRUN = card('Test Silent Troll', 'Creature — Troll', '~ can\'t be the target of nongreen spells your opponents control or abilities from nongreen sources your opponents control.', '{0}', ['4', '4'], ['G']);
  const SHOCK = card('Test Shock', 'Instant', '~ deals 2 damage to target creature.', '{0}', undefined, ['R']);
  const LEAF = card('Test Leaf Shock', 'Instant', '~ deals 2 damage to target creature.', '{0}', undefined, ['G']);
  const POKER = card('Test Poker', 'Artifact', '{T}: ~ deals 1 damage to target creature.', '{0}');
  const GREENPOKER = card('Test Vine Poker', 'Artifact', '{T}: ~ deals 1 damage to target creature.', '{0}', undefined, ['G']);
  const defs = [THRUN, SHOCK, LEAF, POKER, GREENPOKER];
  const troll = (s: GameState): string => find(s, 'Test Silent Troll', 'battlefield', 'p1');
  const damage = (s: GameState, id: string): number => (s.objects[id] as unknown as { damage?: number }).damage ?? 0;
  it('is automated', () => { expect(full(THRUN), JSON.stringify(THRUN.automation)).toBe(true); });
  it('an opponent\'s nongreen spell can\'t target it; their green spell can', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Silent Troll'] }, p2: { hand: ['Test Shock', 'Test Leaf Shock'] } });
    let s = act(s0, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    expect(() => drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Shock', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: troll(s) }]] })).toThrow();
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Leaf Shock', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: troll(s) }]] }));
    expect(damage(s, troll(s))).toBe(2);
  });
  it('the controller\'s own nongreen spell may target it (the restriction is only for opponents)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Shock'], battlefield: ['Test Silent Troll'] } });
    const s = resolveAll(cast(s0, 'Test Shock', { targets: [[{ kind: 'object', id: troll(s0) }]] }));
    expect(damage(s, troll(s))).toBe(2);
  });
  it('an ability of an opponent\'s nongreen permanent can\'t target it (another creature is still a legal target); an ability of their green permanent can', () => {
    const s0 = scenario([], { defs: [...defs, BEAR], p1: { battlefield: ['Test Silent Troll', 'Test Bear'] }, p2: { battlefield: ['Test Poker', 'Test Vine Poker'] } });
    const s = act(s0, { type: 'pass', player: 'p1' });
    const acts = legal(s, 'p2', 'activate');
    const tryAct = (name: string, target: string) => () => drive(act(s, acts.find((x) => x.object === find(s, name, 'battlefield', 'p2'))!.action), { targets: [[{ kind: 'object', id: target }]] });
    expect(tryAct('Test Poker', troll(s))).toThrow();
    expect(tryAct('Test Poker', find(s, 'Test Bear', 'battlefield', 'p1'))).not.toThrow();
    expect(tryAct('Test Vine Poker', troll(s))).not.toThrow();
  });
});

describe('"Counter target activated or triggered ability. If a permanent\'s ability is countered this way, activated abilities of that permanent can\'t be activated this turn." (CR 701.6a, 113.7a, 602.5, 605.1a; Trickbind)', () => {
  const TRICK = card('Test Snarl', 'Instant', 'Counter target activated or triggered ability. If a permanent\'s ability is countered this way, activated abilities of that permanent can\'t be activated this turn.', '{0}');
  const GADGET = card('Test Gadget', 'Artifact', '{T}: You gain 2 life.\n{T}: Add {C}.', '{0}');
  const OTHER = card('Test Other Gadget', 'Artifact', '{T}: You gain 2 life.', '{0}');
  const BOMB = card('Test Bomb', 'Artifact', 'Sacrifice ~: You gain 5 life.', '{0}');
  const defs = [TRICK, GADGET, OTHER, BOMB];
  const activate = (s: GameState, name: string, mana = false) => legal(s, 'p1', 'activate').filter((a) => a.object === find(s, name, 'battlefield', 'p1') && (a.isMana === true) === mana);
  const counterAbility = (s0: GameState, gadget: string): GameState => {
    let s = drive(act(s0, activate(s0, gadget)[0]!.action));
    const ability = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Snarl', 'hand', 'p2') }), { targets: [[{ kind: 'object', id: ability }]] });
    return resolveAll(s);
  };
  it('is automated', () => { expect(full(TRICK), JSON.stringify(TRICK.automation)).toBe(true); });
  it('the countered ability does nothing, and no activated ability of its permanent (a mana ability too) can be activated this turn', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Gadget', 'Test Other Gadget'] }, p2: { hand: ['Test Snarl'] } });
    expect(activate(s0, 'Test Gadget')).toHaveLength(1);
    expect(activate(s0, 'Test Gadget', true)).toHaveLength(1);
    const s = counterAbility(s0, 'Test Gadget');
    expect(life(s, 'p1')).toBe(20); // the ability was countered
    expect(activate(s, 'Test Gadget')).toHaveLength(0);
    expect(activate(s, 'Test Gadget', true)).toHaveLength(0);
    expect(activate(s, 'Test Other Gadget')).toHaveLength(1); // another permanent is not affected
  });
  it('the restriction ends with the turn', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Gadget'] }, p2: { hand: ['Test Snarl'] } });
    let s = counterAbility(s0, 'Test Gadget');
    for (let i = 0; i < 80 && !(s.turn.number >= 3 && s.turn.activePlayer === 'p1' && s.turn.step === 'main1' && s.pending?.player === 'p1'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = act(s, { type: 'answer', answer: { kind: 'declareAttackers', attacks: [] } } as never);
      else s = act(s, { type: 'pass', player: s.pending!.player as 'p1' | 'p2' });
    }
    expect(activate(s, 'Test Gadget').length).toBeGreaterThan(0);
  });
  it('the source that already left the battlefield as the cost was paid is not affected (a new object, CR 400.7): nothing breaks', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Bomb'] }, p2: { hand: ['Test Snarl'] } });
    const s = counterAbility(s0, 'Test Bomb');
    expect(life(s, 'p1')).toBe(20);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Bomb')).toBe(false);
  });
});

describe('"That player may choose any number of tapped nongreen creatures they control and pay {2} for each creature chosen this way. If the player does, untap those creatures." (CR 608.2c, 608.2d, 118.12, 502.3; Dream Tides, Mudslide)', () => {
  const TIDES = card('Test Tidepool', 'Enchantment', 'Creatures don\'t untap during their controllers\' untap steps.\nAt the beginning of each player\'s upkeep, that player may choose any number of tapped nongreen creatures they control and pay {2} for each creature chosen this way. If the player does, untap those creatures.', '{0}');
  const GREEN = card('Test Green Bear', 'Creature — Bear', '', '{0}', ['2', '2'], ['G']);
  const RED = card('Test Red Bear', 'Creature — Bear', '', '{0}', ['2', '2'], ['R']);
  const SLIDE = card('Test Mudflow', 'Enchantment', 'Creatures without flying don\'t untap during their controllers\' untap steps.\nAt the beginning of each player\'s upkeep, that player may choose any number of tapped creatures without flying they control and pay {2} for each creature chosen this way. If the player does, untap those creatures.', '{0}');
  const FLYER = card('Test Red Flyer', 'Creature — Bird', 'Flying', '{0}', ['1', '1'], ['R']);
  const defs = [TIDES, SLIDE, GREEN, RED, FLYER];
  it('are automated', () => { for (const d of [TIDES, SLIDE]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
  const toUpkeepOf = (s0: GameState, who: 'p1' | 'p2'): GameState => {
    let s = s0;
    for (let i = 0; i < 120 && !(s.turn.activePlayer === who && s.turn.step === 'upkeep' && s.pending?.kind === 'priority' && s.zones.stack.length > 0); i++) {
      if (s.pending?.kind === 'declareAttackers') s = act(s, { type: 'answer', answer: { kind: 'declareAttackers', attacks: [] } } as never);
      else s = act(s, { type: 'pass', player: s.pending!.player as 'p1' | 'p2' });
    }
    return passBoth(s); // the upkeep trigger resolves and asks its player
  };
  const tapped = (s: GameState, name: string, p: 'p1' | 'p2'): boolean[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name && s.objects[id]!.controller === p).map((id) => s.objects[id]!.tapped);
  it('the player whose upkeep it is chooses among THEIR OWN tapped nongreen creatures, pays {2} each, and exactly those untap', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Tidepool'] }, p2: { battlefield: [{ name: 'Test Red Bear', tapped: true }, { name: 'Test Red Bear', tapped: true }, { name: 'Test Green Bear', tapped: true }, 'Plains', 'Plains', 'Plains', 'Plains'] } });
    let s = toUpkeepOf(s0, 'p2');
    const p = s.pending as unknown as { kind: string; player: string; options: string[]; min: number; max: number };
    expect(p.kind).toBe('chooseObjects');
    expect(p.player).toBe('p2');
    expect(names(s, p.options).sort()).toEqual(['Test Red Bear', 'Test Red Bear']); // not the green one, and nothing of Alice's
    s = resolveAll(drive(s, { objects: [p.options.slice(0, 2)], yes: [true, true] }));
    expect(tapped(s, 'Test Red Bear', 'p2')).toEqual([false, false]);
    expect(tapped(s, 'Test Green Bear', 'p2')).toEqual([true]); // it stays tapped: "creatures don't untap" and it was not chosen
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains' && s.objects[id]!.controller === 'p2' && !s.objects[id]!.tapped)).toHaveLength(0); // the two payments of {2} used all four lands
  });
  it('the negative case: choosing none untaps none and costs nothing; and with too little mana the creatures stay tapped', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Tidepool'] }, p2: { battlefield: [{ name: 'Test Red Bear', tapped: true }, 'Plains', 'Plains'] } });
    let s = toUpkeepOf(s0, 'p2');
    s = resolveAll(drive(s, { objects: [[]] }));
    expect(tapped(s, 'Test Red Bear', 'p2')).toEqual([true]);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains' && !s.objects[id]!.tapped)).toHaveLength(2);
  });
  it('Mudslide: a flyer is not among the choices (it untaps in the untap step anyway), a creature without flying is', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Mudflow'] }, p2: { battlefield: [{ name: 'Test Red Bear', tapped: true }, { name: 'Test Red Flyer', tapped: true }, 'Plains', 'Plains'] } });
    const s = toUpkeepOf(s0, 'p2');
    const p = s.pending as unknown as { kind: string; options: string[] };
    expect(p.kind).toBe('chooseObjects');
    expect(names(s, p.options)).toEqual(['Test Red Bear']);
    expect(tapped(s, 'Test Red Flyer', 'p2')).toEqual([false]); // flying creatures untap normally
  });
});

describe('"Counter target activated or triggered ability from an artifact or enchantment source. If a permanent\'s ability is countered this way, destroy that permanent." (CR 701.6a, 113.7a, 701.8a; Green Slime)', () => {
  const SLIME = card('Test Ooze', 'Creature — Ooze', 'Flash\nWhen ~ enters, counter target activated or triggered ability from an artifact or enchantment source. If a permanent\'s ability is countered this way, destroy that permanent.', '{0}', ['2', '2']);
  const GADGET = card('Test Gadget', 'Artifact', '{T}: You gain 2 life.', '{0}');
  const KEEPER = card('Test Keeper', 'Creature — Bear', '{T}: You gain 2 life.', '{0}', ['1', '1']);
  const defs = [SLIME, GADGET, KEEPER];
  const run = (s0: GameState, source: string, targetable: boolean): GameState => {
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, source, 'battlefield', 'p1'))!;
    let s = drive(act(s0, a.action));
    const ability = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Ooze', 'hand', 'p2') }));
    s = passBoth(s);
    if (!targetable) return s;
    return resolveAll(drive(s, { targets: [[{ kind: 'object', id: ability }]] }));
  };
  it('is automated', () => { expect(full(SLIME), JSON.stringify(SLIME.automation)).toBe(true); });
  it('the ability of an artifact is countered and that artifact is destroyed', () => {
    const s = run(scenario([], { defs, p1: { battlefield: ['Test Gadget'] }, p2: { hand: ['Test Ooze'] } }), 'Test Gadget', true);
    expect(life(s, 'p1')).toBe(20);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Gadget')).toBe(false);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Gadget']);
  });
  it('the negative case: an ability of a creature that is no artifact or enchantment is not a legal target, and nothing is destroyed', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [{ name: 'Test Keeper' }] }, p2: { hand: ['Test Ooze'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Keeper', 'battlefield', 'p1'))!;
    let s = drive(act(s0, a.action));
    s = act(s, { type: 'pass', player: 'p1' });
    s = passBoth(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Ooze', 'hand', 'p2') })));
    expect((s.pending as unknown as { kind: string }).kind).not.toBe('chooseTargets'); // no legal target: the trigger is removed
    s = resolveAll(s);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Keeper')).toBe(true);
  });
});

describe('rulings: Transcendent Dragon ignores timing, Mudslide pays all or nothing', () => {
  it('a countered sorcery is cast for free anyway ("timing permissions based on the card\'s type are ignored")', () => {
    const PLAN = card('Test Plan', 'Sorcery', 'You gain 3 life.', '{0}');
    const DRAKE = card('Test Drake', 'Creature — Dragon', 'Flash\nWhen ~ enters, if you cast it, counter target spell. If that spell is countered this way, exile it instead of putting it into its owner\'s graveyard, then you may cast it without paying its mana cost.', '{0}', ['2', '2']);
    let s = cast(scenario([], { defs: [PLAN, DRAKE], p1: { hand: ['Test Plan'] }, p2: { hand: ['Test Drake'] } }), 'Test Plan');
    const spell = s.zones.stack[0]!;
    s = act(s, { type: 'pass', player: 'p1' });
    s = passBoth(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Drake', 'hand', 'p2') })));
    s = resolveAll(drive(s, { targets: [[{ kind: 'object', id: spell }]] }), { yes: [true] });
    expect(life(s, 'p2')).toBe(23);
    expect(life(s, 'p1')).toBe(20);
  });
  it('Mudslide: with too little mana nothing is paid and no chosen creature untaps', () => {
    const SLIDE = card('Test Mudflow', 'Enchantment', 'Creatures without flying don\'t untap during their controllers\' untap steps.\nAt the beginning of each player\'s upkeep, that player may choose any number of tapped creatures without flying they control and pay {2} for each creature chosen this way. If the player does, untap those creatures.', '{0}');
    const RED = card('Test Red Bear', 'Creature — Bear', '', '{0}', ['2', '2'], ['R']);
    const s0 = scenario([], { defs: [SLIDE, RED], p1: { battlefield: ['Test Mudflow'] }, p2: { battlefield: [{ name: 'Test Red Bear', tapped: true }, { name: 'Test Red Bear', tapped: true }, 'Plains', 'Plains'] } });
    let s = s0;
    for (let i = 0; i < 120 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'upkeep' && s.pending?.kind === 'priority' && s.zones.stack.length > 0); i++) {
      if (s.pending?.kind === 'declareAttackers') s = act(s, { type: 'answer', answer: { kind: 'declareAttackers', attacks: [] } } as never);
      else s = act(s, { type: 'pass', player: s.pending!.player as 'p1' | 'p2' });
    }
    s = passBoth(s);
    const p = s.pending as unknown as { options: string[] };
    s = resolveAll(drive(s, { objects: [p.options], yes: [true] }));
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Red Bear').map((id) => s.objects[id]!.tapped)).toEqual([true, true]);
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains' && !s.objects[id]!.tapped)).toHaveLength(2);
  });
});
