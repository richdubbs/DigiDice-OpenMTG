/**
 * Commander lane edh-cast, round edh-cast-7: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them,
 * and the Scryfall rulings of each card were fetched live.
 *
 *   CR 705.2, 707.10c, 608.2c  "If you lose the flip, return that spell to its owner's hand. If you win the flip, copy that spell, and you may choose new targets for
 *                              the copy.": the two results exclude each other; "that spell" is the spell that caused the trigger in both
 *   CR 101.2, 601.3, 611.2a    "Players can't cast creature or planeswalker spells until the end of your next turn." (Single Combat)
 *   CR 601.3, 510.4            "Cast this spell only before the combat damage step." (Berserk)
 *   CR 118.9, 701.9a           "You may discard an Island card and another card rather than pay this spell's mana cost." (Foil)
 *   CR 609.4b, 601.2g          "If you cast a spell this way, mana of any type can be spent to cast it." (Bloodsoaked Insight)
 *   CR 601.2f, 103.4, 119.1    "If your life total is less than your starting life total, this spell costs {X} less to cast, where X is the difference."
 *   CR 903.8, 118.9d           "You may cast your commander from the command zone without paying its mana cost." (Geode Golem): the commander tax is still paid
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act as mpAct, answer as mpAnswer, concede as mpConcede, drive as mpDrive, find as mpFind, mpScenario, passUntil as mpPassUntil } from '../../m12/rules/helpers';
import { act, advanceTo, answer, find, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers, toStep, tweak } from '../../m4/helpers';
import { answerUntilPriority, commanderOnBattlefield, commanderRec, commanderScenario, forests, legend, untappedForests } from '../../m11/rules/helpers';
import { activate, cast, drive, pt, resolveAll, resolveTop, target } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; colors?: string[]; pt?: [string, string] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const inZone = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => s.zones[zone][p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);
const castable = (s: GameState, p: 'p1' | 'p2', name: string): boolean => legalActions(s, p).some((l) => l.kind === 'cast' && s.defs[s.objects[l.object!]!.defId]!.name === name);

describe('CR 705.2, 707.10c, 608.2c: "If you lose the flip, return that spell to its owner\'s hand. If you win the flip, copy that spell, and you may choose new targets for the copy."', () => {
  const FLINGER = card('Test Coinflinger', 'Creature — Goblin', "Whenever you cast an instant or sorcery spell, flip a coin. If you lose the flip, return that spell to its owner's hand. If you win the flip, copy that spell, and you may choose new targets for the copy.", { pt: ['1', '1'] });
  const SPARK = card('Test Sparkle', 'Instant', 'You gain 2 life.');
  const defs = [FLINGER, SPARK];
  const flipped = (call: 'heads' | 'tails'): GameState => {
    let s = scenario([], { defs, p1: { hand: ['Test Sparkle'], battlefield: ['Test Coinflinger'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sparkle', 'hand', 'p1') }));
    s = resolveTop(s); // the trigger
    expect(s.pending?.kind).toBe('chooseOption');
    s = drive(answer(s, { kind: 'chooseOption', ids: [call] }));
    return s;
  };
  it('is automated with no manual part', () => {
    expect(noManual(FLINGER)).toBe(true);
  });
  it('one call wins: the spell is copied (resolves twice: +4 life); the other loses: the spell goes back to the hand and resolves never (the two results exclude each other)', () => {
    const outcomes = (['heads', 'tails'] as const).map((call) => {
      let s = flipped(call);
      const back = inZone(s, 'hand', 'p1').includes('Test Sparkle');
      for (let g = 0; g < 10 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
      return { back, gained: life(s, 'p1') - 20 };
    });
    const won = outcomes.find((o) => !o.back)!;
    const lost = outcomes.find((o) => o.back)!;
    expect(won).toEqual({ back: false, gained: 4 });
    expect(lost).toEqual({ back: true, gained: 0 });
  });
});

describe('Krark: rulings 2020-11-10 when the spell is no longer on the stack', () => {
  const FLINGER = card('Test Coinflinger', 'Creature — Goblin', "Whenever you cast an instant or sorcery spell, flip a coin. If you lose the flip, return that spell to its owner's hand. If you win the flip, copy that spell, and you may choose new targets for the copy.", { pt: ['1', '1'] });
  const SPARK = card('Test Sparkle', 'Instant', 'You gain 2 life.');
  const SNUFF = card('Test Snuffer', 'Artifact', '{0}: Counter target spell.');
  const defs = [FLINGER, SPARK, SNUFF];
  const countered = (call: 'heads' | 'tails'): GameState => {
    let s = scenario([], { defs, p1: { hand: ['Test Sparkle'], battlefield: ['Test Coinflinger', 'Test Snuffer'] } });
    s = cast(s, 'Test Sparkle');
    const spark = s.zones.stack.find((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Sparkle')!;
    s = activate(s, find(s, 'Test Snuffer', 'battlefield', 'p1'), [target(spark)]);
    s = resolveTop(s); // Snuffer counters Sparkle; the trigger is still on the stack
    expect(inZone(s, 'graveyard', 'p1')).toContain('Test Sparkle');
    s = resolveTop(s); // the trigger: flip
    s = drive(answer(s, { kind: 'chooseOption', ids: [call] }));
    for (let g = 0; g < 10 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    return s;
  };
  it('lose the flip with the spell gone (countered): nothing is returned, it stays in the graveyard; win the flip: the copy is still created (it resolves: +2 life)', () => {
    const results = (['heads', 'tails'] as const).map((call) => {
      const s = countered(call);
      return { inGrave: inZone(s, 'graveyard', 'p1').includes('Test Sparkle'), inHand: inZone(s, 'hand', 'p1').includes('Test Sparkle'), gained: life(s, 'p1') - 20 };
    });
    expect(results.find((r) => r.gained === 0)).toEqual({ inGrave: true, inHand: false, gained: 0 });
    expect(results.find((r) => r.gained === 2)).toEqual({ inGrave: true, inHand: false, gained: 2 });
  });
});

describe('CR 101.2, 601.3, 611.2a: "Players can\'t cast creature or planeswalker spells until the end of your next turn." (eff.edhc7.players.cantCast.filter.dur)', () => {
  const STANDOFF = card('Test Standoff', 'Sorcery', "Each player chooses a creature or planeswalker they control, then sacrifices the rest. Players can't cast creature or planeswalker spells until the end of your next turn.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'] });
  const ARTEFACT = card('Test Trinket', 'Artifact', '');
  const SPARK = card('Test Sparkle', 'Instant', 'You gain 2 life.');
  const defs = [STANDOFF, BEAR, CUB, ARTEFACT, SPARK];
  const played = (): GameState => {
    let s = scenario([], { defs, p1: { hand: ['Test Standoff', 'Test Cub', 'Test Sparkle'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { hand: ['Test Cub', 'Test Trinket', 'Test Sparkle'], battlefield: ['Test Bear', 'Test Bear'] } });
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1');
    const theirs = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    s = cast(s, 'Test Standoff');
    s = resolveTop(s, [{ kind: 'chooseObjects', ids: [mine[0]!] }, { kind: 'chooseObjects', ids: [theirs[1]!] }]);
    expect(s.zones.battlefield).toEqual([mine[0], theirs[1]]); // each player kept the one creature they chose
    return s;
  };
  it('is automated with no manual part', () => {
    expect(noManual(STANDOFF)).toBe(true);
  });
  it('right after it resolves neither player can cast a creature spell, but an instant is still cast (the negative case)', () => {
    const s = played();
    expect(castable(s, 'p1', 'Test Cub')).toBe(false);
    expect(castable(s, 'p1', 'Test Sparkle')).toBe(true);
    const t = pass(s); // p2 gets priority
    expect(castable(t, 'p2', 'Test Cub')).toBe(false);
    expect(castable(t, 'p2', 'Test Sparkle')).toBe(true);
  });
  it("it lasts through the opponent's turn 2 and the caster's next turn 3 and ends with it: p2 casts a creature spell on turn 4, p1 on turn 5", () => {
    const s = played();
    const t2 = advanceTo(s, 2, 'main1');
    expect(castable(t2, 'p2', 'Test Cub')).toBe(false);
    expect(castable(t2, 'p2', 'Test Trinket')).toBe(true); // not a creature spell (the negative case)
    const t3 = advanceTo(t2, 3, 'main1');
    expect(castable(t3, 'p1', 'Test Cub')).toBe(false); // "until the end of your next turn": turn 3 is p1's next turn
    const t4 = advanceTo(t3, 4, 'main1');
    expect(castable(t4, 'p2', 'Test Cub')).toBe(true);
  });
});

describe('CR 601.3, 510.4: "Cast this spell only before the combat damage step." (rst.edhc7.cast.self.beforeCombatDamage); Berserk\'s destroy at the next end step', () => {
  const FRENZY = card('Test Frenzy', 'Instant', 'Cast this spell only before the combat damage step.\nTarget creature gains trample and gets +X/+0 until end of turn, where X is its power. At the beginning of the next end step, destroy that creature if it attacked this turn.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const defs = [FRENZY, BEAR];
  const base = (): GameState => scenario([], { defs, p1: { hand: ['Test Frenzy'], battlefield: ['Test Bear'] }, p2: { hand: [] } });
  const bear = (s: GameState): string => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')!;
  it('is automated with no manual part', () => {
    expect(noManual(FRENZY)).toBe(true);
  });
  it('castable in the first main phase, in the beginning of combat, in the declare attackers step and in the declare blockers step', () => {
    let s = base();
    expect(castable(s, 'p1', 'Test Frenzy')).toBe(true);
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[bear(s)]]);
    expect(s.turn.step).toBe('declareAttackers');
    expect(castable(s, 'p1', 'Test Frenzy')).toBe(true);
    s = toStep(s, 'declareBlockers');
    expect(castable(s, 'p1', 'Test Frenzy')).toBe(true);
  });
  it('negative: not in the combat damage step, not in the second main phase (the instant is castable at those times otherwise)', () => {
    let s = base();
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[bear(s)]]);
    s = toStep(s, 'combatDamage');
    expect(castable(s, 'p1', 'Test Frenzy')).toBe(false);
    s = toStep(s, 'main2');
    expect(castable(s, 'p1', 'Test Frenzy')).toBe(false);
    s = toStep(s, 'end');
    expect(castable(s, 'p1', 'Test Frenzy')).toBe(false);
  });
  it('a creature that attacked is destroyed at the next end step, with trample and +X/+0 (X is its power: 2/2 -> 4/2)', () => {
    let s = base();
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[bear(s)]]);
    s = cast(s, 'Test Frenzy', [target(bear(s))]);
    s = resolveAll(s);
    expect(pt(s, bear(s))).toEqual([4, 2]);
    s = toStep(s, 'end');
    s = resolveAll(s);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear')).toEqual([]);
    expect(inZone(s, 'graveyard', 'p1')).toContain('Test Bear');
  });
  it('negative: a creature that did not attack survives the end step', () => {
    let s = base();
    s = cast(s, 'Test Frenzy', [target(bear(s))]);
    s = resolveAll(s);
    expect(pt(s, bear(s))).toEqual([4, 2]);
    s = advanceTo(s, 1, 'end'); // no attackers are declared on the way
    s = resolveAll(s);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear').length).toBe(1);
  });
});

describe('CR 118.9, 701.9a, 118.3: "You may discard an Island card and another card rather than pay this spell\'s mana cost." (the Cost hole\'s "and another card")', () => {
  const WARD = card('Test Ward Spell', 'Instant', "You may discard an Island card and another card rather than pay this spell's mana cost.\nCounter target spell.", { cost: '{2}{U}{U}', colors: ['U'] });
  const SPARK = card('Test Sparkle', 'Instant', 'You gain 2 life.');
  const defs = [WARD, SPARK];
  const castActions = (s: GameState, name: string) => legalActions(s, 'p1').filter((l) => l.kind === 'cast' && s.defs[s.objects[l.object!]!.defId]!.name === name);
  it('is automated with no manual part', () => {
    expect(noManual(WARD)).toBe(true);
  });
  const withHand = (hand: string[]): GameState => cast(scenario(['Island'], { defs, p1: { hand } }), 'Test Sparkle');
  it('an Island and another card (here a Plains) pay for it: both are discarded, no mana is spent, the spell is cast and counters its target', () => {
    let s = withHand(['Test Ward Spell', 'Island', 'Plains', 'Test Sparkle']);
    const spark = s.zones.stack.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Sparkle')!;
    const alt = castActions(s, 'Test Ward Spell')[0]!.action;
    s = drive(act(s, alt), [target(spark)]);
    expect(s.zones.stack.map((id) => s.defs[s.objects[id]!.defId]?.name)).toEqual(['Test Sparkle', 'Test Ward Spell']);
    expect(inZone(s, 'graveyard', 'p1').sort()).toEqual(['Island', 'Plains']);
    expect(inZone(s, 'hand', 'p1')).toEqual([]);
    s = resolveAll(s);
    expect(inZone(s, 'graveyard', 'p1')).toContain('Test Sparkle'); // countered
    expect(life(s, 'p1')).toBe(20);
  });
  it('two Islands pay it too (the second is "another card")', () => {
    const s = withHand(['Test Ward Spell', 'Island', 'Island', 'Test Sparkle']);
    expect(castActions(s, 'Test Ward Spell').map((l) => (l.action as { method?: string }).method)).toEqual(['alternative']);
  });
  it('negative: an Island alone is not enough (the spell is not in the hand to be discarded, CR 601.2a), nor are two cards that are no Island', () => {
    expect(castActions(withHand(['Test Ward Spell', 'Island', 'Test Sparkle']), 'Test Ward Spell')).toEqual([]);
    expect(castActions(withHand(['Test Ward Spell', 'Plains', 'Plains', 'Test Sparkle']), 'Test Ward Spell')).toEqual([]);
  });
  it('the cost part is read as a discard of an Island card and a discard of one more card; a lone "discard a card and another card" is a different wording', () => {
    expect(JSON.stringify(WARD.faces[0]!.abilities)).toContain('"kind":"discard"');
    expect(noManual(card('Test Ward Relic', 'Artifact', 'Discard an Island card and another card: You gain 2 life.'))).toBe(true);
    expect(noManual(card('Test Ward Relic', 'Artifact', 'Discard a card and another card: You gain 2 life.'))).toBe(false);
  });
});

describe('CR 609.4b, 601.2g, 611.2a: "Until the end of your next turn, you may play those cards. If you cast a spell this way, mana of any type can be spent to cast it." (rid.edhc7.castThisWay.anyManaType.passive)', () => {
  const BARGAIN = card('Test Dark Bargain', 'Sorcery', 'Target opponent exiles the top three cards of their library. Until the end of your next turn, you may play those cards. If you cast a spell this way, mana of any type can be spent to cast it.', { cost: '{1}' });
  const BOLT = card('Test Red Bolt', 'Instant', 'You gain 2 life.', { cost: '{R}', colors: ['R'] });
  const OTHER = card('Test Red Twin', 'Instant', 'You gain 3 life.', { cost: '{R}', colors: ['R'] });
  const defs = [BARGAIN, BOLT, OTHER];
  const exiled = (): GameState => {
    let s = scenario(['Mountain'], { defs, p1: { hand: ['Test Dark Bargain', 'Test Red Twin'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: {} });
    s = tweak(s, (t) => {
      const lib = t.zones.library['p2']!;
      const tops = ['Test Red Bolt', 'Mountain', 'Plains'].map((n) => put(t, 'p2', 'library', n));
      t.zones.library['p2'] = [...tops, ...lib.filter((id) => !tops.includes(id))];
    });
    s = cast(s, 'Test Dark Bargain', [target('p2')]);
    return resolveAll(s);
  };
  it('is automated with no manual part', () => {
    expect(noManual(BARGAIN)).toBe(true);
  });
  it('the opponent\'s top three cards are exiled and p1 casts the red instant with white mana (mana of any type); the same instant from p1\'s own hand is not helped (the negative case)', () => {
    let s = exiled();
    expect(s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Mountain', 'Plains', 'Test Red Bolt']);
    expect(castable(s, 'p1', 'Test Red Bolt')).toBe(true); // {R} paid with a Plains
    expect(castable(s, 'p1', 'Test Red Twin')).toBe(false); // {R} from the hand: only Plains available, no mana of another type for it
    const la = legalActions(s, 'p1').find((l) => l.kind === 'cast' && s.defs[s.objects[l.object!]!.defId]!.name === 'Test Red Bolt')!;
    s = resolveAll(drive(act(s, la.action)));
    expect(life(s, 'p1')).toBe(22);
    expect(inZone(s, 'graveyard', 'p2')).toContain('Test Red Bolt'); // its owner's graveyard
  });
  it('a land of the exiled cards is played, not cast (the permission is to play them)', () => {
    const s = exiled();
    expect(legalActions(s, 'p1').some((l) => l.kind === 'playLand' && s.defs[s.objects[l.object!]!.defId]!.name === 'Mountain')).toBe(true);
  });
});

describe('CR 601.2f, 103.4, 119.1: "If your life total is less than your starting life total, this spell costs {X} less to cast, where X is the difference." (cm.edhc7.self.less.lifeDifference)', () => {
  const HULK = card('Test Dusk Hulk', 'Creature — Avatar', 'If your life total is less than your starting life total, this spell costs {X} less to cast, where X is the difference.', { cost: '{6}{B}{B}', colors: ['B'], pt: ['6', '6'] });
  const hulkWith = (swamps: number, lifeTotal: number): GameState => {
    const s = scenario(['Swamp'], { defs: [HULK], p1: { hand: ['Test Dusk Hulk'], battlefield: Array(swamps).fill('Swamp') as string[] } });
    return tweak(s, (t) => { t.players.find((p) => p.id === 'p1')!.life = lifeTotal; });
  };
  it('is automated with no manual part', () => {
    expect(noManual(HULK)).toBe(true);
  });
  it('at the starting life total of 20 there is no reduction: five Swamps do not pay {6}{B}{B}', () => {
    expect(castable(hulkWith(5, 20), 'p1', 'Test Dusk Hulk')).toBe(false);
    expect(castable(hulkWith(8, 20), 'p1', 'Test Dusk Hulk')).toBe(true);
  });
  it('at 17 life the difference is 3: {3}{B}{B} is payable with five Swamps and not with four', () => {
    expect(castable(hulkWith(5, 17), 'p1', 'Test Dusk Hulk')).toBe(true);
    expect(castable(hulkWith(4, 17), 'p1', 'Test Dusk Hulk')).toBe(false);
  });
  it('negative: above the starting life total (25) nothing is reduced', () => {
    expect(castable(hulkWith(5, 25), 'p1', 'Test Dusk Hulk')).toBe(false);
  });
  it('only generic mana is reduced: at 1 life ({19} less) {B}{B} remains, so two Swamps pay it and one does not', () => {
    expect(castable(hulkWith(2, 1), 'p1', 'Test Dusk Hulk')).toBe(true);
    expect(castable(hulkWith(1, 1), 'p1', 'Test Dusk Hulk')).toBe(false);
  });
  it("the starting life total is the game's: with 40 (Commander) at 37 life the difference is 3", () => {
    const s = tweak(scenario(['Swamp'], { life: 40, defs: [HULK], p1: { hand: ['Test Dusk Hulk'], battlefield: Array(5).fill('Swamp') as string[] } }), (t) => { t.players.find((p) => p.id === 'p1')!.life = 37; });
    expect(castable(s, 'p1', 'Test Dusk Hulk')).toBe(true);
    const t = tweak(s, (u) => { u.players.find((p) => p.id === 'p1')!.life = 40; });
    expect(castable(t, 'p1', 'Test Dusk Hulk')).toBe(false);
  });
});

describe('CR 903.8, 118.9d: "You may cast your commander from the command zone without paying its mana cost." (eff.edhc7.cast.yourCommander.free)', () => {
  const GOLEM = card('Test Quarry Golem', 'Artifact', '{T}: You may cast your commander from the command zone without paying its mana cost.');
  const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
  const KRAUM = legend('Test Kraum', '{1}{G}', ['2', '2'], ['U', 'R'], 'Partner');
  const TYMNA = legend('Test Tymna', '{G}', ['1', '1'], ['W', 'B'], 'Partner');
  const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
  const game = (commanders: CardDef[], forestCount: number, casts: Record<string, number> = {}): GameState => {
    const s = commanderScenario({ p1Commanders: commanders, p2Commanders: [BOB], defs: [GOLEM], p1: { battlefield: ['Test Quarry Golem', ...forests(forestCount)] } });
    return tweak(s, (t) => { for (const [n, c] of Object.entries(casts)) commanderRec(t, 'p1', n).casts = c; });
  };
  const useGolem = (s: GameState, answers: DecisionAnswer[] = []): GameState => {
    const g = s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Quarry Golem')!;
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === g)!;
    let t = drive(act(s, la.action));
    t = pass(pass(t)); // the ability resolves
    return answerUntilPriority(t, answers);
  };
  it('is automated with no manual part', () => {
    expect(noManual(GOLEM)).toBe(true);
  });
  const names = (s: GameState, ids: string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
  const choose = (t: GameState, name: string): GameState => {
    expect(t.pending?.kind).toBe('chooseObjects');
    const opts = (t.pending as { options: string[] }).options;
    return answerUntilPriority(t, [{ kind: 'chooseObjects', ids: opts.filter((id) => names(t, [id])[0] === name) }]);
  };
  const onStack = (s: GameState): string[] => names(s, s.zones.stack);
  it('with no mana at all the commander is cast for free from the command zone (the first cast has no commander tax); the cast is counted', () => {
    const t = choose(useGolem(game([TITANIA], 0)), 'Test Titania');
    expect(onStack(t)).toEqual(['Test Titania']);
    expect(commanderRec(t, 'p1', 'Test Titania').casts).toBe(1);
  });
  it('the commander tax is still paid (ruling 2018-07-13): with the commander cast once before, {2} are paid from two Forests; with one Forest the cast does not happen', () => {
    const paid = choose(useGolem(game([TITANIA], 2, { 'Test Titania': 1 })), 'Test Titania');
    expect(onStack(paid)).toEqual(['Test Titania']);
    expect(untappedForests(paid, 'p1')).toBe(0);
    expect(commanderRec(paid, 'p1', 'Test Titania').casts).toBe(2);
    const short = choose(useGolem(game([TITANIA], 1, { 'Test Titania': 1 })), 'Test Titania');
    expect(onStack(short)).toEqual([]);
    expect(untappedForests(short, 'p1')).toBe(1);
    expect(commanderRec(short, 'p1', 'Test Titania').casts).toBe(1);
  });
  it('with two commanders (partner) either one is chosen, each with its own tax (CR 702.124d): Tymna is free while Kraum, cast once, would cost {2}', () => {
    const s = game([KRAUM, TYMNA], 0, { 'Test Kraum': 1 });
    const t = useGolem(s);
    expect(names(t, (t.pending as { options: string[] }).options).sort()).toEqual(['Test Kraum', 'Test Tymna']);
    const u = choose(t, 'Test Tymna');
    expect(onStack(u)).toEqual(['Test Tymna']);
    const v = choose(useGolem(s), 'Test Kraum');
    expect(onStack(v)).toEqual([]); // {2} for the tax, no mana
  });
  it("negative: the opponent's commander is never offered, and a commander that is on the battlefield (not in the command zone) is not either", () => {
    const t = useGolem(game([TITANIA], 0));
    expect(names(t, (t.pending as { options: string[] }).options)).toEqual(['Test Titania']);
    const s0 = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [GOLEM], p1: { battlefield: ['Test Quarry Golem', 'Test Titania'] } });
    const s = commanderOnBattlefield(s0, 'Test Titania');
    const u = useGolem(s);
    expect(u.pending?.kind).not.toBe('chooseObjects');
  });
});

describe('Single Combat ruling 2019-05-03 (CR 800.4m, 611.2a): the caster leaves the game before their next turn', () => {
  const STANDOFF = card('Test Standoff', 'Sorcery', "Each player chooses a creature or planeswalker they control, then sacrifices the rest. Players can't cast creature or planeswalker spells until the end of your next turn.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'] });
  it('in a four-player game the effect lasts until the caster\'s next turn would have begun: creature spells are cast again after that seat is passed (not never)', () => {
    const zones: Record<string, { hand: string[]; battlefield: string[] }> = {};
    for (const p of ['p1', 'p2', 'p3', 'p4']) zones[p] = { hand: p === 'p1' ? ['Test Standoff', 'Test Cub'] : ['Test Cub'], battlefield: ['Test Bear', 'Test Bear', ...(p === 'p1' ? ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] : [])] };
    let s = mpScenario({ defs: [STANDOFF, BEAR, CUB], zones } as never);
    s = mpDrive(mpAct(s, { type: 'cast', player: 'p1', card: mpFind(s, 'Test Standoff', 'hand', 'p1') }));
    for (let i = 0; i < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      const d = s.pending!;
      if (d.kind === 'priority') s = mpAct(s, { type: 'pass', player: d.player });
      else if (d.kind === 'chooseObjects') s = mpAnswer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
      else if (d.kind === 'payCost') s = mpAnswer(s, { kind: 'payCost', auto: true });
      else break;
    }
    const can = (t: GameState, p: string): boolean => legalActions(t, p as 'p1').some((l) => l.kind === 'cast' && t.defs[t.objects[l.object!]!.defId]!.name === 'Test Cub');
    s = mpConcede(s, 'p1').state;
    const at = (n: number): GameState => mpPassUntil(s, (t) => t.turn.number === n && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.pending.player === t.turn.activePlayer, `turn ${n}`);
    const t2 = at(2);
    expect(can(t2, t2.turn.activePlayer)).toBe(false); // still within the effect
    const t6 = at(6);
    expect(can(t6, t6.turn.activePlayer)).toBe(true); // p1's seat was passed on turn 5: the effect has ended, it does not last for the rest of the game
  });
});
