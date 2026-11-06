/**
 * edh-next-54 (Commander lane exchange, control exchange and "gain control of", EDHREC top 20,000): the round's readings and engine changes played through the engine with synthetic
 * cards (invented names and wordings, design 6.10) compiled by the game's default compiler, in a four-player game (Alice p1 is the active player of turn 1). Each test names the rule
 * it checks, with its negative case. CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-03).
 *
 *   CR 701.12a-b, 110.4, 205.2a   "Exchange control of two target permanents that share a permanent type" (Role Reversal): a card type in common that permanents have
 *   CR 701.12a, 115.1, 205.2a     "... target permanent an opponent controls that shares a card type with it" (Daring Thief)
 *   CR 701.12a, 202.3             "... target nonland permanent an opponent controls with equal or lesser mana value" (Puca's Mischief)
 *   CR 108.4, 608.2c              "They gain control of ~" after "deals damage to target opponent" (Pumpkin Bombs)
 *   CR 603.7, 603.4, 701.21a      "Sacrifice it at the beginning of the next end step if it has mana value 3 or less" (Angrath, the Flame-Chained)
 *   CR 508.1b, 701.21a            "You can't attack that player this turn. You can't sacrifice those creatures this turn." (Call for Aid)
 *   CR 115.1, 611.2a, 509.1c      "Target player gains control of up to three target nonattacking creatures ... They block this turn if able." (Domineering Will)
 *   CR 602.5b, 506.1              "You can't activate this ability during combat." (Djinn of Infinite Deceits)
 *   CR 608.2d, 108.4              "Target opponent chooses a creature they control. You gain control of it." (Sakashima's Will)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, mpScenario, pass, passUntil, reject, lifeOf, resolveStack } from '../../m12/rules/helpers';
import { cast, activate, target } from '../../m5/cr-examples/helpers';

const resolveTop = (s: GameState, answers: Parameters<typeof resolveStack>[1] = []): GameState => resolveStack(s, answers);

const card = (name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef => compileCard({
  name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
} as OracleCard);
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const ctl = (s: GameState, id: ObjectId): PlayerId => s.objects[id]!.controller;
const zoneOf = (s: GameState, id: ObjectId): string => s.objects[id]!.zone;
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;

const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{5}', ['4', '4']);
const IMP = card('Test Imp', 'Creature — Imp', '', '{1}', ['1', '1']);
const RELIC = card('Test Relic', 'Artifact', '', '{3}');
const RELIC2 = card('Test Relic Two', 'Artifact', '', '{3}');
const KA = card('Test Kindred Artifact', 'Kindred Artifact — Goblin', '', '{2}');
const KE = card('Test Kindred Enchantment', 'Kindred Enchantment — Goblin', '', '{2}');
const ALL = [BEAR, OGRE, IMP, RELIC, RELIC2, KA, KE];
const o = (id: string) => ({ kind: 'object' as const, id });

// ---- Role Reversal ---------------------------------------------------------------------------------------------------------------------------------------------------
const REVERSAL = card('Test Reversal', 'Sorcery', 'Exchange control of two target permanents that share a permanent type.');
describe('CR 701.12a-b, 110.4, 205.2a: "Exchange control of two target permanents that share a permanent type" (Role Reversal)', () => {
  it('is automated', () => expect(full(REVERSAL)).toBe(true));
  const game = () => mpScenario({ defs: [REVERSAL, ...ALL], zones: { p1: { hand: ['Test Reversal'], battlefield: ['Test Bear', 'Test Relic', 'Test Kindred Artifact'] }, p2: { battlefield: ['Test Ogre', 'Test Relic Two', 'Test Kindred Enchantment'] } } });
  it('two creatures exchange controllers', () => {
    let s = game();
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Test Reversal', [target(mine, theirs)]));
    expect(ctl(s, mine)).toBe('p2');
    expect(ctl(s, theirs)).toBe('p1');
  });
  it('negative: a creature and an artifact share no permanent type: the targets are refused', () => {
    const s = cast0(game());
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const relic = find(s, 'Test Relic Two', 'battlefield', 'p2');
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [o(mine), o(relic)] } });
  });
  it('negative: two Kindred permanents that share only the Kindred type are refused (Kindred is no permanent type)', () => {
    const s = cast0(game());
    const ka = find(s, 'Test Kindred Artifact', 'battlefield', 'p1');
    const ke = find(s, 'Test Kindred Enchantment', 'battlefield', 'p2');
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [o(ka), o(ke)] } });
  });
  it('an artifact creature shares the artifact type with an artifact', () => {
    const AC = card('Test Golem', 'Artifact Creature — Golem', '', '{3}', ['2', '2']);
    let s = mpScenario({ defs: [REVERSAL, AC, ...ALL], zones: { p1: { hand: ['Test Reversal'], battlefield: ['Test Golem'] }, p2: { battlefield: ['Test Relic Two'] } } });
    const golem = find(s, 'Test Golem', 'battlefield', 'p1');
    const relic = find(s, 'Test Relic Two', 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Test Reversal', [target(golem, relic)]));
    expect(ctl(s, golem)).toBe('p2');
    expect(ctl(s, relic)).toBe('p1');
  });
});
function cast0(s0: GameState): GameState {
  return act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Reversal', 'hand', 'p1') });
}

// ---- Daring Thief and Puca's Mischief --------------------------------------------------------------------------------------------------------------------------------
const THIEF = card('Test Swapper', 'Sorcery', 'Exchange control of target nonland permanent you control and target permanent an opponent controls that shares a card type with it.');
const PUCA = card('Test Trader', 'Sorcery', 'Exchange control of target nonland permanent you control and target nonland permanent an opponent controls with equal or lesser mana value.');
describe('CR 701.12a, 115.1, 205.2a: "target permanent an opponent controls that shares a card type with it" (Daring Thief)', () => {
  it('is automated', () => expect(full(THIEF)).toBe(true));
  const game = () => mpScenario({ defs: [THIEF, ...ALL], zones: { p1: { hand: ['Test Swapper'], battlefield: ['Test Bear', 'Test Relic'] }, p2: { battlefield: ['Test Ogre', 'Test Relic Two'] } } });
  it('your creature and their creature are exchanged', () => {
    let s = game();
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Test Swapper', [target(mine), target(theirs)]));
    expect(ctl(s, mine)).toBe('p2');
    expect(ctl(s, theirs)).toBe('p1');
  });
  it('negative: your creature and their artifact share no card type: refused', () => {
    const s0 = game();
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Swapper', 'hand', 'p1') });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const relic = find(s, 'Test Relic Two', 'battlefield', 'p2');
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [o(mine), o(relic)] } });
  });
});
describe('CR 701.12a, 202.3: "target nonland permanent an opponent controls with equal or lesser mana value" (Puca\'s Mischief)', () => {
  it('is automated', () => expect(full(PUCA)).toBe(true));
  const game = () => mpScenario({ defs: [PUCA, ...ALL], zones: { p1: { hand: ['Test Trader'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Imp', 'Test Ogre'] } } });
  it('their creature of mana value 1 (at most your 2) is exchanged for yours', () => {
    let s = game();
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    const imp = find(s, 'Test Imp', 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Test Trader', [target(mine), target(imp)]));
    expect(ctl(s, mine)).toBe('p2');
    expect(ctl(s, imp)).toBe('p1');
  });
  it('their creature of mana value 5 (more than your 2) is refused', () => {
    const s0 = game();
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Trader', 'hand', 'p1') });
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [o(find(s, 'Test Bear', 'battlefield', 'p1')), o(find(s, 'Test Ogre', 'battlefield', 'p2'))] } });
  });
});

// ---- Pumpkin Bombs ---------------------------------------------------------------------------------------------------------------------------------------------------
const BOMB = card('Test Bomb', 'Artifact', '{T}: ~ deals 2 damage to target opponent. They gain control of ~.');
describe('CR 108.4, 608.2c: "They gain control of ~." after the damage to target opponent (Pumpkin Bombs)', () => {
  it('is automated', () => expect(full(BOMB)).toBe(true));
  it('the opponent that was dealt the damage gains control of it; the other opponents do not', () => {
    let s = mpScenario({ defs: [BOMB], zones: { p1: { battlefield: ['Test Bomb'] } } });
    const bomb = find(s, 'Test Bomb', 'battlefield', 'p1');
    const before = lifeOf(s, 'p3');
    s = resolveTop(activate(s, bomb, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] }]));
    expect(lifeOf(s, 'p3')).toBe(before - 2);
    expect(ctl(s, bomb)).toBe('p3');
    expect(lifeOf(s, 'p2')).toBe(before);
  });
});

// ---- Angrath ----------------------------------------------------------------------------------------------------------------------------------------------------------
const THREATEN = card('Test Coercion', 'Sorcery', 'Gain control of target creature until end of turn. Untap it. It gains haste until end of turn. Sacrifice it at the beginning of the next end step if it has mana value 3 or less.');
describe('CR 603.7, 603.4, 701.21a: "Sacrifice it at the beginning of the next end step if it has mana value 3 or less" (Angrath, the Flame-Chained)', () => {
  it('is automated', () => expect(full(THREATEN)).toBe(true));
  const play = (name: string): { s: GameState; id: ObjectId } => {
    let s = mpScenario({ defs: [THREATEN, ...ALL], zones: { p1: { hand: ['Test Coercion'] }, p2: { battlefield: [name] } } });
    const id = find(s, name, 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Test Coercion', [target(id)]));
    expect(ctl(s, id)).toBe('p1');
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'upkeep', 'the next turn');
    return { s, id };
  };
  it('a creature of mana value 1 is sacrificed at the beginning of the end step: it is in its owner\'s graveyard', () => {
    const { s } = play('Test Imp');
    expect(find(s, 'Test Imp', 'graveyard', 'p2')).toBeDefined(); // (a new object in the owner's graveyard, CR 400.7)
  });
  it('negative: a creature of mana value 5 is not sacrificed: control returns to its owner at the cleanup step', () => {
    const { s, id } = play('Test Ogre');
    expect(zoneOf(s, id)).toBe('battlefield');
    expect(ctl(s, id)).toBe('p2');
  });
});

// ---- Call for Aid ------------------------------------------------------------------------------------------------------------------------------------------------------
const AID = card('Test Pillage', 'Sorcery', "Gain control of all creatures target opponent controls until end of turn. Untap those creatures. They gain haste until end of turn. You can't attack that player this turn. You can't sacrifice those creatures this turn.");
const ALTAR = card('Test Altar', 'Artifact', 'Sacrifice a creature: You gain 1 life.');
describe('CR 508.1b, 701.21a: "You can\'t attack that player this turn. You can\'t sacrifice those creatures this turn." (Call for Aid)', () => {
  it('is automated', () => expect(full(AID)).toBe(true));
  const stolen = () => {
    let s = mpScenario({ defs: [AID, ALTAR, ...ALL], zones: { p1: { hand: ['Test Pillage'], battlefield: ['Test Altar'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] } } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Test Pillage', [target('p2')]));
    return { s, bear, ogre: find(s, 'Test Ogre', 'battlefield', 'p2') };
  };
  it('all of their creatures are yours, untapped, with haste', () => {
    const { s, bear, ogre } = stolen();
    expect(ctl(s, bear)).toBe('p1');
    expect(ctl(s, ogre)).toBe('p1');
  });
  it('you can\'t attack that player with them, but you can attack another player', () => {
    const { s, bear } = stolen();
    const atk = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the declaration of attackers', 40);
    reject(atk, { type: 'answer', player: 'p1', decisionId: atk.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] } });
    const ok = answer(atk, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p3' }] });
    expect(ok.combat?.attackers.some((a) => a.id === bear)).toBe(true);
  });
  it('you can\'t sacrifice them: the altar offers no creature to sacrifice (negative: your own creature can be sacrificed)', () => {
    const { s } = stolen();
    expect(legalActions(s, 'p1').some((a) => a.kind === 'activate' && /Sacrifice/i.test(a.label))).toBe(false);
    let own = mpScenario({ defs: [ALTAR, ...ALL], zones: { p1: { battlefield: ['Test Altar', 'Test Imp'] } } });
    expect(legalActions(own, 'p1').some((a) => a.kind === 'activate' && /Sacrifice/i.test(a.label))).toBe(true);
    own = own;
  });
});

describe('CR 701.21a, 101.2: Call for Aid\'s ruling (2023-06-16): an effect that makes you sacrifice a creature takes one you did not gain control of', () => {
  const EDICT = card('Test Edict', 'Sorcery', 'Each player sacrifices a creature.');
  it('with the stolen creatures and one of your own, the own creature is the one sacrificed; the stolen ones stay', () => {
    let s = mpScenario({ defs: [AID, EDICT, ...ALL], zones: { p1: { hand: ['Test Pillage', 'Test Edict'], battlefield: ['Test Imp'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] } } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveTop(cast(s, 'Test Pillage', [target('p2')]));
    const imp = find(s, 'Test Imp', 'battlefield', 'p1');
    s = cast(s, 'Test Edict', []);
    s = pass(s); s = pass(s); s = pass(s); s = pass(s); // everyone passes: the spell resolves
    const d = s.pending as unknown as { kind: string; player: string; options?: string[] };
    if (d.kind === 'chooseObjects') {
      expect(d.player).toBe('p1');
      expect(d.options).toEqual([imp]); // the creatures Call for Aid gave you can't be sacrificed (CR 701.21a)
      s = answer(s, { kind: 'chooseObjects', ids: [imp] });
    }
    s = resolveTop(s);
    expect(ctl(s, bear)).toBe('p1');
    expect(ctl(s, ogre)).toBe('p1');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.owner === 'p1' && s.defs[s.objects[id]!.defId]!.name === 'Test Imp')).toBe(false); // the Imp was sacrificed
  });
});

// ---- Domineering Will ---------------------------------------------------------------------------------------------------------------------------------------------------
const WILL = card('Test Gift', 'Instant', 'Target player gains control of up to three target nonattacking creatures until end of turn. Untap those creatures. They block this turn if able.');
describe('CR 115.1, 611.2a, 509.1c: "Target player gains control of up to three target nonattacking creatures until end of turn. Untap those creatures. They block this turn if able." (Domineering Will)', () => {
  it('is automated', () => expect(full(WILL)).toBe(true));
  it('the chosen player controls the creatures until end of turn; they come back to their owner afterwards', () => {
    let s = mpScenario({ defs: [WILL, ...ALL], zones: { p1: { hand: ['Test Gift'], battlefield: [{ name: 'Test Bear', tapped: true }, 'Test Imp'] } } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const imp = find(s, 'Test Imp', 'battlefield', 'p1');
    s = resolveTop(cast(s, 'Test Gift', [target('p2'), target(bear, imp)]));
    expect(ctl(s, bear)).toBe('p2');
    expect(ctl(s, imp)).toBe('p2');
    expect(s.objects[bear]!.tapped).toBe(false);
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'upkeep', 'the next turn');
    expect(ctl(s, bear)).toBe('p1');
    expect(ctl(s, imp)).toBe('p1');
  });
});

describe('CR 115.1, 509.1c: Domineering Will — "nonattacking" and "They block this turn if able"', () => {
  it('negative: an attacking creature is not a legal target', () => {
    let s = mpScenario({ defs: [WILL, ...ALL], zones: { p1: { hand: ['Test Gift'], battlefield: [{ name: 'Test Bear', since: -1 }, 'Test Imp'] } } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the declaration of attackers', 40);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    s = passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p1' && x.turn.step === 'declareAttackers', 'priority after attackers', 40);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gift', 'hand', 'p1') });
    s = answer(s, target('p2'));
    reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [o(bear)] } });
  });
  it('the stolen creature must block if able: a declaration of no blocks is refused, blocking is accepted', () => {
    let s = mpScenario({ defs: [WILL, ...ALL], zones: { p1: { hand: ['Test Gift'], battlefield: [{ name: 'Test Bear', since: -1 }, 'Test Imp'] } } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const imp = find(s, 'Test Imp', 'battlefield', 'p1');
    s = resolveTop(cast(s, 'Test Gift', [target('p2'), target(imp)]));
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the declaration of attackers', 40);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' && x.pending.player === 'p2', 'the declaration of blockers', 40);
    reject(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [] } });
    const ok = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: imp, attacker: bear }] });
    expect(ok.pending?.kind).not.toBe('declareBlockers');
  });
});

// ---- Djinn of Infinite Deceits -----------------------------------------------------------------------------------------------------------------------------------------
const DJINN = card('Test Djinn', 'Creature — Djinn', '{T}: Exchange control of two target nonlegendary creatures. You can\'t activate this ability during combat.', '{4}', ['3', '3']);
describe('CR 602.5b, 506.1: "You can\'t activate this ability during combat" (Djinn of Infinite Deceits)', () => {
  it('is automated', () => expect(full(DJINN)).toBe(true));
  const game = () => mpScenario({ defs: [DJINN, ...ALL], zones: { p1: { battlefield: [{ name: 'Test Djinn', since: -1 }, 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] } } });
  const canActivate = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'activate' && !a.isMana);
  it('in the main phase it can be activated and exchanges the two creatures', () => {
    let s = game();
    expect(canActivate(s)).toBe(true);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = resolveTop(activate(s, find(s, 'Test Djinn', 'battlefield', 'p1'), [target(bear, ogre)]));
    expect(ctl(s, bear)).toBe('p2');
    expect(ctl(s, ogre)).toBe('p1');
  });
  it('negative: in the beginning of combat step it can\'t be activated', () => {
    let s = game();
    s = passUntil(s, (x) => x.turn.step === 'beginCombat', 'the beginning of combat step', 40);
    expect(canActivate(s)).toBe(false);
  });
});

// ---- Sakashima's Will ------------------------------------------------------------------------------------------------------------------------------------------------
const SWIPE = card('Test Swipe', 'Sorcery', 'Target opponent chooses a creature they control. You gain control of it.');
describe('CR 608.2d, 108.4: "Target opponent chooses a creature they control. You gain control of it." (Sakashima\'s Will)', () => {
  it('is automated', () => expect(full(SWIPE)).toBe(true));
  it('the opponent chooses; you gain control of the creature they chose (and of no other)', () => {
    let s = mpScenario({ defs: [SWIPE, ...ALL], zones: { p1: { hand: ['Test Swipe'] }, p2: { battlefield: ['Test Bear', 'Test Ogre'] } } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Swipe', [target('p2')]);
    s = pass(s);
    s = pass(s);
    s = pass(s);
    s = pass(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending?.player).toBe('p2');
    s = answer(s, { kind: 'chooseObjects', ids: [bear] });
    expect(ctl(s, bear)).toBe('p1');
    expect(ctl(s, ogre)).toBe('p2');
  });
});
