/**
 * Commander effort, round edh-c-67 (EDHREC ranks 27,001-27,500, second pass): the round's readings played through the engine with synthetic cards (invented names), compiled by the game's
 * default compiler. Alice (p1) casts and attacks; Bob (p2) defends. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 608.2d, 109.4, 701.8   "Target opponent chooses a creature they control. Destroy that creature." (the opponent chooses, not the controller)
 *   CR 608.2d, 509.1b         "Target opponent chooses a creature they control. Other creatures they control can't block this turn."
 *   CR 400.3, 401.4           "... Put that card on top of that player's library." / "... into that player's graveyard."
 *   CR 208.3, 608.2b          "deals 2 damage to any target. If it's a creature, it can't block this turn."
 *   CR 105.2, 120.3, 607.2d   "Whenever a source of the chosen color deals damage to you, you may pay {1}. If you do, ..."
 *   CR 603.4, 120.1           "if ~ dealt damage to an opponent this turn, put a +1/+1 counter on it" (once per turn)
 *   CR 509.1g, 603.2          "Whenever ~ becomes blocked by a creature, it deals 2 damage to that creature."
 *   CR 506.4, 608.2h          "~ deals damage equal to its toughness to target creature blocking or blocked by it."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, find, legal, pass, scenario } from '../../m3/scenario';
import { answer } from '../../m12/rules/helpers';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, toStep, passUntil, onBattlefield, inGraveyard } from '../../m4/helpers';
import { card, counters, full, named, pt, resolveAll, settle, type Picks } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const cast = (s: GameState, name: string, p: Picks = {}, who = 'p1'): GameState => settle(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), p);

/** A card with a color (the helper of cmd3 makes colorless cards). */
const colored = (name: string, type: string, text: string, colors: string[], pt?: [string, string], cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const KNIGHT = card('Test Edict Knight', 'Creature — Knight', 'When this creature enters, target opponent chooses a creature they control. Destroy that creature.', ['2', '2'], '{0}');
const SHOUT = card('Test War Shout', 'Instant', 'Target opponent chooses a creature they control. Other creatures they control can\'t block this turn.', undefined, '{0}');
const MEMORY = card('Test Fading Thought', 'Sorcery', 'Look at target opponent\'s hand and choose a creature card from it. Put that card on top of that player\'s library.', undefined, '{0}');
const SEER = card('Test Library Seer', 'Creature — Wizard', '{T}: Look at the top card of target player\'s library. You may put that card into that player\'s graveyard.', ['1', '1'], '{0}');
const BARB = card('Test Thorn Burst', 'Sorcery', '~ deals 2 damage to any target. If it\'s a creature, it can\'t block this turn.', undefined, '{0}');
const CIRCLE = card('Test Ring of Pain', 'Enchantment', 'As ~ enters, choose a color.\nWhenever a source of the chosen color deals damage to you, you may pay {1}. If you do, target player loses 1 life and you gain 1 life.', undefined, '{0}');
const OUTLAW = card('Test Dune Rider', 'Creature — Human', 'At the beginning of each end step, if ~ dealt damage to an opponent this turn, put a +1/+1 counter on it.', ['2', '2'], '{0}');
const ACOLYTE = card('Test Ember Novice', 'Creature — Human', 'Whenever ~ becomes blocked by a creature, it deals 2 damage to that creature.', ['2', '3'], '{0}');
const ARMADILLO = card('Test Steady Beast', 'Creature — Beast', 'Vigilance\n{T}: ~ deals damage equal to its toughness to target creature blocking or blocked by it.', ['1', '4'], '{0}');
/** Answer target prompts and pass priority until a chooseObjects decision (or an empty stack with priority) is pending. */
function toChoice(s0: GameState, targets: TargetChoice[]): GameState {
  let s = s0;
  for (let i = 0; i < 20 && s.pending && s.pending.kind !== 'chooseObjects'; i++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
const ROD = card('Test Denial Rod', 'Artifact', '{T}: Look at the top card of target player\'s library. If it\'s a nonland card, you may pay 2 life. If you do, put it into that player\'s graveyard.', undefined, '{0}');
const BOARS = card('Test Charging Hog', 'Creature — Boar', 'Whenever this creature attacks, defending player chooses an untapped creature they control. That creature blocks this creature this turn if able.', ['3', '3'], '{0}');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const MOTH = card('Test Moth', 'Creature — Insect', 'Flying', ['2', '2']);
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '5']);
const RED = colored('Test Red Imp', 'Creature — Imp', '', ['R'], ['1', '1'], '{R}');
const FLARE = colored('Test Red Flare', 'Sorcery', '~ deals 2 damage to any target.', ['R'], undefined, '{R}');
const DEFS: CardDef[] = [BOARS, ROD, FLARE, KNIGHT, SHOUT, MEMORY, SEER, BARB, CIRCLE, OUTLAW, ACOLYTE, ARMADILLO, BEAR, MOTH, WALL, RED];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS.filter((x) => x.name !== 'Test Bear' && x.name !== 'Test Moth' && x.name !== 'Test Wall' && x.name !== 'Test Red Imp')) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 608.2d, 109.4: "Target opponent chooses a creature they control. Destroy that creature."', () => {
  const setup = (): GameState => scenario(['Swamp'], { p1: { hand: ['Test Edict Knight'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Moth'] }, defs: DEFS });
  it('the opponent is asked, chooses among their own creatures only, and that creature is destroyed', () => {
    let s = setup();
    s = cast(s, 'Test Edict Knight');
    s = toChoice(s, [player('p2')]);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending!.player).toBe('p2');
    const options = (s.pending as { options: ObjectId[] }).options;
    expect(options.every((id) => s.objects[id]!.controller === 'p2')).toBe(true);
    expect(options.length).toBe(2);
    const moth = find(s, 'Test Moth', 'battlefield');
    s = resolveAll(s, { objects: [moth] });
    expect(onBattlefield(s, 'Test Moth')).toBe(false);
    expect(inGraveyard(s, 'Test Moth', 'p2')).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear').length).toBe(2);
  });
  it('negative: with one creature that creature is destroyed and the controller\'s own creatures are untouched', () => {
    let s = scenario(['Swamp'], { p1: { hand: ['Test Edict Knight'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Moth'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Edict Knight'), { targets: [player('p2')] });
    expect(onBattlefield(s, 'Test Moth')).toBe(false);
    expect(onBattlefield(s, 'Test Bear', 'p1')).toBe(true);
    expect(onBattlefield(s, 'Test Edict Knight', 'p1')).toBe(true);
  });
});

describe('CR 608.2d, 509.1b: "Target opponent chooses a creature they control. Other creatures they control can\'t block this turn."', () => {
  const setup = (): GameState => scenario(['Swamp'], { p1: { hand: ['Test War Shout'], battlefield: ['Test Red Imp'] }, p2: { battlefield: ['Test Bear', 'Test Moth'] }, defs: DEFS });
  const toBlocks = (s0: GameState, chosen: 'Test Bear' | 'Test Moth'): GameState => {
    let s = toChoice(cast(s0, 'Test War Shout', { targets: [player('p2')] }), [player('p2')]);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending!.player).toBe('p2');
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, chosen, 'battlefield')] });
    s = resolveAll(s);
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Red Imp', 'battlefield')]]);
    return toDeclareBlockers(s);
  };
  it('the creature the opponent chose may block; the other creature they control can\'t', () => {
    const s = toBlocks(setup(), 'Test Bear');
    const imp = find(s, 'Test Red Imp', 'battlefield');
    expect(() => declareBlockers(s, [[find(s, 'Test Moth', 'battlefield'), imp]])).toThrow();
    const t = declareBlockers(s, [[find(s, 'Test Bear', 'battlefield'), imp]]);
    expect(t.pending?.kind === 'declareBlockers').toBe(false);
  });
  it('the other way round (the opponent chose the Moth): the Bear can\'t block, the Moth can', () => {
    const s = toBlocks(setup(), 'Test Moth');
    const imp = find(s, 'Test Red Imp', 'battlefield');
    expect(() => declareBlockers(s, [[find(s, 'Test Bear', 'battlefield'), imp]])).toThrow();
    expect(() => declareBlockers(s, [[find(s, 'Test Moth', 'battlefield'), imp]])).not.toThrow();
  });
  it('negative: an opponent with one creature chooses it, and it can block (nothing else to restrict)', () => {
    let s = scenario(['Swamp'], { p1: { hand: ['Test War Shout'], battlefield: ['Test Red Imp'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test War Shout', { targets: [player('p2')] }));
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Red Imp', 'battlefield')]]);
    s = toDeclareBlockers(s);
    expect(() => declareBlockers(s, [[find(s, 'Test Bear', 'battlefield'), find(s, 'Test Red Imp', 'battlefield')]])).not.toThrow();
  });
});

const topOf = (s: GameState, who: string): string => s.defs[s.objects[s.zones.library[who]![0]!]!.defId]!.name;

describe('CR 400.3, 401.4: "... Put that card on top of that player\'s library."', () => {
  it('the chosen creature card goes from the opponent\'s hand to the top of that opponent\'s library', () => {
    let s = scenario(['Swamp', 'Island'], { p1: { hand: ['Test Fading Thought'] }, p2: { hand: ['Test Bear', 'Test Moth'], library: ['Test Wall'] }, defs: DEFS });
    s = toChoice(cast(s, 'Test Fading Thought', { targets: [player('p2')] }), []);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending!.player).toBe('p1');
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Moth', 'hand', 'p2')] });
    s = resolveAll(s);
    expect(topOf(s, 'p2')).toBe('Test Moth');
    expect(s.zones.hand['p2']!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Test Bear']);
  });
  it('negative: the caster\'s own library and hand are untouched', () => {
    let s = scenario(['Swamp'], { p1: { hand: ['Test Fading Thought', 'Test Bear'], library: ['Test Wall'] }, p2: { hand: ['Test Moth', 'Test Red Imp'] }, defs: DEFS });
    s = toChoice(cast(s, 'Test Fading Thought', { targets: [player('p2')] }), []);
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Moth', 'hand', 'p2')] });
    s = resolveAll(s);
    expect(topOf(s, 'p1')).toBe('Test Wall');
    expect(s.zones.hand['p1']!.length).toBe(1);
  });
});

describe('CR 400.3: "You may put that card into that player\'s graveyard." (a card from the top of target player\'s library)', () => {
  const setup = (): GameState => scenario(['Swamp'], { p1: { battlefield: ['Test Library Seer'] }, p2: { library: ['Test Moth', 'Test Wall'] }, defs: DEFS });
  const activate = (s: GameState, yes: boolean): GameState => {
    let t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Library Seer', 'battlefield'), ability: 'p:0:0' });
    t = toChoice(t, [player('p2')]);
    return resolveAll(t, { yes, targets: [player('p2')] });
  };
  it('yes: the top card of that player\'s library goes to that player\'s graveyard', () => {
    const s = activate(setup(), true);
    expect(inGraveyard(s, 'Test Moth', 'p2')).toBe(true);
    expect(topOf(s, 'p2')).toBe('Test Wall');
  });
  it('no (negative): the card stays on top and nothing goes to a graveyard', () => {
    const s = activate(setup(), false);
    expect(inGraveyard(s, 'Test Moth', 'p2')).toBe(false);
    expect(topOf(s, 'p2')).toBe('Test Moth');
  });
});

describe('CR 208.3, 608.2b, 509.1b: "~ deals 2 damage to any target. If it\'s a creature, it can\'t block this turn."', () => {
  const setup = (): GameState => scenario(['Mountain'], { p1: { hand: ['Test Thorn Burst'], battlefield: ['Test Red Imp'] }, p2: { battlefield: ['Test Wall', 'Test Bear'] }, defs: DEFS });
  const toBlocks = (s0: GameState, target: TargetChoice): GameState => {
    const s = resolveAll(cast(s0, 'Test Thorn Burst', { targets: [target] }));
    return toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Red Imp', 'battlefield')]]));
  };
  it('a creature that survives the damage can\'t block this turn; another creature still can', () => {
    const s0 = setup();
    const s = toBlocks(s0, obj(find(s0, 'Test Wall', 'battlefield')));
    const imp = find(s, 'Test Red Imp', 'battlefield');
    expect(() => declareBlockers(s, [[find(s, 'Test Wall', 'battlefield'), imp]])).toThrow();
    expect(() => declareBlockers(s, [[find(s, 'Test Bear', 'battlefield'), imp]])).not.toThrow();
  });
  it('negative: damage to a player is not a creature, so nothing is restricted and both creatures may block', () => {
    const s = toBlocks(setup(), player('p2'));
    const imp = find(s, 'Test Red Imp', 'battlefield');
    expect(s.players.find((x) => x.id === 'p2')!.life).toBe(18);
    expect(() => declareBlockers(s, [[find(s, 'Test Wall', 'battlefield'), imp]])).not.toThrow();
  });
});

describe('CR 105.2, 120.3, 607.2d: "Whenever a source of the chosen color deals damage to you, you may pay {1}. If you do, target player loses 1 life and you gain 1 life."', () => {
  const setup = (color: 'R' | 'U'): GameState => {
    let s = scenario(['Mountain', 'Swamp'], { p1: { hand: ['Test Ring of Pain', 'Test Red Flare'], battlefield: ['Mountain', 'Mountain', 'Swamp', 'Swamp'] }, defs: DEFS });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ring of Pain', 'hand', 'p1') }));
    s = pass(s);
    if (s.pending?.kind !== 'chooseColor') s = pass(s);
    expect(s.pending?.kind).toBe('chooseColor');
    s = answer(s, { kind: 'chooseColor', color });
    return resolveAll(s);
  };
  const burn = (s0: GameState, yes: boolean): GameState => {
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Red Flare', 'hand', 'p1') }), { targets: [player('p1')] });
    return resolveAll(s, { yes, targets: [player('p2')] });
  };
  const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  it('red chosen, a red spell hurts you, you pay {1}: that player loses 1 and you gain 1', () => {
    const s = burn(setup('R'), true);
    expect(lifeOf(s, 'p1')).toBe(19);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
  it('red chosen, you decline to pay: only the damage happens (the payment is optional)', () => {
    const s = burn(setup('R'), false);
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('negative: blue chosen, a red source deals damage to you: the ability does not trigger', () => {
    const s = burn(setup('U'), true);
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 603.4, 120.1: "At the beginning of each end step, if ~ dealt damage to an opponent this turn, put a +1/+1 counter on it."', () => {
  const run = (blockers: boolean): GameState => {
    let s = scenario(['Swamp'], { p1: { battlefield: ['Test Dune Rider'] }, p2: { battlefield: blockers ? ['Test Wall'] : [] }, defs: DEFS });
    const rider = find(s, 'Test Dune Rider', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[rider]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage', 10);
    if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, blockers ? [[find(s, 'Test Wall', 'battlefield'), rider]] : []);
    s = toStep(s, 'end');
    return resolveAll(s);
  };
  it('unblocked: it dealt combat damage to an opponent, so it gets exactly one +1/+1 counter at the end step', () => {
    const s = run(false);
    expect(counters(s, named(s, 'Test Dune Rider')[0]!, '+1/+1')).toBe(1);
    expect(pt(s, named(s, 'Test Dune Rider')[0]!)).toBe('3/3');
  });
  it('negative: blocked by a creature, it dealt damage to a creature and no opponent, so no counter', () => {
    const s = run(true);
    expect(counters(s, named(s, 'Test Dune Rider')[0]!, '+1/+1')).toBe(0);
  });
});

describe('CR 603.2, 509.1g, 120.3: "Whenever ~ becomes blocked by a creature, it deals 2 damage to that creature." (once for each blocker)', () => {
  const blocked = (blockers: string[]): GameState => {
    let s = scenario(['Swamp'], { p1: { battlefield: ['Test Ember Novice'] }, p2: { battlefield: blockers }, defs: DEFS });
    const novice = find(s, 'Test Ember Novice', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[novice]]);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, [...new Set(blockers)].map((n) => [find(s, n, 'battlefield'), novice] as [ObjectId, ObjectId]));
    return resolveAll(s);
  };
  it('each creature that blocks it is dealt 2 damage by the trigger, before combat damage', () => {
    const s = blocked(['Test Wall', 'Test Bear']);
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(false); // 2/2 dies to the trigger
    const wall = find(s, 'Test Wall', 'battlefield');
    expect(s.objects[wall]!.damage).toBe(2);
  });
  it('negative: the attacker itself takes no damage from its own trigger, and an unblocked attacker triggers nothing', () => {
    const s = blocked(['Test Moth']);
    const novice = find(s, 'Test Ember Novice', 'battlefield');
    expect(s.objects[novice]!.damage).toBe(0);
    let t = scenario(['Swamp'], { p1: { battlefield: ['Test Ember Novice'] }, p2: { battlefield: ['Test Wall'] }, defs: DEFS });
    const n2 = find(t, 'Test Ember Novice', 'battlefield');
    t = declareAttackers(toDeclareAttackers(t), [[n2]]);
    t = toDeclareBlockers(t);
    t = resolveAll(declareBlockers(t, []));
    expect(t.objects[find(t, 'Test Wall', 'battlefield')]!.damage).toBe(0);
  });
});

describe('CR 506.4, 509.1, 120.3: "{T}: ~ deals damage equal to its toughness to target creature blocking or blocked by it."', () => {
  const inCombat = (): GameState => {
    let s = scenario(['Swamp'], { p1: { battlefield: ['Test Steady Beast', 'Test Red Imp'] }, p2: { battlefield: ['Test Bear', 'Test Moth'] }, defs: DEFS });
    const beast = find(s, 'Test Steady Beast', 'battlefield');
    const imp = find(s, 'Test Red Imp', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[beast], [imp]]);
    s = toDeclareBlockers(s);
    return declareBlockers(s, [[find(s, 'Test Bear', 'battlefield'), beast], [find(s, 'Test Moth', 'battlefield'), imp]]);
  };
  const activate = (s: GameState, target: ObjectId): GameState => {
    const beast = find(s, 'Test Steady Beast', 'battlefield');
    const ab = legal(s, 'p1', 'activate').find((a) => a.object === beast);
    const t = act(s, ab!.action);
    return resolveAll(t, { targets: [obj(target)] });
  };
  it('a creature blocking it is dealt damage equal to its toughness (4)', () => {
    const s0 = inCombat();
    const s = activate(s0, find(s0, 'Test Bear', 'battlefield'));
    expect(s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toBe(false);
  });
  it('negative: a creature blocking another attacker is not a legal target', () => {
    const s0 = inCombat();
    expect(() => activate(s0, find(s0, 'Test Moth', 'battlefield'))).toThrow();
  });
});

describe('CR 118.12, 608.2c, 400.3: "If it\'s a nonland card, you may pay 2 life. If you do, put it into that player\'s graveyard."', () => {
  const setup = (top: string): GameState => scenario(['Swamp'], { p1: { battlefield: ['Test Denial Rod'] }, p2: { library: [top, 'Test Wall'] }, defs: DEFS });
  const run = (s0: GameState, yes: boolean): GameState => {
    const rod = find(s0, 'Test Denial Rod', 'battlefield');
    const ab = legal(s0, 'p1', 'activate').find((a) => a.object === rod);
    return resolveAll(toChoice(act(s0, ab!.action), [player('p2')]), { yes, targets: [player('p2')] });
  };
  const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  it('a nonland top card and the payment made: you lose 2 life and the card goes to that player\'s graveyard', () => {
    const s = run(setup('Test Moth'), true);
    expect(lifeOf(s, 'p1')).toBe(18);
    expect(inGraveyard(s, 'Test Moth', 'p2')).toBe(true);
  });
  it('the payment declined (negative): nothing is paid and the card stays on top', () => {
    const s = run(setup('Test Moth'), false);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(inGraveyard(s, 'Test Moth', 'p2')).toBe(false);
    expect(topOf(s, 'p2')).toBe('Test Moth');
  });
  it('a land on top (negative): no payment is offered, nothing happens', () => {
    const s = run(setup('Swamp'), true);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(topOf(s, 'p2')).toBe('Swamp');
  });
});

describe('CR 508.1, 509.1c, 608.2d: "Whenever ~ attacks, defending player chooses an untapped creature they control. That creature blocks ~ this turn if able."', () => {
  const attack = (): GameState => {
    let s = scenario(['Swamp'], { p1: { battlefield: ['Test Charging Hog'] }, p2: { battlefield: ['Test Bear', 'Test Moth'] }, defs: DEFS });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Charging Hog', 'battlefield')]]);
    s = toChoice(s, []);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending!.player).toBe('p2');
    expect((s.pending as { options: ObjectId[] }).options.every((id) => s.objects[id]!.controller === 'p2')).toBe(true);
    s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Moth', 'battlefield')] });
    return toDeclareBlockers(resolveAll(s));
  };
  it('the chosen creature must block it: declaring no block or only another creature is rejected, the chosen one blocking is accepted', () => {
    const s = attack();
    const hog = find(s, 'Test Charging Hog', 'battlefield');
    expect(() => declareBlockers(s, [])).toThrow();
    expect(() => declareBlockers(s, [[find(s, 'Test Bear', 'battlefield'), hog]])).toThrow();
    expect(() => declareBlockers(s, [[find(s, 'Test Moth', 'battlefield'), hog]])).not.toThrow();
  });
  it('negative: a defender with no creature is asked nothing (no choice, no block possible) and takes the damage', () => {
    let s = scenario(['Swamp'], { p1: { battlefield: ['Test Charging Hog'] }, defs: DEFS });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Charging Hog', 'battlefield')]]);
    s = toStep(resolveAll(s), 'endCombat');
    expect(s.players.find((x) => x.id === 'p2')!.life).toBe(17);
  });
});
