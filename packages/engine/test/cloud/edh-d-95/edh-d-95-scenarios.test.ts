/**
 * edh-d-95 (EDHREC band 5,001-10,000, group counters): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names; the wordings are the real cards', because the readings read exactly them). Scryfall rulings were fetched in the cloud session; CR cites checked
 * against the 2026-09-25 Comprehensive Rules text unless the record lists them as unverified.
 *
 *   CR 608.2c, 603.2h, 118.12, 107.3   "you may pay X life, where X is that spell's mana value. If you do, create a 1/1 colorless Hero creature token and put X +1/+1
 *                                      counters on it. Do this only once each turn." (G'raha Tia, Scion Reborn)
 *   CR 608.2c, 601.3, 400.3, 109.5      "each player exiles the top card of their library. Until your next end step, each player may play the card they exiled this way." and
 *                                      "Whenever a player ... casts a spell from exile, you put a +1/+1 counter on target creature and create a Food token." (Rocco, Street Chef)
 *   CR 701.50a, 701.50c, 702.26b        "Each of X target creatures you control connive. You may have any number of them phase out." (Change of Plans)
 *   CR 602.2b, 608.2h, 614.15, 122.1h   "Sacrifice another creature: Create a Blood token. If you sacrificed an Angel this way, create a number of Blood tokens equal to its toughness
 *                                      instead." and "... Return each creature card from your graveyard to the battlefield with a finality counter on it. Those creatures are
 *                                      Vampires in addition to their other types." (Shilgengar, Sire of Famine)
 *   CR 603.2c, 202.3, 608.2h, 603.2h    "Whenever one or more cards leave your graveyard, you may create a 1/1 black and green Insect creature token, then put a number of +1/+1
 *                                      counters on it equal to the greatest mana value among those cards. Do this only once each turn." (Amzu, Swarm's Hunger)
 *   CR 608.2d, 208.1, 607.2d, 115.10    "You may put a +1/+1 counter on a creature. Then choose odd or even. Return each creature with power of the chosen quality to its owner's
 *                                      hand." (Zimone's Hypothesis)
 *   CR 608.2c, 400.7, 608.2h            "you may exile target creature card from a graveyard. If you do, create a 1/1 white Spirit creature token with flying. Put a +1/+1 counter on
 *                                      it if the exiled card's mana value is 4 or greater." (Summoner's Sending)
 *   CR 607.2a, 603.2, 603.6c, 701.19c   "At the beginning of each end step and when this enchantment leaves the battlefield, destroy all tokens created with this enchantment.
 *                                      They can't be regenerated." (Tombstone Stairwell)
 *   CR 611.2, 601.3b, 101.2, 614.1c     "The next creature spell you cast this turn can be cast as though it had flash. That spell can't be countered. That creature enters with an
 *                                      additional +1/+1 counter on it." (Savage Summoning)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type GameState, type ObjectId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, life, scenario } from '../../m3/scenario';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { card, cast, counters, full, pt, resolveAll, tokens } from '../cmd3/helpers';

// ---- G'raha Tia, Scion Reborn ------------------------------------------------------------------------------------------------------------------------------------------
const SCION = card('Test Scion', 'Legendary Creature — Cat Wizard', "Lifelink\nWhenever you cast a noncreature spell, you may pay X life, where X is that spell's mana value. If you do, create a 1/1 colorless Hero creature token and put X +1/+1 counters on it. Do this only once each turn.", ['2', '3']);
const TRINKET = card('Test Trinket', 'Artifact', '', undefined, '{0}');
const IDOL = card('Test Idol', 'Artifact', '', undefined, '{3}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');

describe("CR 603.2h, 118.12, 107.3: \"you may pay X life, where X is that spell's mana value. If you do, create a 1/1 ... token and put X +1/+1 counters on it. Do this only once each turn.\"", () => {
  const setup = (hand: string[], lands = 6): GameState => scenario(['Wastes'], { defs: [SCION, TRINKET, IDOL, OGRE], p1: { hand, battlefield: ['Test Scion', ...Array.from({ length: lands }, () => 'Wastes')] } });
  it('is automated', () => expect(full(SCION)).toBe(true));
  it('paying 3 life for a mana value 3 spell makes a Hero token with three +1/+1 counters (the token, not the spell or ~, gets them)', () => {
    let s = setup(['Test Idol']);
    s = resolveAll(cast(s, 'Test Idol'), { yes: true });
    expect(life(s, 'p1')).toBe(17);
    const made = tokens(s);
    expect(made.length).toBe(1);
    expect(counters(s, made[0]!, '+1/+1')).toBe(3);
    expect(pt(s, made[0]!)).toBe('4/4');
  });
  it('the negative case: declining pays no life and makes no token', () => {
    let s = setup(['Test Idol']);
    s = resolveAll(cast(s, 'Test Idol'), { yes: false });
    expect(life(s, 'p1')).toBe(20);
    expect(tokens(s).length).toBe(0);
  });
  it('the negative case: a creature spell does not trigger it', () => {
    let s = setup(['Test Ogre']);
    s = resolveAll(cast(s, 'Test Ogre'), { yes: true });
    expect(life(s, 'p1')).toBe(20);
    expect(tokens(s).length).toBe(0);
  });
  it('CR 603.2h: only once each turn: after paying once, a second noncreature spell that turn does nothing', () => {
    let s = setup(['Test Idol', 'Test Trinket']);
    s = resolveAll(cast(s, 'Test Idol'), { yes: true });
    s = resolveAll(cast(s, 'Test Trinket'), { yes: true });
    expect(tokens(s).length).toBe(1);
    expect(life(s, 'p1')).toBe(17);
  });
  it('CR 603.2h: declining the first time keeps the action open: the second spell that turn may still make the token', () => {
    let s = setup(['Test Trinket', 'Test Idol']);
    s = resolveAll(cast(s, 'Test Trinket'), { yes: false });
    expect(tokens(s).length).toBe(0);
    s = resolveAll(cast(s, 'Test Idol'), { yes: true });
    expect(tokens(s).length).toBe(1);
    expect(counters(s, tokens(s)[0]!, '+1/+1')).toBe(3);
  });
  it('a mana value 0 spell: paying 0 life makes a 1/1 Hero with no counters', () => {
    let s = setup(['Test Trinket']);
    s = resolveAll(cast(s, 'Test Trinket'), { yes: true });
    expect(life(s, 'p1')).toBe(20);
    expect(tokens(s).length).toBe(1);
    expect(pt(s, tokens(s)[0]!)).toBe('1/1');
  });
});

/** Pass priority to the given step of the current turn, declaring no attackers or blockers; stops with the triggers of the step on the stack. */
function goTo(s0: GameState, step: string, targets?: (s: GameState) => TargetChoice[]): GameState {
  let s = s0;
  for (let guard = 0; guard < 200; guard++) {
    const d = s.pending;
    if (d === undefined || d === null) throw new Error('no decision pending');
    if (d.kind === 'priority' && s.turn.step === step) return s;
    if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'chooseTargets' && targets !== undefined) s = answer(s, { kind: 'chooseTargets', targets: targets(s) });
    else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
    else throw new Error(`unexpected decision ${d.kind} on the way to ${step}`);
  }
  throw new Error(`never reached ${step}`);
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const canCast = (s: GameState, player: string, id: ObjectId): boolean => legalActions(s, player).some((a) => a.kind === 'cast' && a.object === id);

// ---- Rocco, Street Chef ------------------------------------------------------------------------------------------------------------------------------------------------
const CHEF = card('Test Chef', 'Legendary Creature — Elf Druid', 'At the beginning of your end step, each player exiles the top card of their library. Until your next end step, each player may play the card they exiled this way.\nWhenever a player plays a land from exile or casts a spell from exile, you put a +1/+1 counter on target creature and create a Food token.', ['2', '4']);
const QUICK = card('Test Quick Thought', 'Instant', 'You gain 1 life.');
const SLOW = card('Test Slow Thought', 'Instant', 'You gain 2 life.');

describe('CR 608.2c, 400.3: "each player exiles the top card of their library. Until your next end step, each player may play the card they exiled this way."', () => {
  const setup = (): GameState => scenario([], { defs: [CHEF, QUICK, SLOW], p1: { library: ['Test Quick Thought'], battlefield: ['Test Chef'] }, p2: { library: ['Test Slow Thought'] } });
  it('is automated', () => expect(full(CHEF)).toBe(true));
  it('at your end step each player exiles their top card; each may cast their own, not the other player\'s (ownOnly)', () => {
    let s = resolveAll(goTo(setup(), 'end'));
    const mine = find(s, 'Test Quick Thought', 'exile');
    const theirs = find(s, 'Test Slow Thought', 'exile');
    expect(s.zones.exile).toContain(mine);
    expect(s.zones.exile).toContain(theirs);
    expect(canCast(s, 'p1', mine)).toBe(true);
    expect(canCast(s, 'p1', theirs)).toBe(false);
    s = act(s, { type: 'pass', player: 'p1' });
    expect(canCast(s, 'p2', theirs)).toBe(true);
    expect(canCast(s, 'p2', mine)).toBe(false);
  });
  it('a spell cast from exile (by any player) makes Rocco\'s controller put a +1/+1 counter on target creature and create a Food token for themselves', () => {
    let s = resolveAll(goTo(setup(), 'end'));
    const chef = find(s, 'Test Chef', 'battlefield');
    const theirs = find(s, 'Test Slow Thought', 'exile');
    s = act(s, { type: 'pass', player: 'p1' });
    s = act(s, { type: 'cast', player: 'p2', card: theirs });
    s = resolveAll(s, { targets: [obj(chef)] });
    expect(life(s, 'p2')).toBe(22);
    expect(counters(s, chef, '+1/+1')).toBe(1);
    expect(tokens(s, 'p1').length).toBe(1);
    expect(tokens(s, 'p2').length).toBe(0);
  });
  it('the negative case: a spell cast from hand does not trigger it', () => {
    let s = scenario([], { defs: [CHEF, QUICK], p1: { hand: ['Test Quick Thought'], battlefield: ['Test Chef'] } });
    const chef = find(s, 'Test Chef', 'battlefield');
    s = resolveAll(cast(s, 'Test Quick Thought'), { targets: [obj(chef)] });
    expect(counters(s, chef, '+1/+1')).toBe(0);
    expect(tokens(s).length).toBe(0);
  });
  it('the permission lasts through the other player\'s turn until your next end step; at that end step the old cards can no longer be played', () => {
    let s = resolveAll(goTo(setup(), 'end'));
    const mine = find(s, 'Test Quick Thought', 'exile');
    // to the next turn (p2's), then to p1's next end step
    s = goTo(s, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
    s = act(s, { type: 'pass', player: 'p2' }); // p1 gets priority in p2's upkeep
    expect(canCast(s, 'p1', mine)).toBe(true);
    s = goTo(s, 'end');
    s = goTo(s, 'upkeep');
    expect(s.turn.activePlayer).toBe('p1');
    s = goTo(s, 'end');
    s = resolveAll(s);
    expect(canCast(s, 'p1', mine)).toBe(false);
  });
});

// ---- Change of Plans --------------------------------------------------------------------------------------------------------------------------------------------------
const PLANS = card('Test Shift of Schemes', 'Instant', 'Each of X target creatures you control connive. You may have any number of them phase out.', undefined, '{X}');
const SNACK = card('Test Snack', 'Sorcery', 'You gain 1 life.');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);

/** Cast the X spell with X = x at these targets, then answer every decision with `on` (null: the default) until a player has priority again; let it resolve. */
function castX(s0: GameState, x: number, targets: TargetChoice[], on: (d: NonNullable<GameState['pending']>, s: GameState) => Parameters<typeof answer>[1] | null): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shift of Schemes', 'hand', 'p1') });
  for (let guard = 0; guard < 60; guard++) {
    const d = s.pending;
    if (d === undefined || d === null) break;
    if (d.kind === 'priority') {
      if (s.zones.stack.length === 0) break;
      s = act(s, { type: 'pass', player: d.player });
      continue;
    }
    const mine = on(d, s);
    if (mine !== null) s = answer(s, mine);
    else if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as { items: { id: string }[] }).items.map((it) => it.id) });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d as { options: ObjectId[]; min: number }).options.slice(0, (d as { min: number }).min) });
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
const phased = (s: GameState, id: ObjectId): boolean => s.objects[id]?.phasedOut === true;

describe('CR 701.50a, 701.50c, 702.26b: "Each of X target creatures you control connive. You may have any number of them phase out."', () => {
  const setup = (): GameState => scenario(['Wastes'], { defs: [PLANS, SNACK, BEAR], p1: { hand: ['Test Shift of Schemes'], library: ['Test Snack', 'Test Snack'], battlefield: ['Test Bear', 'Test Bear', 'Wastes', 'Wastes'] }, p2: { battlefield: ['Test Bear'] } });
  it('is automated', () => expect(full(PLANS)).toBe(true));
  it('X = 2: each of the two creatures connives (two draws, two discards; a nonland discard puts a +1/+1 counter on it), then the chosen one phases out', () => {
    const s0 = setup();
    const [a, b] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    let asked = 0;
    const s = castX(s0, 2, [obj(a!), obj(b!)], (d, st) => {
      if (d.kind !== 'chooseObjects') return null;
      const o = d as { options: ObjectId[]; min: number; max: number | 'any' };
      // the phase-out choice offers the two targets, may be empty (ruling 2022-04-29: chosen after both connived)
      if (o.min === 0 && o.options.includes(a!) && o.options.includes(b!)) { asked++; expect(counters(st, a!, '+1/+1') + counters(st, b!, '+1/+1')).toBe(2); return { kind: 'chooseObjects', ids: [a!] }; }
      return null;
    });
    expect(asked).toBe(1);
    expect(counters(s, a!, '+1/+1')).toBe(1);
    expect(counters(s, b!, '+1/+1')).toBe(1);
    expect(phased(s, a!)).toBe(true);
    expect(phased(s, b!)).toBe(false);
    expect(s.zones.graveyard.p1!.filter((id) => s.objects[id]!.defId === 'Test Snack').length).toBe(2);
  });
  it('the negative case: choosing none phases out nothing (the "may")', () => {
    const s0 = setup();
    const [a, b] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castX(s0, 2, [obj(a!), obj(b!)], () => null);
    expect(phased(s, a!)).toBe(false);
    expect(phased(s, b!)).toBe(false);
    expect(counters(s, a!, '+1/+1')).toBe(1);
  });
  it('the negative case: a creature an opponent controls is no legal target', () => {
    const s0 = setup();
    const theirs = findAll(s0, 'Test Bear', 'battlefield', 'p2')[0]!;
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shift of Schemes', 'hand', 'p1') });
    for (let guard = 0; t.pending?.kind === 'chooseNumber' && guard < 3; guard++) t = answer(t, { kind: 'chooseNumber', n: 1 });
    expect(t.pending?.kind).toBe('chooseTargets');
    expect(() => answer(t, { kind: 'chooseTargets', targets: [obj(theirs)] })).toThrow();
  });
});

// ---- Shilgengar, Sire of Famine ----------------------------------------------------------------------------------------------------------------------------------------
const SIRE = card('Test Famine Sire', 'Legendary Creature — Elder Demon', 'Flying\nSacrifice another creature: Create a Blood token. If you sacrificed an Angel this way, create a number of Blood tokens equal to its toughness instead.\n{W/B}{W/B}{W/B}, Sacrifice six Blood tokens: Return each creature card from your graveyard to the battlefield with a finality counter on it. Those creatures are Vampires in addition to their other types.', ['6', '6']);
const ANGEL = card('Test Pale Angel', 'Creature — Angel', 'Flying', ['1', '5']);
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');

/** Activate the ability `p:0:<nth>` of the source (its index among the face's abilities) and answer every decision with the defaults until the stack is empty. */
function activateNth(s0: GameState, source: ObjectId, nth: number, objects?: ObjectId[]): GameState {
  const acts = legalActions(s0, 'p1').filter((a) => a.kind === 'activate' && a.object === source && !a.isMana);
  const a = acts.find((x) => (x.action as { ability?: string }).ability === `p:0:${nth}`);
  if (a === undefined) throw new Error(`no activated ability p:0:${nth} (${acts.map((x) => (x.action as { ability?: string }).ability).join(', ')} offered)`);
  return resolveAll(act(s0, a.action as never), objects === undefined ? {} : { objects });
}

describe('CR 602.2b, 608.2h, 614.15: "If you sacrificed an Angel this way, create a number of Blood tokens equal to its toughness instead."', () => {
  it('is automated', () => expect(full(SIRE)).toBe(true));
  it('sacrificing a creature that is not an Angel makes one Blood token', () => {
    let s = scenario([], { defs: [SIRE, BEAR], p1: { battlefield: ['Test Famine Sire', 'Test Bear'] } });
    s = activateNth(s, find(s, 'Test Famine Sire', 'battlefield'), 1);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(false);
    expect(tokens(s).length).toBe(1);
  });
  it('ruling 2024-06-07: sacrificing an Angel makes Blood tokens equal to its toughness as it last existed (a +1/+1 counter counts), and not one more', () => {
    let s = scenario([], { defs: [SIRE, ANGEL], p1: { battlefield: ['Test Famine Sire', { name: 'Test Pale Angel', counters: { '+1/+1': 1 } }] } });
    s = activateNth(s, find(s, 'Test Famine Sire', 'battlefield'), 1);
    expect(tokens(s).length).toBe(6);
  });
});

describe('CR 122.1, 614.1c, 205.1b: "Return each creature card from your graveyard to the battlefield with a finality counter on it. Those creatures are Vampires in addition to their other types."', () => {
  it('returns every creature card of your graveyard with a finality counter, a Vampire in addition to its types; a finality counter exiles it when it would die', () => {
    let s = scenario(['Plains'], { defs: [SIRE, ANGEL, BEAR, DOOM], p1: { hand: ['Test Doom'], graveyard: ['Test Bear'], battlefield: ['Test Famine Sire', { name: 'Test Pale Angel', counters: { '+1/+1': 1 } }, 'Plains', 'Plains', 'Plains'] }, p2: { graveyard: ['Test Bear'] } });
    const sire = find(s, 'Test Famine Sire', 'battlefield');
    s = activateNth(s, sire, 1); // the Angel: six Blood tokens
    expect(tokens(s).length).toBe(6);
    s = activateNth(s, sire, 2);
    expect(tokens(s).length).toBe(0);
    const back = s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1' && (s.objects[id]!.defId === 'Test Pale Angel' || s.objects[id]!.defId === 'Test Bear'));
    expect(back.length).toBe(2);
    for (const id of back) {
      expect(counters(s, id, 'finality')).toBe(1);
      expect(getChars(s, id)!.subtypes).toContain('Vampire');
    }
    // the opponent's creature card stays in their graveyard
    expect(s.zones.graveyard.p2!.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
    const bear = back.find((id) => s.objects[id]!.defId === 'Test Bear')!;
    s = resolveAll(cast(s, 'Test Doom', { targets: [obj(bear)] }));
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(false);
  });
  it('the negative case: with five Blood tokens the ability cannot be activated', () => {
    let s = scenario(['Plains'], { defs: [SIRE, ANGEL], p1: { battlefield: ['Test Famine Sire', 'Test Pale Angel', 'Plains', 'Plains', 'Plains'] } });
    const sire = find(s, 'Test Famine Sire', 'battlefield');
    s = activateNth(s, sire, 1);
    expect(tokens(s).length).toBe(5);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.object === sire && (a.action as { ability?: string }).ability === 'p:0:2')).toBe(false);
  });
});

// ---- Amzu, Swarm's Hunger ----------------------------------------------------------------------------------------------------------------------------------------------
const SWARMLORD = card('Test Swarm Lord', 'Legendary Creature — Insect Shaman', "Flying, menace\nOther Insects you control have menace.\nWhenever one or more cards leave your graveyard, you may create a 1/1 black and green Insect creature token, then put a number of +1/+1 counters on it equal to the greatest mana value among those cards. Do this only once each turn.", ['3', '3']);
const PURGE = card('Test Purge', 'Sorcery', 'Exile all cards from your graveyard.');
const PLUCK = card('Test Pluck', 'Instant', 'Exile target card from a graveyard.');
const MV3 = card('Test Three Drop', 'Sorcery', 'You gain 1 life.', undefined, '{2}{B}');
const MV5 = card('Test Five Drop', 'Sorcery', 'You gain 1 life.', undefined, '{4}{G}');

describe('CR 603.2c, 202.3, 608.2h: "Whenever one or more cards leave your graveyard, ... counters on it equal to the greatest mana value among those cards. Do this only once each turn."', () => {
  const setup = (hand: string[]): GameState => scenario([], { defs: [SWARMLORD, PURGE, PLUCK, MV3, MV5], p1: { hand, graveyard: ['Test Three Drop', 'Test Five Drop'], battlefield: ['Test Swarm Lord'] }, p2: { graveyard: ['Test Five Drop'] } });
  it('is automated', () => expect(full(SWARMLORD)).toBe(true));
  it('ruling 2024-02-02: two cards leaving at once trigger it once; the token gets counters equal to the greatest mana value among them (5)', () => {
    let s = setup(['Test Purge']);
    s = resolveAll(cast(s, 'Test Purge'), { yes: true });
    const made = tokens(s);
    expect(made.length).toBe(1);
    expect(counters(s, made[0]!, '+1/+1')).toBe(5);
    expect(getChars(s, made[0]!)!.subtypes).toContain('Insect');
  });
  it('the negative cases: declining makes nothing; a card leaving an opponent\'s graveyard does not trigger it', () => {
    let s = setup(['Test Purge']);
    s = resolveAll(cast(s, 'Test Purge'), { yes: false });
    expect(tokens(s).length).toBe(0);
    let t = setup(['Test Pluck']);
    const theirs = t.zones.graveyard.p2!.find((id) => t.objects[id]!.defId === 'Test Five Drop')!;
    t = resolveAll(cast(t, 'Test Pluck', { targets: [obj(theirs)] }), { yes: true });
    expect(tokens(t).length).toBe(0);
  });
  it('CR 603.2h: only once each turn: a second batch the same turn makes no second token (one card leaving: the token gets its mana value)', () => {
    let s = setup(['Test Pluck', 'Test Pluck']);
    const three = s.zones.graveyard.p1!.find((id) => s.objects[id]!.defId === 'Test Three Drop')!;
    s = resolveAll(cast(s, 'Test Pluck', { targets: [obj(three)] }), { yes: true });
    expect(tokens(s).length).toBe(1);
    expect(counters(s, tokens(s)[0]!, '+1/+1')).toBe(3);
    const five = s.zones.graveyard.p1!.find((id) => s.objects[id]!.defId === 'Test Five Drop')!;
    s = resolveAll(cast(s, 'Test Pluck', { targets: [obj(five)] }), { yes: true });
    expect(tokens(s).length).toBe(1);
  });
});

// ---- Zimone's Hypothesis -----------------------------------------------------------------------------------------------------------------------------------------------
const HYPOTHESIS = card('Test Parity Theorem', 'Instant', "You may put a +1/+1 counter on a creature. Then choose odd or even. Return each creature with power of the chosen quality to its owner's hand.");
const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['0', '4']);
const ONE = card('Test One', 'Creature — Bug', '', ['1', '1']);

describe('CR 608.2d, 208.1: "You may put a +1/+1 counter on a creature. Then choose odd or even. Return each creature with power of the chosen quality to its owner\'s hand."', () => {
  const setup = (): GameState => scenario([], { defs: [HYPOTHESIS, BEAR, WALL, ONE], p1: { hand: ['Test Parity Theorem'], battlefield: ['Test Bear', 'Test One'] }, p2: { battlefield: ['Test Bear', 'Test Wall'] } });
  /** Cast it: `pick` is the creature to get the counter (none: decline), `parity` the choice. */
  function play(s0: GameState, pick: ObjectId | null, parity: 'odd' | 'even'): GameState {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Parity Theorem', 'hand', 'p1') });
    for (let guard = 0; guard < 40; guard++) {
      const d = s.pending;
      if (d === undefined || d === null) break;
      if (d.kind === 'priority') { if (s.zones.stack.length === 0) break; s = act(s, { type: 'pass', player: d.player }); continue; }
      if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: pick !== null });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [pick!] });
      else if (d.kind === 'chooseOption') { const o = (d as { options: { id: string; label: string }[] }).options.find((x) => x.label === parity)!; s = answer(s, { kind: 'chooseOption', ids: [o.id] }); }
      else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else throw new Error(`unexpected decision ${d.kind}`);
    }
    return s;
  }
  const onBf = (s: GameState, name: string, owner: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name && s.objects[id]!.owner === owner).length;
  it('is automated', () => expect(full(HYPOTHESIS)).toBe(true));
  it('a counter on the opponent\'s 2/2 (any creature, no target), then odd: the 3/3 and the 1/1 return to their owners\' hands; the even ones stay', () => {
    const s0 = setup();
    const theirs = findAll(s0, 'Test Bear', 'battlefield', 'p2')[0]!;
    const s = play(s0, theirs, 'odd');
    expect(onBf(s, 'Test Bear', 'p2')).toBe(0);
    expect(s.zones.hand.p2!.some((id) => s.objects[id]!.defId === 'Test Bear')).toBe(true);
    expect(onBf(s, 'Test One', 'p1')).toBe(0);
    expect(onBf(s, 'Test Bear', 'p1')).toBe(1);
    expect(onBf(s, 'Test Wall', 'p2')).toBe(1);
  });
  it('the negative case: declining the counter, then even: the 2/2s and the 0/4 (zero is even) return, the 1/1 stays', () => {
    const s = play(setup(), null, 'even');
    expect(onBf(s, 'Test Bear', 'p1') + onBf(s, 'Test Bear', 'p2')).toBe(0);
    expect(onBf(s, 'Test Wall', 'p2')).toBe(0);
    expect(onBf(s, 'Test One', 'p1')).toBe(1);
  });
});

// ---- Summoner's Sending ------------------------------------------------------------------------------------------------------------------------------------------------
const SENDING = card("Test Spirit Sending", 'Enchantment', "At the beginning of your end step, you may exile target creature card from a graveyard. If you do, create a 1/1 white Spirit creature token with flying. Put a +1/+1 counter on it if the exiled card's mana value is 4 or greater.");
const BIG = card('Test Big Beast', 'Creature — Beast', '', ['4', '4'], '{3}{G}');
const SMALL = card('Test Small Beast', 'Creature — Beast', '', ['2', '2'], '{1}{G}');

describe('CR 608.2c, 400.7: "If you do, create a 1/1 white Spirit creature token with flying. Put a +1/+1 counter on it if the exiled card\'s mana value is 4 or greater."', () => {
  const setup = (yard: string): GameState => scenario([], { defs: [SENDING, BIG, SMALL], p1: { battlefield: ['Test Spirit Sending'] }, p2: { graveyard: [yard] } });
  const atEnd = (s0: GameState, yard: string, yes: boolean): GameState =>
    resolveAll(goTo(s0, 'end', (s) => [obj(s.zones.graveyard.p2!.find((id) => s.objects[id]!.defId === yard)!)]), { yes });
  it('is automated', () => expect(full(SENDING)).toBe(true));
  it('exiling a mana value 4 creature card makes a Spirit that gets the +1/+1 counter (it is the token, never the exiled card)', () => {
    const s = atEnd(setup('Test Big Beast'), 'Test Big Beast', true);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Big Beast')).toBe(true);
    const made = tokens(s);
    expect(made.length).toBe(1);
    expect(counters(s, made[0]!, '+1/+1')).toBe(1);
    expect(pt(s, made[0]!)).toBe('2/2');
  });
  it('the negative cases: a mana value 2 card makes a 1/1 Spirit with no counter; declining makes nothing', () => {
    const s = atEnd(setup('Test Small Beast'), 'Test Small Beast', true);
    expect(tokens(s).length).toBe(1);
    expect(counters(s, tokens(s)[0]!, '+1/+1')).toBe(0);
    const t = atEnd(setup('Test Big Beast'), 'Test Big Beast', false);
    expect(tokens(t).length).toBe(0);
    expect(t.zones.graveyard.p2!.some((id) => t.objects[id]!.defId === 'Test Big Beast')).toBe(true);
  });
});

// ---- Tombstone Stairwell -----------------------------------------------------------------------------------------------------------------------------------------------
const STAIRWELL = card('Test Crypt Stair', 'World Enchantment', 'Cumulative upkeep {1}{B}\nAt the beginning of each upkeep, if this enchantment is on the battlefield, each player creates a 2/2 black Zombie creature token with haste named Tombspawn for each creature card in their graveyard.\nAt the beginning of each end step and when this enchantment leaves the battlefield, destroy all tokens created with this enchantment. They can\'t be regenerated.');
const RAISE = card('Test Raise Dead', 'Sorcery', 'Create a 2/2 black Zombie creature token.');
const SHATTER = card('Test Shatter', 'Instant', 'Destroy target enchantment.');

describe('CR 607.2a, 603.2: "At the beginning of each end step and when this enchantment leaves the battlefield, destroy all tokens created with this enchantment."', () => {
  const setup = (): GameState => scenario([], { defs: [STAIRWELL, RAISE, SHATTER, BEAR], p1: { hand: ['Test Raise Dead', 'Test Shatter'], graveyard: ['Test Bear', 'Test Bear'], battlefield: ['Test Crypt Stair'] }, p2: { graveyard: ['Test Bear'] } });
  /** p1 makes a Zombie of its own (not with the enchantment), then the game goes to p2's upkeep, where the enchantment's trigger resolves. */
  const toTheirUpkeep = (): GameState => {
    let s = resolveAll(cast(setup(), 'Test Raise Dead'));
    s = goTo(s, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
    return resolveAll(s);
  };
  const named = (s: GameState, p: string): ObjectId[] => tokens(s, p).filter((id) => getChars(s, id)!.names.includes('Tombspawn'));
  it('is automated', () => expect(full(STAIRWELL)).toBe(true));
  it('each upkeep (also an opponent\'s): each player makes a hasty 2/2 Tombspawn for each creature card in their own graveyard; each controls their own (ruling 2004-10-04)', () => {
    const s = toTheirUpkeep();
    expect(named(s, 'p1').length).toBe(2);
    expect(named(s, 'p2').length).toBe(1);
    expect(hasKeyword(getChars(s, named(s, 'p2')[0]!)!, 'haste')).toBe(true);
  });
  it('at the beginning of the end step every token it created is destroyed; a token another card made stays (the negative case)', () => {
    let s = toTheirUpkeep();
    s = resolveAll(goTo(s, 'end'));
    expect(named(s, 'p1').length + named(s, 'p2').length).toBe(0);
    expect(tokens(s, 'p1').length).toBe(1);
  });
  it('when it leaves the battlefield its tokens are destroyed at once', () => {
    let s = toTheirUpkeep();
    s = act(s, { type: 'pass', player: 'p2' }); // p1 gets priority in p2's upkeep
    s = resolveAll(cast(s, 'Test Shatter', { targets: [obj(find(s, 'Test Crypt Stair', 'battlefield'))] }));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Crypt Stair')).toBe(false);
    expect(named(s, 'p1').length + named(s, 'p2').length).toBe(0);
    expect(tokens(s, 'p1').length).toBe(1);
  });
});

// ---- Savage Summoning --------------------------------------------------------------------------------------------------------------------------------------------------
const CALLING = card('Test Wild Calling', 'Instant', "This spell can't be countered.\nThe next creature spell you cast this turn can be cast as though it had flash. That spell can't be countered. That creature enters with an additional +1/+1 counter on it.");
const NEGATE = card('Test Denial', 'Instant', 'Counter target spell.');

describe('CR 611.2, 601.3b, 101.2, 614.1c: "The next creature spell you cast this turn can be cast as though it had flash. That spell can\'t be countered. That creature enters with an additional +1/+1 counter on it."', () => {
  const setup = (hand: string[]): GameState => scenario(['Wastes'], { defs: [CALLING, NEGATE, BEAR, OGRE], p1: { hand, battlefield: ['Wastes', 'Wastes', 'Wastes'] }, p2: { hand: ['Test Denial'] } });
  it('is automated', () => expect(full(CALLING)).toBe(true));
  it('at the end step (no flash of its own) the next creature spell can be cast, the opponent\'s counterspell does not counter it, and it enters with a +1/+1 counter', () => {
    let s = resolveAll(goTo(setup(['Test Wild Calling', 'Test Bear']), 'end'));
    const bearCard = find(s, 'Test Bear', 'hand', 'p1');
    expect(canCast(s, 'p1', bearCard)).toBe(false);
    s = resolveAll(cast(s, 'Test Wild Calling'));
    expect(canCast(s, 'p1', bearCard)).toBe(true);
    s = act(s, { type: 'cast', player: 'p1', card: bearCard });
    s = act(s, { type: 'pass', player: 'p1' });
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    s = cast(s, 'Test Denial', { targets: [obj(spell)] }, 'p2');
    s = resolveAll(s);
    expect(s.zones.graveyard.p2!.some((id) => s.objects[id]!.defId === 'Test Denial')).toBe(true); // it was cast and resolved (ruling 2013-07-01: it can be cast, it just doesn't counter)
    const bear = find(s, 'Test Bear', 'battlefield');
    expect(counters(s, bear, '+1/+1')).toBe(1);
    expect(pt(s, bear)).toBe('3/3');
  });
  it('the negative case: only the next creature spell; a second one that turn gets no counter and needs its own timing', () => {
    let s = setup(['Test Wild Calling', 'Test Bear', 'Test Ogre']);
    s = resolveAll(cast(s, 'Test Wild Calling'));
    s = resolveAll(cast(s, 'Test Bear'));
    s = resolveAll(cast(s, 'Test Ogre'));
    expect(counters(s, find(s, 'Test Bear', 'battlefield'), '+1/+1')).toBe(1);
    expect(counters(s, find(s, 'Test Ogre', 'battlefield'), '+1/+1')).toBe(0);
  });
  it('ruling 2013-07-01: two of them in succession give the next creature spell two additional counters', () => {
    let s = scenario([], { defs: [CALLING, BEAR], p1: { hand: ['Test Wild Calling', 'Test Wild Calling', 'Test Bear'] } });
    s = resolveAll(cast(s, 'Test Wild Calling'));
    s = resolveAll(cast(s, 'Test Wild Calling'));
    s = resolveAll(cast(s, 'Test Bear'));
    expect(counters(s, find(s, 'Test Bear', 'battlefield'), '+1/+1')).toBe(2);
  });
});
