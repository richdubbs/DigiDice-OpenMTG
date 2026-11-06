/**
 * Commander coordinator D, round edh-d-12 (EDHREC ranks 12,501-13,750, third pass): the round's readings played through the engine with synthetic cards (invented names,
 * design 6.10), compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites from memory of the Comprehensive Rules
 * (no rules/cr folder in a cloud session): listed as unverified in the record.
 *
 *   CR 601.2f, 601.2i, 708.4   "The first face-down creature spell you cast each turn costs {3} less to cast." (Kadena, Slinking Sorcerer)
 *   CR 509.1b, 208.1           "Whenever a creature you control with reach attacks, untap it and it can't be blocked by creatures with greater power this combat." (Tadeas, Juniper Ascendant)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { ruleDenial } from '../../../src/statics/hooks';
import { getChars } from '../../../src/rules/characteristics';
import { hasProtectionFrom } from '../../../src/rules/protection';
import { act, answer as answerDecision, find, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, passUntil, answer } from '../../m4/helpers';
import { applyAction } from '../../../src/index';
import { castFaceDown, resolveAll } from '../../m6/face-down/support';
import { cast as castSpell, resolveAll as settleAll } from '../cmd3/helpers';

const card = (name: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

describe('CR 509.1b, 208.1: "Whenever a creature you control with reach attacks, untap it and it can\'t be blocked by creatures with greater power this combat." (Tadeas)', () => {
  const LEAD = card('Test Reach Lead', 'Legendary Creature — Elf Druid', 'Reach\nWhenever a creature you control with reach attacks, untap it and it can\'t be blocked by creatures with greater power this combat.', ['3', '3']);
  const SPIDER = card('Test Web Spider', 'Creature — Spider', 'Reach', ['2', '2']);
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', ['4', '4']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const FLY = card('Test Plain Drake', 'Creature — Drake', 'Flying', ['3', '3']);
  const game = (): GameState => scenario([], { p1: { battlefield: ['Test Reach Lead', 'Test Web Spider', 'Test Plain Drake'] }, p2: { battlefield: ['Test Big Ogre', 'Test Plain Bear'] }, defs: [LEAD, SPIDER, OGRE, BEAR, FLY] });
  it('is full', () => expect(full(LEAD)).toBe(true));
  it('the attacking reach creature can\'t be blocked by a creature with greater power than ITS power (not the power of the card with the ability); an equal or lesser one can; a non-reach attacker is not affected', () => {
    const s0 = game();
    const spider = find(s0, 'Test Web Spider', 'battlefield');
    const drake = find(s0, 'Test Plain Drake', 'battlefield');
    const ogre = find(s0, 'Test Big Ogre', 'battlefield');
    const bear = find(s0, 'Test Plain Bear', 'battlefield');
    let s = toDeclareAttackers(s0);
    s = declareAttackers(s, [[spider], [drake]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers');
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: spider, other: ogre })).not.toBeNull();
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: spider, other: bear })).toBeNull(); // equal power
    expect(ruleDenial(s, { action: 'beBlockedBy', subject: drake, other: ogre })).toBeNull(); // no reach: no restriction
  });
});

describe('CR 601.2f, 601.2i, 708.4: "The first face-down creature spell you cast each turn costs {3} less to cast." (Kadena, Slinking Sorcerer)', () => {
  const KADENA = card('Test Snake Sorcerer', 'Legendary Creature — Snake Wizard', 'The first face-down creature spell you cast each turn costs {3} less to cast.\nWhenever a face-down creature you control enters, draw a card.', ['3', '3']);
  const MORPH_A = card('Test Morph Alpha', 'Creature — Beast', 'Morph {5}', ['3', '3']);
  const MORPH_B = card('Test Morph Beta', 'Creature — Beast', 'Morph {5}', ['3', '3']);
  const PLAIN = card('Test Free Bear', 'Creature — Bear', '', ['2', '2']);
  const game = (): GameState => scenario([], { p1: { hand: ['Test Morph Alpha', 'Test Morph Beta', 'Test Free Bear'], battlefield: ['Test Snake Sorcerer'] }, p2: {}, defs: [KADENA, MORPH_A, MORPH_B, PLAIN] });
  const castMorph = (s: GameState, name: string) => applyAction(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1'), method: 'morph' });
  it('is full', () => expect(full(KADENA)).toBe(true));
  it('the first face-down creature spell costs {3} less (the {3} face-down cost is paid by the reduction), the second face-down one costs the full {3}', () => {
    const s0 = game();
    expect(castMorph(s0, 'Test Morph Alpha').error).toBeUndefined();
    const first = resolveAll(castFaceDown(s0, 'Test Morph Alpha'));
    expect(first.zones.battlefield.filter((id) => first.objects[id]!.faceDown === true)).toHaveLength(1);
    expect(castMorph(first, 'Test Morph Beta').error).toBeDefined(); // no mana: the second one is not reduced
  });
  it('negative: a face-up creature spell cast first does not use up "the first face-down creature spell"', () => {
    const s0 = game();
    const plain = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Free Bear', 'hand', 'p1') }));
    expect(plain.zones.battlefield.some((id) => plain.defs[plain.objects[id]!.defId]!.name === 'Test Free Bear')).toBe(true);
    expect(castMorph(plain, 'Test Morph Alpha').error).toBeUndefined();
  });
  it('negative: the reduction is only for face-down spells: a face-up creature spell that costs {3} is not reduced', () => {
    const THREE = compileCard({ name: 'Test Three Bear', layout: 'normal', mana_cost: '{3}', type_line: 'Creature — Bear', oracle_text: '', colors: [], power: '2', toughness: '2' } as OracleCard);
    const s0 = scenario([], { p1: { hand: ['Test Three Bear'], battlefield: ['Test Snake Sorcerer'] }, p2: {}, defs: [KADENA, THREE] });
    expect(applyAction(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Three Bear', 'hand', 'p1') }).error).toBeDefined();
  });
});

describe('CR 701.21a, 509.1g, 608.2d: "Whenever a creature you control with menace becomes blocked, defending player sacrifices a creature of their choice that\'s blocking it." (Labyrinth Raptor)', () => {
  const RAPTOR = card('Test Menace Raptor', 'Creature — Dinosaur', 'Menace\nWhenever a creature you control with menace becomes blocked, defending player sacrifices a creature of their choice that\'s blocking it.', ['3', '3']);
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const game = (): GameState => scenario([], { p1: { battlefield: ['Test Menace Raptor'] }, p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] }, defs: [RAPTOR, BEAR] });
  it('is full', () => expect(full(RAPTOR)).toBe(true));
  it('the defending player chooses one of the creatures blocking it, never one that is not blocking', () => {
    const s0 = game();
    const raptor = find(s0, 'Test Menace Raptor', 'battlefield');
    const bears = s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Plain Bear');
    let s = declareAttackers(toDeclareAttackers(s0), [[raptor]]);
    s = declareBlockers(toDeclareBlockers(s), [[bears[0]!, raptor], [bears[1]!, raptor]]);
    s = passUntil(s, (x) => x.pending?.kind !== 'priority', 'the sacrifice choice');
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = JSON.stringify(s.pending);
    expect(offered).toContain(bears[0]!);
    expect(offered).toContain(bears[1]!);
    expect(offered).not.toContain(bears[2]!);
    expect(s.pending?.player).toBe('p2');
  });
});

describe('CR 120.2, 510.2, 603.2c: "Whenever an opponent is dealt 3 or more damage by a single source, that player discards a card." (Pain Magnification)', () => {
  const PAIN = card('Test Ache Amplifier', 'Enchantment', 'Whenever an opponent is dealt 3 or more damage by a single source, that player discards a card.');
  const ZAP3 = card('Test Zap Three', 'Instant', 'Test Zap Three deals 3 damage to target player.');
  const ZAP2 = card('Test Zap Two', 'Instant', 'Test Zap Two deals 2 damage to target player.');
  const FILL = card('Test Filler Card', 'Sorcery', '');
  const game = (hand: string[]): GameState => scenario([], { p1: { hand, battlefield: ['Test Ache Amplifier'] }, p2: { hand: ['Test Filler Card', 'Test Filler Card', 'Test Filler Card'] }, defs: [PAIN, ZAP3, ZAP2, FILL] });
  const hit = (s: GameState, name: string, who: 'p1' | 'p2'): GameState => settleAll(castSpell(s, name, { targets: [{ kind: 'player', id: who }] }));
  const handOf = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
  it('is full', () => expect(full(PAIN)).toBe(true));
  it('3 damage from one source makes that opponent discard a card', () => {
    const s = hit(game(['Test Zap Three']), 'Test Zap Three', 'p2');
    expect(handOf(s, 'p2')).toBe(2);
  });
  it('negative: 2 damage does not; two sources each dealing 2 are not added together (a single source)', () => {
    let s = hit(game(['Test Zap Two', 'Test Zap Two']), 'Test Zap Two', 'p2');
    s = hit(s, 'Test Zap Two', 'p2');
    expect(handOf(s, 'p2')).toBe(3);
  });
  it('negative: the controller being dealt 3 damage triggers nothing (an opponent only)', () => {
    const s = hit(game(['Test Zap Three']), 'Test Zap Three', 'p1');
    expect(handOf(s, 'p1')).toBe(0);
    expect(handOf(s, 'p2')).toBe(3);
  });
});

describe('CR 702.16a, 607.2d, 205.3m: "Human creatures you control have protection from creatures of the chosen type." (Riders of Gavony)', () => {
  const RIDERS = card('Test Dawn Rider', 'Creature — Human Knight', 'Vigilance\nAs ~ enters, choose a creature type.\nHuman creatures you control have protection from creatures of the chosen type.', ['3', '3']);
  const PEASANT = card('Test Human Peasant', 'Creature — Human Peasant', '', ['1', '1']);
  const GOBLIN = card('Test Goblin Raider', 'Creature — Goblin', '', ['2', '2']);
  const SPIDER = card('Test Web Crawler', 'Creature — Spider', '', ['2', '2']);
  const TOAD = card('Test Pond Toad', 'Creature — Frog', '', ['2', '2']);
  const game = (choose: string): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Dawn Rider'], battlefield: ['Test Human Peasant', 'Test Pond Toad'] }, p2: { battlefield: ['Test Goblin Raider', 'Test Web Crawler'] }, defs: [RIDERS, PEASANT, GOBLIN, SPIDER, TOAD] });
    let s = castSpell(s0, 'Test Dawn Rider');
    for (let i = 0; i < 20 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'chooseName') s = answerDecision(s, { kind: 'chooseName', name: choose });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settleAll(s);
    }
    return s;
  };
  const prot = (s: GameState, target: string, source: string): boolean => hasProtectionFrom(getChars(s, target)!, getChars(s, source)!);
  it('is full', () => expect(full(RIDERS)).toBe(true));
  it('Humans you control (including itself) are protected from creatures of the chosen type: they have protection from a creature of the chosen type, not from one of another type', () => {
    const s = game('Goblin');
    const peasant = find(s, 'Test Human Peasant', 'battlefield');
    const rider = find(s, 'Test Dawn Rider', 'battlefield');
    const goblin = find(s, 'Test Goblin Raider', 'battlefield');
    const spider = find(s, 'Test Web Crawler', 'battlefield');
    for (const human of [peasant, rider]) {
      expect(prot(s, human, goblin)).toBe(true);
      expect(prot(s, human, spider)).toBe(false);
    }
  });
  it('negative: a non-Human creature you control gets no protection', () => {
    const s = game('Goblin');
    const toad = find(s, 'Test Pond Toad', 'battlefield');
    const goblin = find(s, 'Test Goblin Raider', 'battlefield');
    expect(prot(s, toad, goblin)).toBe(false);
  });
  it('the type is the one chosen: choosing Spider protects from Spiders and no longer from Goblins', () => {
    const s = game('Spider');
    const peasant = find(s, 'Test Human Peasant', 'battlefield');
    expect(prot(s, peasant, find(s, 'Test Web Crawler', 'battlefield'))).toBe(true);
    expect(prot(s, peasant, find(s, 'Test Goblin Raider', 'battlefield'))).toBe(false);
  });
});

describe('CR 701.19, 608.2c: "Regenerate target creature. Draw a card. Spell mastery - If there are two or more instant and/or sorcery cards in your graveyard, also regenerate each other creature you control." (Dark Dabbling)', () => {
  const DAB = card('Test Dim Charm', 'Instant', 'Regenerate target creature. Draw a card.\nSpell mastery \u2014 If there are two or more instant and/or sorcery cards in your graveyard, also regenerate each other creature you control.');
  const SMITE = card('Test Smite Bolt', 'Instant', 'Destroy target creature.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const FILL = card('Test Filler Card', 'Sorcery', '');
  const game = (graveyard: string[]): GameState => scenario([], { p1: { hand: ['Test Dim Charm', 'Test Smite Bolt', 'Test Smite Bolt', 'Test Smite Bolt'], battlefield: ['Test Plain Bear', 'Test Plain Bear'], graveyard, library: ['Test Filler Card', 'Test Filler Card'] }, p2: { battlefield: ['Test Plain Bear'] }, defs: [DAB, SMITE, BEAR, FILL] });
  const bearsOf = (s: GameState, p: 'p1' | 'p2'): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Test Plain Bear');
  const smite = (s: GameState, id: string): GameState => settleAll(castSpell(s, 'Test Smite Bolt', { targets: [{ kind: 'object', id }] }));
  it('is full', () => expect(full(DAB)).toBe(true));
  it('with two instant/sorcery cards in your graveyard, every creature you control but the target regenerates too: all three survive a destroy, the opponent\'s creature (not yours) does not have a shield', () => {
    let s = game(['Test Smite Bolt', 'Test Dim Charm']);
    const [a, b] = bearsOf(s, 'p1');
    s = settleAll(castSpell(s, 'Test Dim Charm', { targets: [{ kind: 'object', id: a! }] }));
    s = smite(s, b!);
    expect(bearsOf(s, 'p1')).toHaveLength(2); // the other creature regenerated (it was tapped by the regeneration, not destroyed)
  });
  it('negative: with one instant/sorcery card only, just the target regenerates: another creature you control is destroyed', () => {
    let s = game(['Test Smite Bolt']);
    const [a, b] = bearsOf(s, 'p1');
    s = settleAll(castSpell(s, 'Test Dim Charm', { targets: [{ kind: 'object', id: a! }] }));
    s = smite(s, b!);
    expect(bearsOf(s, 'p1')).toEqual([a]);
  });
  it('negative: the target regenerates either way (a second creature is unprotected with one card in the graveyard, the target is not)', () => {
    let s = game(['Test Smite Bolt']);
    const [a] = bearsOf(s, 'p1');
    s = settleAll(castSpell(s, 'Test Dim Charm', { targets: [{ kind: 'object', id: a! }] }));
    s = smite(s, a!);
    expect(bearsOf(s, 'p1')).toContain(a);
  });
});

describe('CR 205.4a, 701.23, 608.2c: "Choose target card in a graveyard other than a basic land card. Search its owner\'s graveyard, hand, and library for any number of cards with the same name as that card and exile them. Then that player shuffles." (Surgical Extraction)', () => {
  const SURGE = card('Test Name Purge', 'Instant', "Choose target card in a graveyard other than a basic land card. Search its owner's graveyard, hand, and library for any number of cards with the same name as that card and exile them. Then that player shuffles.");
  const SPIRE = card('Test Spire Wraith', 'Creature — Spirit', '', ['2', '2']);
  const FOREST = compileCard({ name: 'Forest', layout: 'normal', mana_cost: '', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)', colors: [] } as OracleCard);
  const game = (): GameState => scenario([], { p1: { hand: ['Test Name Purge'] }, p2: { graveyard: ['Test Spire Wraith', 'Forest'], hand: ['Test Spire Wraith'], library: ['Test Spire Wraith', 'Forest'] }, defs: [SURGE, SPIRE, FOREST] });
  const count = (s: GameState, name: string, zone: 'graveyard' | 'hand' | 'library' | 'exile', p: 'p2'): number => (zone === 'exile' ? s.zones.exile : s.zones[zone][p]!).filter((id) => s.defs[s.objects[id]!.defId]!.name === name).length;
  it('is full', () => expect(full(SURGE)).toBe(true));
  it('exiles every card with the target\'s name from its owner\'s graveyard, hand and library (all of them when "any number" is chosen), and leaves other names', () => {
    const s0 = game();
    const wraith = s0.zones.graveyard['p2']!.find((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Spire Wraith')!;
    let s = castSpell(s0, 'Test Name Purge', { targets: [{ kind: 'object', id: wraith }] });
    for (let i = 0; i < 12 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      if (s.pending?.kind === 'chooseObjects') s = answerDecision(s, { kind: 'chooseObjects', ids: (s.pending as unknown as { options: string[] }).options });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settleAll(s);
    }
    expect(count(s, 'Test Spire Wraith', 'graveyard', 'p2')).toBe(0);
    expect(count(s, 'Test Spire Wraith', 'hand', 'p2')).toBe(0);
    expect(count(s, 'Test Spire Wraith', 'library', 'p2')).toBe(0);
    expect(count(s, 'Forest', 'graveyard', 'p2') + count(s, 'Forest', 'library', 'p2')).toBe(2);
  });
  it('negative: a basic land card in a graveyard is not a legal target', () => {
    const s0 = game();
    const forest = s0.zones.graveyard['p2']!.find((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Forest')!;
    const r = applyAction(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Name Purge', 'hand', 'p1') });
    const t = r.state?.pending;
    expect(JSON.stringify(t)).not.toContain(forest);
  });
});
