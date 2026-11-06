/**
 * Commander lane edh-cast, round edh-cast-15: the engine behavior of the round, played through the engine with synthetic cards (design 6.10). CR cites checked against the
 * Comprehensive Rules of 2026-09-25 where the record says so; the rest are named in the record as unverified.
 *
 *   CR 106.6, 603.2, 602.2   "When you spend this mana to cast a spell or activate an ability, copy that spell or ability" (Sunken Palace): the mana carries a triggered ability
 *                            that triggers when it pays for a spell, or for an ability that uses the stack; mana spent on a mana ability or paid by other mana triggers nothing
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, cost = '{0}', colors: string[] = [], extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, keywords: [], ...extra } as OracleCard);
}
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;

/** Answer decisions until the stack is empty and nothing but priority is pending (yes to every yes/no, automatic payment). */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const d = s.pending!;
    if (d.kind === 'priority') s = pass(s);
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
const castAndResolve = (s0: GameState, name: string): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }));

describe('CR 106.6, 603.2, 602.2: "When you spend this mana to cast a spell or activate an ability, copy that spell or ability" (rid.edhc15.mana.whenSpent.castOrActivate.copy)', () => {
  const CENOTE = card('Test Cenote', 'Land', '{T}: Add {U}. When you spend this mana to cast a spell or activate an ability, copy that spell or ability. You may choose new targets for the copy.', '');
  const TONIC = card('Test Blue Tonic', 'Instant', 'You gain 3 life.', '{U}', ['U']);
  const IDOL = card('Test Gain Idol', 'Artifact', '{U}: You gain 2 life.', '{0}');
  const CAT = card('Test Mana Cat', 'Artifact', '{U}, {T}: Add {G}.', '{0}');
  const defs = [CENOTE, TONIC, IDOL, CAT];
  it('is parsed and automated as a mana ability', () => {
    expect(CENOTE.automation.level).toBe('full');
    expect(CENOTE.faces[0]!.abilities.some((a) => a.kind === 'activated' && a.isMana === true)).toBe(true);
  });
  it('its mana spent on a spell copies it: the spell resolves twice', () => {
    const s = castAndResolve(scenario([], { p1: { hand: ['Test Blue Tonic'], battlefield: ['Test Cenote'] }, defs }), 'Test Blue Tonic');
    expect(life(s, 'p1')).toBe(26);
  });
  it('its mana spent to activate an ability that uses the stack copies that ability: it resolves twice', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Cenote', 'Test Gain Idol'] }, defs });
    const idol = find(s0, 'Test Gain Idol', 'battlefield', 'p1');
    const s = settle(act(s0, { type: 'activate', player: 'p1', source: idol, ability: 'p:0:0' }));
    expect(life(s, 'p1')).toBe(24);
  });
  it('other mana pays for the spell or the ability: nothing is copied (the negative case)', () => {
    const s0 = scenario(['Island'], { p1: { hand: ['Test Blue Tonic'], battlefield: ['Test Cenote', 'Island', 'Test Gain Idol'] }, defs });
    s0.objects[find(s0, 'Test Cenote', 'battlefield', 'p1')]!.tapped = true;
    expect(life(castAndResolve(s0, 'Test Blue Tonic'), 'p1')).toBe(23);
    const t0 = scenario(['Island'], { p1: { battlefield: ['Test Cenote', 'Island', 'Test Gain Idol'] }, defs });
    t0.objects[find(t0, 'Test Cenote', 'battlefield', 'p1')]!.tapped = true;
    const idol = find(t0, 'Test Gain Idol', 'battlefield', 'p1');
    expect(life(settle(act(t0, { type: 'activate', player: 'p1', source: idol, ability: 'p:0:0' })), 'p1')).toBe(22);
  });
  it('mana spent on a mana ability (no stack object) copies nothing and the mana is made (CR 605.3b, 707.10)', () => {
    const s0 = scenario([], { p1: { hand: [], battlefield: ['Test Cenote', 'Test Mana Cat'] }, defs });
    const cat = find(s0, 'Test Mana Cat', 'battlefield', 'p1');
    const s = settle(act(s0, { type: 'activate', player: 'p1', source: cat, ability: 'p:0:0' }));
    expect(s.zones.stack.length).toBe(0);
    expect(s.players.find((x) => x.id === 'p1')!.manaPool.length).toBe(1);
  });
});

/** Cast a card and answer decisions until the spell is on the stack and its caster has priority again (the spell is not resolved). */
function castHolding(s0: GameState, name: string): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let guard = 0; guard < 20 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}

describe('CR 707.10, 707.10c, 113.7a: "copy all spells you control, then copy all other activated and triggered abilities you control" (eff.edhc15.copy.all.spells.thenOtherAbilities)', () => {
  const ECHO = card('Test Echo Titan', 'Creature — Eldrazi', 'Whenever you cast an Eldrazi spell, you may pay {C}{C}. If you do, copy all spells you control, then copy all other activated and triggered abilities you control. You may choose new targets for the copies.', '{0}', [], { power: '4', toughness: '4' });
  const ROCK = card('Test Void Rock', 'Artifact', '{T}: Add {C}.', '{0}');
  const TONIC = card('Test Eldrazi Tonic', 'Kindred Instant — Eldrazi', 'You gain 3 life.', '{0}');
  const PLAIN = card('Test Plain Tonic', 'Instant', 'You gain 1 life.', '{0}');
  const IDOL = card('Test Gain Idol Zero', 'Artifact', '{0}: You gain 5 life.', '{0}');
  const defs = [ECHO, ROCK, TONIC, PLAIN, IDOL];
  const base = (): GameState => scenario([], { p1: { hand: ['Test Eldrazi Tonic', 'Test Plain Tonic'], battlefield: ['Test Echo Titan', 'Test Void Rock', 'Test Void Rock', 'Test Gain Idol Zero'] }, defs });
  it('is parsed and automated', () => {
    expect(ECHO.automation.level).toBe('full');
  });
  it('copies every spell of yours on the stack: the cast spell and the one it was cast on top of (CR 707.10)', () => {
    const s = settle(castHolding(castHolding(base(), 'Test Plain Tonic'), 'Test Eldrazi Tonic'));
    expect(life(s, 'p1')).toBe(28); // 1 + 1 (copy) + 3 + 3 (copy)
  });
  it('copies the other activated abilities of yours on the stack, but not the ability being resolved (CR 113.7a)', () => {
    const s0 = base();
    const idol = find(s0, 'Test Gain Idol Zero', 'battlefield', 'p1');
    const s1 = act(s0, { type: 'activate', player: 'p1', source: idol, ability: 'p:0:0' });
    const s = settle(castHolding(s1, 'Test Eldrazi Tonic'));
    expect(life(s, 'p1')).toBe(20 + 5 + 5 + 3 + 3); // the ability and its copy, the spell and its copy; the triggered ability is not copied (no second payment is asked)
  });
  it('declining the payment copies nothing (the negative case)', () => {
    let s = castHolding(castHolding(base(), 'Test Plain Tonic'), 'Test Eldrazi Tonic');
    for (let guard = 0; guard < 80 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    expect(life(s, 'p1')).toBe(24);
  });
  it('a spell that is not an Eldrazi does not trigger it (the negative case)', () => {
    const s = settle(castHolding(base(), 'Test Plain Tonic'));
    expect(life(s, 'p1')).toBe(21);
  });
});

describe('CR 707.12, 603.7, 601.2: "Whenever a creature you control deals combat damage to a player this turn, copy the exiled card. You may cast the copy without paying its mana cost." (rid.r4copy.mayCastCopy.free through a delayed trigger)', () => {
  const SURGE = card('Test Surge Rite', 'Sorcery', 'Exile target instant or sorcery card from your graveyard. Creatures you control get +X/+0 until end of turn, where X is that card\'s mana value. Whenever a creature you control deals combat damage to a player this turn, copy the exiled card. You may cast the copy without paying its mana cost.', '{0}');
  const FIRE = card('Test Warm Tonic', 'Instant', 'You gain 3 life.', '{2}');
  const RAIDER = card('Test Lone Raider', 'Creature — Human', '', '{0}', [], { power: '2', toughness: '2' });
  const defs = [SURGE, FIRE, RAIDER];
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Surge Rite'], graveyard: ['Test Warm Tonic'], battlefield: ['Test Lone Raider'] }, defs });
  /** Cast the Rite on the tonic in the graveyard, resolve it, then answer decisions through the attack (yes to every "may"); returns the state after combat damage. */
  function attackAfterRite(s0: GameState, attack: boolean, yes = true): GameState {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Surge Rite', 'hand', 'p1') });
    for (let guard = 0; guard < 120 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); guard++) {
      const d = s.pending!;
      if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Warm Tonic', 'graveyard', 'p1') }] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: attack ? [{ attacker: find(s, 'Test Lone Raider', 'battlefield', 'p1'), defender: 'p2' }] : [] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (d.kind === 'priority') s = pass(s);
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  }
  it('the Rite is parsed and automated', () => {
    expect(SURGE.automation.level).toBe('full');
  });
  it('combat damage to a player copies the exiled card and the copy is cast for free: the tonic resolves (CR 707.12), the exiled original stays in exile', () => {
    const s = attackAfterRite(setup(), true);
    expect(life(s, 'p1')).toBe(23);
    expect(life(s, 'p2')).toBe(20 - 4); // the raider got +2/+0 (the tonic's mana value)
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Warm Tonic')).toBe(true);
  });
  it('the player may decline to cast the copy (the negative case)', () => {
    const s = attackAfterRite(setup(), true, false);
    expect(life(s, 'p1')).toBe(20);
  });
  it('no combat damage to a player, no copy (the negative case)', () => {
    const s = attackAfterRite(setup(), false);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 707.10, 707.10c, 608.2d: "Each opponent may copy that spell ... You copy that spell once plus an additional time for each opponent who copied the spell this way" (eff.edhc15.eachOpponentMay.copy.newTargets, eff.edhc15.copy.oncePlus.eachOpponentWhoCopied)', () => {
  const OFFER = card('Test Tempting Mirror', 'Instant', 'Choose target instant or sorcery spell. Each opponent may copy that spell and may choose new targets for the copy they control. You copy that spell once plus an additional time for each opponent who copied the spell this way. You may choose new targets for the copies you control.', '{0}');
  const TONIC = card('Test Mirror Tonic', 'Instant', 'You gain 3 life.', '{0}');
  const defs = [OFFER, TONIC];
  const game = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Mirror Tonic', 'Test Tempting Mirror'] } } });
  /** p1 casts the tonic, then the Mirror targeting it; each opponent in `yes` copies the tonic (the question is asked of them in turn). */
  function play(yes: string[]): GameState {
    let s = act(game(), { type: 'cast', player: 'p1', card: find(game(), 'Test Mirror Tonic', 'hand', 'p1') });
    while (s.pending && s.pending.kind !== 'priority') s = answer(s, { kind: 'payCost', auto: true });
    const tonic = s.zones.stack[0]!;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tempting Mirror', 'hand', 'p1') });
    for (let guard = 0; guard < 200 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: tonic }] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: /new targets/i.test(d.prompt) ? false : yes.includes(d.player) });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
      else throw new Error(`unexpected decision ${d.kind} ${d.prompt}`);
    }
    return s;
  }
  const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  it('is parsed and automated', () => {
    expect(OFFER.automation.level).toBe('full');
  });
  it('two of three opponents copy it: they each get a copy and you get three (once plus one for each of them), and the original resolves too', () => {
    const s = play(['p2', 'p4']);
    expect(lifeOf(s, 'p1')).toBe(20 + 3 * 4); // the original and three copies
    expect(lifeOf(s, 'p2')).toBe(23);
    expect(lifeOf(s, 'p3')).toBe(20);
    expect(lifeOf(s, 'p4')).toBe(23);
  });
  it('no opponent copies it: you copy it once (the negative case)', () => {
    const s = play([]);
    expect(lifeOf(s, 'p1')).toBe(20 + 3 * 2);
    for (const p of ['p2', 'p3', 'p4']) expect(lifeOf(s, p)).toBe(20);
  });
  it('it can not target itself (ruling 2024-06-07): with no other spell on the stack it can not be cast', () => {
    const s0 = game();
    expect(() => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tempting Mirror', 'hand', 'p1') })).toThrow(/Action rejected/);
  });
});

describe('CR 118.8, 601.2b, 603.12, 707.10: "As an additional cost to cast this spell, you may sacrifice one or more creatures. When you do, copy this spell for each creature sacrificed this way." (cm.edhc15.additional.sacrificeOneOrMore.copyForEach)', () => {
  const RITE = card('Test Hoard Rite', 'Instant', 'As an additional cost to cast this spell, you may sacrifice one or more creatures. When you do, copy this spell for each creature sacrificed this way.\nYou gain 2 life.', '{0}');
  const PEON = card('Test Hoard Peon', 'Creature — Goblin', '', '{0}', [], { power: '1', toughness: '1' });
  const defs = [RITE, PEON];
  const game = (): GameState => scenario([], { p1: { hand: ['Test Hoard Rite'], battlefield: ['Test Hoard Peon', 'Test Hoard Peon', 'Test Hoard Peon'] }, defs });
  /** Cast the Rite announcing `n` creatures for its cost (0: not paying it), sacrificing the first ones offered; then resolve everything. */
  function play(n: number): GameState {
    const s0 = game();
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Hoard Rite', 'hand', 'p1') });
    for (let guard = 0; guard < 120 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority') || s.zones.stack.length === 0 && guard === 0); guard++) {
      const d = s.pending;
      if (d === null || d === undefined) break;
      if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
      else throw new Error(`unexpected decision ${d.kind} ${d.prompt}`);
    }
    return s;
  }
  const peons = (s: GameState): number => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Hoard Peon').length;
  it('is parsed and automated', () => {
    expect(RITE.automation.level).toBe('full');
  });
  it('sacrificing two creatures makes two copies: the spell resolves three times', () => {
    const s = play(2);
    expect(peons(s)).toBe(1);
    expect(life(s, 'p1')).toBe(20 + 2 * 3);
  });
  it('sacrificing one creature makes one copy', () => {
    const s = play(1);
    expect(peons(s)).toBe(2);
    expect(life(s, 'p1')).toBe(20 + 2 * 2);
  });
  it('not paying the cost makes no copy and sacrifices nothing (the negative case)', () => {
    const s = play(0);
    expect(peons(s)).toBe(3);
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 702.60a, 604.1, 613.1f: "Spells you cast have ripple 2" (sta.edhc15.spells.cast.ripple; ripple, keywords/data/ripple.json)', () => {
  const STONE = card('Test Echo Stone', 'Legendary Artifact', 'Spells you cast have ripple 2.', '{0}');
  const TONIC = card('Test Ripple Tonic', 'Instant', 'You gain 1 life.', '{0}');
  const OTHER = card('Test Other Tonic', 'Instant', 'You gain 5 life.', '{0}');
  const defs = [STONE, TONIC, OTHER];
  const game = (library: string[], battlefield = ['Test Echo Stone']): GameState => scenario([], { p1: { hand: ['Test Ripple Tonic'], battlefield, library }, defs });
  function play(s0: GameState, yes = true): GameState {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ripple Tonic', 'hand', 'p1') });
    for (let guard = 0; guard < 200 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.max) });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
      else throw new Error(`unexpected decision ${d.kind} ${d.prompt}`);
    }
    return s;
  }
  it('is parsed and automated', () => {
    expect(STONE.automation.level).toBe('full');
  });
  it('a spell with the same name among the revealed cards is cast free, and ripples again (CR 702.60a): three resolutions in all', () => {
    const s = play(game(['Test Ripple Tonic', 'Plains', 'Test Ripple Tonic', 'Plains']));
    expect(life(s, 'p1')).toBe(23);
  });
  it('a spell of another name among the revealed cards is not cast (the negative case), and the rest goes to the bottom of the library', () => {
    const s = play(game(['Test Other Tonic', 'Plains']));
    expect(life(s, 'p1')).toBe(21);
    const lib = s.zones.library['p1']!;
    expect(s.defs[s.objects[lib[lib.length - 1]!]!.defId]!.name).toBeDefined();
    expect(lib.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Other Tonic').length).toBe(1);
    expect(lib.indexOf(lib.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Other Tonic')!)).toBeGreaterThan(10);
  });
  it('declining to reveal does nothing (the negative case)', () => {
    const s = play(game(['Test Ripple Tonic', 'Plains']), false);
    expect(life(s, 'p1')).toBe(21);
  });
  it('without the Stone the spell has no ripple (the negative case)', () => {
    const s = play(game(['Test Ripple Tonic', 'Plains'], []));
    expect(life(s, 'p1')).toBe(21);
  });
});

describe('CR 115.1, 608.2b, 603.3d: "choose another target player" in a cast trigger (eff.edhc15.choose.anotherTargetPlayer.thanCaster; target.players.otherThan)', () => {
  const LORD = card('Test Pain Lord', 'Legendary Creature — Human', 'Whenever a player casts their first spell each turn, choose another target player. ~ deals damage equal to that spell\'s mana value to the chosen player.', '{0}', [], { power: '2', toughness: '2' });
  const BOLT = card('Test Pain Tonic', 'Instant', 'You gain 1 life.', '{1}{R}');
  const defs = [LORD, BOLT];
  const game = (): GameState => mpScenario({ defs, cards: ['Mountain'], zones: { p1: { hand: ['Test Pain Tonic', 'Test Pain Tonic'], battlefield: ['Test Pain Lord', 'Mountain', 'Mountain', 'Mountain', 'Mountain'] } } });
  const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  it('is parsed and automated', () => {
    expect(LORD.automation.level).toBe('full');
  });
  it('the caster is not a legal target; another player takes damage equal to the spell\'s mana value (CR 115.1)', () => {
    let s = act(game(), { type: 'cast', player: 'p1', card: find(game(), 'Test Pain Tonic', 'hand', 'p1') });
    while (s.pending && s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    // the trigger asks its controller for the target as it is put on the stack
    expect(s.pending!.kind).toBe('chooseTargets');
    expect(() => answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] })).toThrow(/legal target/);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] });
    for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); guard++) s = s.pending?.kind === 'priority' ? pass(s) : answer(s, { kind: 'payCost', auto: true });
    expect(lifeOf(s, 'p3')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('each player\'s first spell triggers it: after my first spell, the first spell of p2 triggers it again, and p2 is not a legal target for that trigger', () => {
    const mp = mpScenario({ defs, cards: ['Mountain'], zones: { p1: { hand: ['Test Pain Tonic'], battlefield: ['Test Pain Lord', 'Mountain', 'Mountain'] }, p2: { hand: ['Test Pain Tonic'], battlefield: ['Mountain', 'Mountain'] } } });
    let s = act(mp, { type: 'cast', player: 'p1', card: find(mp, 'Test Pain Tonic', 'hand', 'p1') });
    while (s.pending && s.pending.kind !== 'priority') {
      s = s.pending.kind === 'payCost' ? answer(s, { kind: 'payCost', auto: true }) : answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] });
    }
    for (let guard = 0; guard < 40 && s.zones.stack.length > 0; guard++) s = pass(s);
    expect(lifeOf(s, 'p3')).toBe(18);
    // p1 passes with an empty stack: p2 may cast their first spell of the turn
    s = pass(s);
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Pain Tonic', 'hand', 'p2') });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.pending!.kind).toBe('chooseTargets'); // the trigger (controlled by p1) asks for its target
    expect(() => answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] })).toThrow(/legal target/);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p4' }] });
    for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : answer(s, { kind: 'payCost', auto: true });
    expect(lifeOf(s, 'p4')).toBe(18);
  });
  it('only the first spell each turn triggers it (the negative case)', () => {
    let s = act(game(), { type: 'cast', player: 'p1', card: find(game(), 'Test Pain Tonic', 'hand', 'p1') });
    while (s.pending && s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    for (let guard = 0; guard < 40 && s.zones.stack.length > 0; guard++) s = s.pending?.kind === 'priority' ? pass(s) : answer(s, { kind: 'payCost', auto: true });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pain Tonic', 'hand', 'p1') });
    while (s.pending && s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    expect(s.pending?.kind).toBe('priority'); // no second trigger: nothing to target
    expect(s.zones.stack.length).toBe(1);
  });
});

describe('CR 601.2f, 118.7a, 115.9b: "~ costs {7} less to cast if it targets a spell or ability that targets a creature you control with power 7 or greater" (cm.edhc15.self.less.ifTargetsSpellThatTargets)', () => {
  const SHIELD = card('Test Void Shield', 'Kindred Instant — Eldrazi', 'Counter target spell or ability that targets a permanent you control.\n~ costs {7} less to cast if it targets a spell or ability that targets a creature you control with power 7 or greater.', '{7}');
  const HURL = card('Test Small Hurl', 'Instant', '~ deals 1 damage to target creature.', '{0}');
  const BIG = card('Test Big Giant', 'Creature — Giant', '', '{0}', [], { power: '7', toughness: '7' });
  const SMALL = card('Test Small Imp', 'Creature — Imp', '', '{0}', [], { power: '6', toughness: '6' });
  const defs = [SHIELD, HURL, BIG, SMALL];
  /** p1 casts the Hurl at their creature, then (holding priority) tries the Shield on it. */
  function shieldOn(creature: string): GameState {
    const s0 = scenario([], { p1: { hand: ['Test Small Hurl', 'Test Void Shield'], battlefield: [creature] }, defs });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Small Hurl', 'hand', 'p1') });
    while (s.pending?.kind === 'chooseTargets' || s.pending?.kind === 'payCost') {
      s = s.pending.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, creature, 'battlefield', 'p1') }] }) : answer(s, { kind: 'payCost', auto: true });
    }
    return s;
  }
  const castShield = (s: GameState): GameState => {
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Void Shield', 'hand', 'p1') });
    while (t.pending?.kind === 'chooseTargets' || t.pending?.kind === 'payCost') {
      t = t.pending.kind === 'chooseTargets' ? answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: s.zones.stack[0]! }] }) : answer(t, { kind: 'payCost', auto: true });
    }
    return t;
  };
  it('is parsed and automated, with one reading', () => {
    expect(SHIELD.automation.level).toBe('full');
  });
  it('a spell that targets a creature with power 7 makes it cost {7} less: it is cast with no mana, and counters the spell', () => {
    const t = castShield(shieldOn('Test Big Giant'));
    expect(t.zones.stack.length).toBe(2);
  });
  it('a spell that targets a creature with power 6 does not (the negative case): the cast is refused, nothing can pay {7}', () => {
    const s = shieldOn('Test Small Imp');
    expect(() => castShield(s)).toThrow(/Action rejected/);
  });
});

describe('CR 401.4, 400.3, 115.1: "choose up to one target creature spell or planeswalker spell. Its owner puts it on their choice of the top or bottom of their library." (eff.edhc15.owner.putsIt.topOrBottom; target lists of spells)', () => {
  const WISP = card('Test Shifting Wisp', 'Creature — Elemental', 'Flash\nWhen this creature enters, choose up to one target creature spell or planeswalker spell. Its owner puts it on their choice of the top or bottom of their library.', '{0}', [], { power: '1', toughness: '1' });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', '{0}', [], { power: '2', toughness: '2' });
  const TONIC = card('Test Mere Tonic', 'Instant', 'You gain 3 life.', '{0}');
  const defs = [WISP, BEAR, TONIC];
  const bears = (s: GameState): number => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Plain Bear').length;
  /** p1 casts `first`, holds priority and casts the Wisp; the Wisp's trigger targets the first spell if it may; the owner picks `end`. */
  function play(first: string, end: 'top' | 'bottom'): GameState {
    const s0 = scenario([], { p1: { hand: [first, 'Test Shifting Wisp'] }, defs });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, first, 'hand', 'p1') });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shifting Wisp', 'hand', 'p1') });
    for (let guard = 0; guard < 80 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: d.objects.length > 0 ? [{ kind: 'object', id: d.objects[0]! }] : [] });
      else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [end] });
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
      else throw new Error(`unexpected decision ${d.kind} ${d.prompt}`);
    }
    return s;
  }
  const libraryNames = (s: GameState): string[] => s.zones.library['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name);
  it('is parsed and automated', () => {
    expect(WISP.automation.level).toBe('full');
  });
  it('a creature spell is put on the top of its owner\'s library, its owner choosing; it does not resolve and is not countered (CR 401.4)', () => {
    const s = play('Test Plain Bear', 'top');
    expect(bears(s)).toBe(0);
    expect(libraryNames(s)[0]).toBe('Test Plain Bear');
    expect(s.zones.graveyard['p1']!.length).toBe(0);
  });
  it('or on the bottom', () => {
    const s = play('Test Plain Bear', 'bottom');
    expect(bears(s)).toBe(0);
    const names = libraryNames(s);
    expect(names[names.length - 1]).toBe('Test Plain Bear');
  });
  it('an instant spell is not a legal target (the negative case): the trigger has none, and the spell resolves', () => {
    const s = play('Test Mere Tonic', 'top');
    expect(s.players.find((x) => x.id === 'p1')!.life).toBe(23);
  });
});

describe('CR 608.2c, 400.7, 601.2: "exile the top card of your library. If it\'s a Goblin creature card, you may cast that card until the end of your next turn" ("it" and "that card" are the exiled card, not the creature that died)', () => {
  const MASTER = card('Test Goblin Chief', 'Creature — Goblin Warrior', 'Whenever ~ or another Goblin you control dies, exile the top card of your library. If it\'s a Goblin creature card, you may cast that card until the end of your next turn.', '{0}', [], { power: '2', toughness: '2' });
  const GOB = card('Test Cave Goblin', 'Creature — Goblin', '', '{0}', [], { power: '1', toughness: '1' });
  const BEAR = card('Test Wild Bear', 'Creature — Bear', '', '{0}', [], { power: '2', toughness: '2' });
  const ZAP = card('Test Quick Zap', 'Instant', 'Destroy target creature.', '{0}');
  const defs = [MASTER, GOB, BEAR, ZAP];
  /** p1 destroys their own Cave Goblin with the Chief out; the library's top card is `top`. Returns the state after everything resolved. */
  function play(top: string): GameState {
    const s0 = scenario([], { p1: { hand: ['Test Quick Zap'], battlefield: ['Test Goblin Chief', 'Test Cave Goblin'], library: [top] }, defs });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Quick Zap', 'hand', 'p1') });
    for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority') || guard === 0); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
      else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Cave Goblin', 'battlefield', 'p1') }] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
      else throw new Error(`unexpected decision ${d.kind} ${d.prompt}`);
    }
    return s;
  }
  it('is parsed and automated', () => {
    expect(MASTER.automation.level).toBe('full');
  });
  it('a Goblin creature card on top is exiled and may be cast from exile (the Goblin that died is not that card)', () => {
    const s = play('Test Cave Goblin');
    const exiled = s.zones.exile.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Cave Goblin');
    expect(exiled).toBeDefined();
    const t = act(s, { type: 'cast', player: 'p1', card: exiled! });
    expect(t.zones.stack.length).toBe(1);
  });
  it('a card that is not a Goblin creature card is exiled but can not be cast (the negative case)', () => {
    const s = play('Test Wild Bear');
    const exiled = s.zones.exile.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Wild Bear');
    expect(exiled).toBeDefined();
    expect(() => act(s, { type: 'cast', player: 'p1', card: exiled! })).toThrow(/Action rejected/);
  });
});

describe('CR 601.2, 608.2d, 118.9, 614.1a, 202.3: "You may cast up to two instant and/or sorcery spells with total mana value 6 or less from your graveyard and/or hand without paying their mana costs. If those spells would be put into your graveyard, exile them instead. Exile ~." (eff.edhc15.cast.upTo.instantSorcery.totalMV.graveyardOrHand.free)', () => {
  const CALAMITY = card('Test Rite of Ruin', 'Instant', 'You may cast up to two instant and/or sorcery spells with total mana value 6 or less from your graveyard and/or hand without paying their mana costs. If those spells would be put into your graveyard, exile them instead. Exile Test Rite of Ruin.', '{1}{R}{R}{R}{R}');
  const FOUR = card('Test Four Tonic', 'Instant', 'You gain 4 life.', '{4}');
  const THREE = card('Test Three Tonic', 'Sorcery', 'You gain 3 life.', '{3}');
  const TWO = card('Test Two Tonic', 'Instant', 'You gain 2 life.', '{2}');
  const CREATURE = card('Test Heavy Bear', 'Creature — Bear', '', '{1}', [], { power: '2', toughness: '2' });
  const defs = [CALAMITY, FOUR, THREE, TWO, CREATURE];
  const setup = (): GameState => scenario([], { p1: { hand: ['Test Rite of Ruin', 'Test Two Tonic', 'Test Heavy Bear'], graveyard: ['Test Four Tonic', 'Test Three Tonic'] }, defs });
  function play(pick: (names: Map<string, string>) => string[] | null): GameState {
    const s0 = setup();
    // the Rite costs {1}{R}{R}{R}{R}: the test pays it from the pool by giving the player the mana
    s0.players.find((p) => p.id === 'p1')!.manaPool.push(...Array.from({ length: 5 }, () => ({ type: 'R' as const })));
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rite of Ruin', 'hand', 'p1') });
    for (let guard = 0; guard < 100 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseObjects') {
        const names = new Map(d.options.map((id) => [s.defs[s.objects[id]!.defId]!.name, id]));
        const wanted = pick(names);
        s = answer(s, { kind: 'chooseObjects', ids: (wanted ?? []).map((n) => names.get(n)!).filter((x) => x !== undefined) });
      } else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
      else throw new Error(`unexpected decision ${d.kind} ${d.prompt}`);
    }
    return s;
  }
  const inZone = (s: GameState, zone: 'exile' | 'graveyard', name: string): boolean =>
    (zone === 'exile' ? s.zones.exile : s.zones.graveyard['p1']!).some((id) => s.defs[s.objects[id]!.defId]!.name === name);
  it('is parsed and automated', () => {
    expect(CALAMITY.automation.level).toBe('full');
  });
  it('casts a spell from the graveyard and one from the hand for free (total mana value 6): both resolve, both are exiled, and so is the Rite', () => {
    const s = play((names) => ['Test Four Tonic', 'Test Two Tonic'].filter((n) => names.has(n)));
    expect(s.players.find((x) => x.id === 'p1')!.life).toBe(26);
    expect(inZone(s, 'exile', 'Test Four Tonic')).toBe(true);
    expect(inZone(s, 'exile', 'Test Two Tonic')).toBe(true);
    expect(inZone(s, 'exile', 'Test Rite of Ruin')).toBe(true);
    expect(inZone(s, 'graveyard', 'Test Four Tonic')).toBe(false);
  });
  it('a creature card is not among the spells that can be chosen, and total mana value 7 is refused (the negative cases)', () => {
    let seen: string[] = [];
    play((names) => { seen = [...names.keys()]; return []; });
    expect(seen.sort()).toEqual(['Test Four Tonic', 'Test Three Tonic', 'Test Two Tonic']);
    expect(() => play((names) => ['Test Four Tonic', 'Test Three Tonic'].filter((n) => names.has(n)))).toThrow(/Action rejected|limit|total/i);
  });
  it('casting nothing still exiles the Rite (the spell is never put into the graveyard)', () => {
    const s = play(() => []);
    expect(inZone(s, 'exile', 'Test Rite of Ruin')).toBe(true);
    expect(s.players.find((x) => x.id === 'p1')!.life).toBe(20);
  });
});

describe('CR 701.6a, 115.1, 101.2: "Spells you control can\'t be countered by blue or black spells this turn, and creatures you control can\'t be the targets of blue or black spells this turn." (eff.edhc15.cantBeCounteredOrTargeted.byBlueOrBlackSpells.thisTurn)', () => {
  const VEIL = card('Test Autumn Cloak', 'Instant', 'Spells you control can\'t be countered by blue or black spells this turn, and creatures you control can\'t be the targets of blue or black spells this turn.', '{0}', ['G']);
  const BEAR = card('Test Veil Bear', 'Creature — Bear', '', '{0}', ['G'], { power: '2', toughness: '2' });
  const CANCEL = card('Test Blue Cancel', 'Instant', 'Counter target spell.', '{0}', ['U']);
  const BLUE_ZAP = card('Test Blue Zap', 'Instant', 'Destroy target creature.', '{0}', ['U']);
  const RED_ZAP = card('Test Red Zap', 'Instant', 'Destroy target creature.', '{0}', ['R']);
  const defs = [VEIL, BEAR, CANCEL, BLUE_ZAP, RED_ZAP];
  const base = (hand2: string[], veil: boolean): GameState => {
    let s = scenario([], { p1: { hand: veil ? ['Test Autumn Cloak', 'Test Veil Bear'] : ['Test Veil Bear'], battlefield: veil ? [] : [] }, p2: { hand: hand2 }, defs });
    if (veil) { s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Autumn Cloak', 'hand', 'p1') }); while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true }); s = pass(pass(s)); }
    return s;
  };
  /** p1 casts the bear; p2 casts `card` (at the bear), and everything resolves. */
  function respond(s0: GameState, card: string): GameState {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Veil Bear', 'hand', 'p1') });
    while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = pass(s); // p1 passes: p2 may respond
    s = act(s, { type: 'cast', player: 'p2', card: find(s, card, 'hand', 'p2') });
    for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = pass(s);
      else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: d.objects.length > 0 ? [{ kind: 'object', id: d.objects[0]! }] : [] });
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind} ${d.prompt}`);
    }
    return s;
  }
  const bears = (s: GameState): number => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Veil Bear').length;
  it('is parsed and automated', () => {
    expect(VEIL.automation.level).toBe('full');
  });
  it('a blue spell does not counter my spell once the Cloak has resolved (the spell resolves)', () => {
    expect(bears(respond(base(['Test Blue Cancel'], true), 'Test Blue Cancel'))).toBe(1);
  });
  it('without the Cloak the blue spell counters it (the negative case)', () => {
    expect(bears(respond(base(['Test Blue Cancel'], false), 'Test Blue Cancel'))).toBe(0);
  });
  it('a blue spell can not target a creature I control: the red one can (CR 115.1)', () => {
    const afterCloak = (zap: string): GameState => {
      let s = scenario([], { p1: { hand: ['Test Autumn Cloak'], battlefield: ['Test Veil Bear'] }, p2: { hand: [zap] }, defs });
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Autumn Cloak', 'hand', 'p1') });
      while (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      return pass(pass(pass(s))); // p1 passes, p2 passes (the Cloak resolves), p1 passes with an empty stack: p2 has priority
    };
    const blue = afterCloak('Test Blue Zap');
    expect(() => act(blue, { type: 'cast', player: 'p2', card: find(blue, 'Test Blue Zap', 'hand', 'p2') })).toThrow(/Action rejected/);
    const red = afterCloak('Test Red Zap');
    let t = act(red, { type: 'cast', player: 'p2', card: find(red, 'Test Red Zap', 'hand', 'p2') });
    while (t.pending?.kind === 'chooseTargets' || t.pending?.kind === 'payCost') {
      t = t.pending.kind === 'chooseTargets' ? answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Test Veil Bear', 'battlefield', 'p1') }] }) : answer(t, { kind: 'payCost', auto: true });
    }
    expect(t.zones.stack.length).toBe(1);
  });
});
