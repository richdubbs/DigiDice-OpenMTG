/**
 * M6-12: the copy keywords as keyword data on M6-2's copy machinery (m6 design 3.3, "Embalm, eternalize, encore, myriad, squad, offspring are keyword data over
 * `copy result:'token'` with `except`"; "Replicate and conspire become keyword data"). Real fixture cards on the game path:
 *   Sacred Cat ("Lifelink / Embalm {W}"), Proven Combatant ("Eternalize {4}{U}{U}"), Ultramarines Honour Guard ("Squad {2} / Other creatures you control get
 *   +1/+1."), Rust-Shield Rampager ("Offspring {2} / This creature can't be blocked by creatures with power 2 or less."), Pyromatics ("Replicate {1}{R} /
 *   Pyromatics deals 1 damage to any target."), Burn Trail ("Burn Trail deals 3 damage to any target. / Conspire").
 * Encore and myriad: encore-myriad.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, getChars, type GameState, type ObjectId } from '../../../src/index';
import { getCard } from '../../fixtures';
import { act, find, pass, scenario } from '../../m5/helpers';
import { activate, drive, resolveTop, stackNames, target } from '../../m5/cr-examples/helpers';
import { lifeOf } from '../../m4/helpers';

const tokens = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name);
const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];

describe('the copy keywords are capabilities and their fixture cards are full (game path)', () => {
  const cards: [string, string][] = [
    ['embalm', 'Sacred Cat'], ['eternalize', 'Proven Combatant'], ['squad', 'Ultramarines Honour Guard'], ['offspring', 'Rust-Shield Rampager'],
    ['replicate', 'Pyromatics'], ['conspire', 'Burn Trail'],
  ];
  for (const [kw, card] of cards) {
    it(`keyword:${kw}; ${card} is full`, () => {
      expect(ENGINE_CAPABILITIES.has(`keyword:${kw}`)).toBe(true);
      expect(compileCard(getCard(card)).automation.level).toBe('full');
    });
  }
});

describe('CR 702.128: embalm', () => {
  it('CR 702.128a, 707.9b: exiled from the graveyard as a cost, Sacred Cat becomes a token copy that is a white Zombie Cat with no mana cost', () => {
    let s = scenario(['Sacred Cat', 'Plains'], { p1: { graveyard: ['Sacred Cat'], battlefield: ['Plains'] } });
    s = activate(s, find(s, 'Sacred Cat', 'graveyard'));
    expect(exiled(s)).toEqual(['Sacred Cat']); // the cost (CR 118.3)
    s = resolveTop(s);
    const [cat] = tokens(s);
    const c = getChars(s, cat!);
    expect([c.name, c.colors, c.types, c.subtypes, c.manaCost, c.manaValue, c.power, c.toughness]).toEqual(['Sacred Cat', ['W'], ['Creature'], ['Cat', 'Zombie'], null, 0, '1', '1']);
    expect(c.keywords.map((k) => k.keyword)).toContain('lifelink'); // CR 707.2: the copied abilities
  });

  it('CR 702.128a: "Embalm only as a sorcery" and only from the graveyard', () => {
    const inHand = scenario(['Sacred Cat', 'Plains'], { p1: { hand: ['Sacred Cat'], battlefield: ['Plains'] } });
    expect(() => activate(inHand, find(inHand, 'Sacred Cat', 'hand'))).toThrow(/no activation/);
    let s = scenario(['Sacred Cat', 'Plains', 'Shock', 'Mountain'], { p1: { graveyard: ['Sacred Cat'], hand: ['Shock'], battlefield: ['Plains', 'Mountain'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'hand') });
    s = drive(s, [target('p2')]);
    expect(stackNames(s)).toEqual(['Shock']);
    expect(() => activate(s, find(s, 'Sacred Cat', 'graveyard'))).toThrow(/no activation/); // CR 307.5: not while the stack isn't empty
  });

  it('CR 707.9b: the exceptions are copiable values: a token copy of the embalmed token is a white Zombie Cat with no mana cost too', () => {
    let s = scenario(['Sacred Cat', 'Plains'], { p1: { graveyard: ['Sacred Cat'], battlefield: ['Plains'] } });
    s = resolveTop(activate(s, find(s, 'Sacred Cat', 'graveyard')));
    const def = s.defs[s.objects[tokens(s)[0]!]!.defId]!;
    expect([def.faces[0]!.manaCost, def.faces[0]!.colors, def.faces[0]!.subtypes]).toEqual([null, ['W'], ['Cat', 'Zombie']]);
  });
});

describe('CR 702.129: eternalize', () => {
  it('CR 702.129a, 707.9b: Proven Combatant becomes a 4/4 black Zombie Human Warrior token with no mana cost', () => {
    let s = scenario(['Proven Combatant', 'Island'], { p1: { graveyard: ['Proven Combatant'], battlefield: lands('Island', 6) } });
    s = resolveTop(activate(s, find(s, 'Proven Combatant', 'graveyard')));
    const c = getChars(s, tokens(s)[0]!);
    expect([c.colors, c.subtypes, c.manaCost, c.manaValue, c.power, c.toughness]).toEqual([['B'], ['Human', 'Warrior', 'Zombie'], null, 0, '4', '4']);
    expect(exiled(s)).toEqual(['Proven Combatant']);
  });
});

describe('CR 702.157: squad', () => {
  /** Cast Ultramarines Honour Guard paying its squad cost `n` times, and resolve the spell and its trigger. */
  function squad(n: number, plains: number): GameState {
    let s = scenario(['Ultramarines Honour Guard', 'Plains'], { p1: { hand: ['Ultramarines Honour Guard'], battlefield: lands('Plains', plains) } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Ultramarines Honour Guard', 'hand') }), [{ kind: 'chooseNumber', n }]);
    s = resolveTop(s);
    return s.zones.stack.length > 0 ? resolveTop(s) : s;
  }

  it('CR 702.157a: the squad cost paid twice ({3}{W} + {2} + {2}) creates two token copies as it enters', () => {
    const s = squad(2, 8);
    expect(tokens(s)).toHaveLength(2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(8);
    const original = find(s, 'Ultramarines Honour Guard', 'battlefield');
    expect(getChars(s, original).power).toBe('4'); // each copy has "Other creatures you control get +1/+1."
  });

  it('CR 702.157a, 603.4: with the squad cost not paid, nothing triggers; the tokens themselves were not cast, so they create nothing', () => {
    const s = squad(0, 8);
    expect(tokens(s)).toHaveLength(0);
    expect(s.zones.stack).toEqual([]);
  });

  it('CR 601.2b: the number of payments offered is what the player can pay ({3}{W} and two {2} with eight lands)', () => {
    let s = scenario(['Ultramarines Honour Guard', 'Plains'], { p1: { hand: ['Ultramarines Honour Guard'], battlefield: lands('Plains', 8) } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Ultramarines Honour Guard', 'hand') });
    expect(s.pending?.kind === 'chooseNumber' ? [s.pending.min, s.pending.max, s.pending.rules] : undefined).toEqual([0, 2, ['CR 601.2b', 'CR 702.157a']]);
  });
});

describe('CR 702.175: offspring', () => {
  it('CR 702.175a, 707.9b: with its offspring cost paid, Rust-Shield Rampager\'s token copy is 1/1 and keeps its abilities', () => {
    let s = scenario(['Rust-Shield Rampager', 'Forest'], { p1: { hand: ['Rust-Shield Rampager'], battlefield: lands('Forest', 6) } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Rust-Shield Rampager', 'hand') }), [{ kind: 'yesNo', yes: true }]);
    s = resolveTop(resolveTop(s));
    const [tok] = tokens(s);
    const c = getChars(s, tok!);
    expect([c.name, c.power, c.toughness]).toEqual(['Rust-Shield Rampager', '1', '1']);
    expect(c.abilities.some((a) => /can't be blocked/.test(a.def.text))).toBe(true);
  });

  it('CR 702.175a, 603.4: without the offspring cost, no token', () => {
    let s = scenario(['Rust-Shield Rampager', 'Forest'], { p1: { hand: ['Rust-Shield Rampager'], battlefield: lands('Forest', 6) } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Rust-Shield Rampager', 'hand') }), [{ kind: 'yesNo', yes: false }]);
    s = resolveTop(s);
    expect(tokens(s)).toHaveLength(0);
    expect(s.zones.stack).toEqual([]);
  });

  it('CR 608.2h: if the creature leaves before the trigger resolves, the token is a copy of it as it last existed', () => {
    let s = scenario(['Rust-Shield Rampager', 'Forest', 'Unsummon', 'Island'], { p1: { hand: ['Rust-Shield Rampager'], battlefield: lands('Forest', 6) }, p2: { hand: ['Unsummon'], battlefield: ['Island'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Rust-Shield Rampager', 'hand') }), [{ kind: 'yesNo', yes: true }]);
    s = resolveTop(s);
    expect(stackNames(s)).toEqual(['ability of Rust-Shield Rampager']);
    s = pass(s); // Bob receives priority (CR 117.3d)
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Unsummon', 'hand', 'p2') }), [target(find(s, 'Rust-Shield Rampager', 'battlefield'))]);
    s = resolveTop(s); // Unsummon: the Rampager returns to its owner's hand
    s = resolveTop(s);
    expect(tokens(s).map((id) => [getChars(s, id).name, getChars(s, id).power])).toEqual([['Rust-Shield Rampager', '1']]);
  });
});

describe('CR 702.56: replicate', () => {
  it('CR 702.56a: Pyromatics with its replicate cost paid twice is copied twice; each copy may have a new target', () => {
    let s = scenario(['Pyromatics', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Pyromatics'], battlefield: lands('Mountain', 6) }, p2: { battlefield: ['Grizzly Bears'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Pyromatics', 'hand') }), [{ kind: 'chooseNumber', n: 2 }, target('p2')]);
    expect(stackNames(s)).toEqual(['Pyromatics', 'ability of Pyromatics']);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = resolveTop(s, [{ kind: 'yesNo', yes: true }, target(bears), { kind: 'yesNo', yes: true }, target(bears)]);
    expect(stackNames(s)).toEqual(['Pyromatics', 'Pyromatics', 'Pyromatics']);
    for (let i = 0; i < 3; i++) s = resolveTop(s);
    expect(lifeOf(s, 'p2')).toBe(19); // the original kept its target
    expect(s.zones.graveyard.p2!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toContain('Grizzly Bears');
  });

  it('CR 702.56a, 603.4: with no replicate payment, the cast trigger does not trigger', () => {
    let s = scenario(['Pyromatics', 'Mountain'], { p1: { hand: ['Pyromatics'], battlefield: lands('Mountain', 6) } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Pyromatics', 'hand') }), [{ kind: 'chooseNumber', n: 0 }, target('p2')]);
    expect(stackNames(s)).toEqual(['Pyromatics']);
  });
});

describe('CR 702.78: conspire', () => {
  it('CR 702.78a: tapping two untapped red creatures as Burn Trail is cast copies it; the copy may have a new target', () => {
    let s = scenario(['Burn Trail', 'Mountain', 'Raging Goblin'], { p1: { hand: ['Burn Trail'], battlefield: [...lands('Mountain', 4), 'Raging Goblin', 'Raging Goblin'] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Burn Trail', 'hand') }), [{ kind: 'yesNo', yes: true }, target('p2')]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(6);
    expect(stackNames(s)).toEqual(['Burn Trail', 'ability of Burn Trail']);
    s = resolveTop(s, [{ kind: 'yesNo', yes: false }]);
    s = resolveTop(resolveTop(s));
    expect(lifeOf(s, 'p2')).toBe(14);
  });

  it('CR 702.78a: creatures that share no color with the spell can\'t pay it (Grizzly Bears are green): no question, no copy', () => {
    let s = scenario(['Burn Trail', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['Burn Trail'], battlefield: [...lands('Mountain', 4), 'Grizzly Bears', 'Grizzly Bears'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Burn Trail', 'hand') });
    expect(s.pending?.kind).toBe('chooseTargets');
    s = drive(s, [target('p2')]);
    expect(stackNames(s)).toEqual(['Burn Trail']);
  });
});

describe('M6-12: a keyword granted without the parameter its expansion needs stays manual (feature:keyword.missing.<param>)', () => {
  // r5-cost: "The embalm cost is equal to its mana cost." is read now (keywords/expand.ts, KeywordAbilityDef.costIsManaCost); an embalm granted with no cost at all is still manual
  it('"gains embalm until end of turn." with no cost keeps the granted embalm manual; the card compiles and plays', () => {
    const def = compileCard({
      name: 'Test Wrappings', layout: 'normal', mana_cost: '{2}', type_line: 'Artifact', colors: [],
      oracle_text: '{T}: Target creature card in your graveyard gains embalm until end of turn.',
    } as never);
    expect(def.automation.level).not.toBe('full');
    expect(JSON.stringify(def.faces[0]!.abilities)).toContain('needs-engine: feature:keyword.missing.cost');
    expect(ENGINE_CAPABILITIES.has('feature:keyword.missing.cost')).toBe(false);
  });
});
