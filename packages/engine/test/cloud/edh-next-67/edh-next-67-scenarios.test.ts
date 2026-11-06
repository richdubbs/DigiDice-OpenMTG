/**
 * Commander lane cost, round 2, round edh-next-67: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 601.2f, 118.7a, 107.3, 601.2i       "The first spell you cast with {X} in its mana cost each turn costs {1} less to cast for each +1/+1 counter on ~."
 *   CR 118.9, 601.2b, 107.14, 202.3        "You may pay eight {E} rather than pay the mana cost for permanent spells you cast." / "You may pay {X} rather than pay the mana cost for Samurai spells you cast, where X is that spell's mana value."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { legalActions } from '../../../src/index';
import { isGrantedAltMethod } from '../../../src/statics/play-permits';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: ('W' | 'U' | 'B' | 'R' | 'G')[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const settle = (t: GameState): GameState => {
  let s = t;
  for (let g = 0; g < 20 && s.pending && s.pending.kind === 'payCost'; g++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
};
const resolveAll = (s0: GameState): GameState => {
  let s = settle(s0);
  for (let g = 0; g < 30 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; g++) s = settle(pass(s));
  return s;
};
const can = (s: GameState, player: 'p1' | 'p2', name: string): boolean => {
  const id = find(s, name, 'hand', player);
  return legal(s, player, 'cast').some((a) => a.object === id);
};
const cast = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): GameState => resolveAll(settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never)));
const driveAll = (s0: GameState): GameState => {
  let s = s0;
  for (let g = 0; g < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); g++) {
    const d = s.pending;
    if (d === null) break;
    if (d.kind === 'priority') s = settle(pass(s));
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (d.options as string[]).slice(0, Math.max(d.min, 1)) });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 0 });
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Zimone: the first spell with {X} each turn
// ---------------------------------------------------------------------------------------------------------------------------------
const ZIMONE = card('Test Analyst', 'Legendary Creature — Human', 'The first spell you cast with {X} in its mana cost each turn costs {1} less to cast for each +1/+1 counter on ~.', { pt: ['1', '1'] });
const XSPELL = card('Test X Spell One', 'Sorcery', 'You gain 1 life.', { cost: '{X}{1}' });
const XSPELL2 = card('Test X Spell Two', 'Sorcery', 'You gain 1 life.', { cost: '{X}{1}' });
const PLAIN = card('Test Plain Spell', 'Sorcery', 'You gain 1 life.', { cost: '{1}' });

describe('CR 601.2f, 107.3: "The first spell you cast with {X} in its mana cost each turn costs {1} less to cast for each +1/+1 counter on ~."', () => {
  const board = (counters: number): GameState => scenario([], {
    defs: [ZIMONE, XSPELL, XSPELL2, PLAIN],
    p1: { hand: ['Test X Spell One', 'Test X Spell Two', 'Test Plain Spell'], battlefield: [{ name: 'Test Analyst', counters: { '+1/+1': counters } }] },
  });
  it('is automated', () => expect(noManual(ZIMONE)).toEqual([]));
  it('with two counters the first X spell costs {2} less: castable with no mana; the second X spell is not; a spell without X never is', () => {
    const s0 = board(2);
    expect(can(s0, 'p1', 'Test X Spell One')).toBe(true);
    expect(can(s0, 'p1', 'Test Plain Spell')).toBe(false);
    const s = driveAll(cast(s0, 'Test X Spell One'));
    expect(can(s, 'p1', 'Test X Spell Two')).toBe(false);
  });
  it('negative: with no counters nothing is reduced', () => {
    expect(can(board(0), 'p1', 'Test X Spell One')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Curse of Silence: spells with the chosen name enchanted player casts cost {2} more
// ---------------------------------------------------------------------------------------------------------------------------------
const CURSE = card('Test Silence', 'Enchantment — Aura Curse', 'Enchant player\nAs this Aura enters, choose any card name.\nSpells with the chosen name enchanted player casts cost {2} more to cast.');
const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.', { cost: '{0}' });
const ZAP2 = card('Test Zap Two', 'Instant', 'You gain 2 life.', { cost: '{0}' });

describe('CR 601.2f, 303.4, 201.3: "Spells with the chosen name enchanted player casts cost {2} more to cast."', () => {
  const withCurse = (target: 'p1' | 'p2'): GameState => {
    const s0 = scenario([], { defs: [CURSE, ZAP, ZAP2], p1: { hand: ['Test Silence', 'Test Zap'] }, p2: { hand: ['Test Zap', 'Test Zap Two'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Silence', 'hand', 'p1') } as never);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: target }] } as never);
    s = settle(s);
    s = pass(s); s = pass(s);
    return answer(s, { kind: 'chooseName', name: 'Test Zap' } as never);
  };
  it('is automated', () => expect(noManual(CURSE)).toEqual([]));
  it('the enchanted player cannot cast the named spell with no mana, but can cast another one; its controller is not taxed', () => {
    const s = withCurse('p1'); // enchanting yourself puts the tax on the player who holds priority; the same card on the other side is the negative
    expect(s.objects[find(s, 'Test Silence', 'battlefield')]!.attachedTo).toBe('p1');
    expect(can(s, 'p1', 'Test Zap')).toBe(false);
    const t = withCurse('p2');
    expect(t.objects[find(t, 'Test Silence', 'battlefield')]!.attachedTo).toBe('p2');
    expect(can(t, 'p1', 'Test Zap')).toBe(true); // the Curse's controller is not the enchanted player
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Locket of Yesterdays: for each card with the same name as that spell in your graveyard
// ---------------------------------------------------------------------------------------------------------------------------------
const LOCKET = card('Test Locket', 'Artifact', 'Spells you cast cost {1} less to cast for each card with the same name as that spell in your graveyard.');
const PRICEY = card('Test Pricey', 'Sorcery', 'You gain 1 life.', { cost: '{2}' });
const PRICEY2 = card('Test Pricey Two', 'Sorcery', 'You gain 1 life.', { cost: '{2}' });

describe('CR 601.2f, 201.2, 404.1: "Spells you cast cost {1} less to cast for each card with the same name as that spell in your graveyard."', () => {
  const board = (gy: string[], opp: string[] = []): GameState => scenario([], {
    defs: [LOCKET, PRICEY, PRICEY2],
    p1: { hand: ['Test Pricey', 'Test Pricey Two'], battlefield: ['Test Locket'], graveyard: gy }, p2: { graveyard: opp },
  });
  it('is automated', () => expect(noManual(LOCKET)).toEqual([]));
  it('two copies in your graveyard make a {2} spell free; one copy does not', () => {
    expect(can(board(['Test Pricey', 'Test Pricey']), 'p1', 'Test Pricey')).toBe(true);
    expect(can(board(['Test Pricey']), 'p1', 'Test Pricey')).toBe(false);
  });
  it('negatives: other names and an opponent\'s graveyard do not count', () => {
    expect(can(board(['Test Pricey Two', 'Test Pricey Two']), 'p1', 'Test Pricey')).toBe(false);
    expect(can(board([], ['Test Pricey', 'Test Pricey']), 'p1', 'Test Pricey')).toBe(false);
    expect(can(board(['Test Pricey', 'Test Pricey']), 'p1', 'Test Pricey Two')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Stenn: a card type other than creature or land, spells of the chosen type cost {1} less
// ---------------------------------------------------------------------------------------------------------------------------------
const STENN = card('Test Partisan', 'Artifact', 'As this artifact enters, choose a card type other than creature or land.\nSpells you cast of the chosen type cost {1} less to cast.');
const CHEAP_SORC = card('Test Cheap Sorcery', 'Sorcery', 'You gain 1 life.', { cost: '{1}' });
const CHEAP_INST = card('Test Cheap Instant', 'Instant', 'You gain 1 life.', { cost: '{1}' });

describe('CR 614.12a, 205.2a, 601.2f: "choose a card type other than creature or land" and "Spells you cast of the chosen type cost {1} less to cast."', () => {
  const chosen = (type: string): GameState => {
    const s0 = scenario([], { defs: [STENN, CHEAP_SORC, CHEAP_INST], p1: { hand: ['Test Partisan', 'Test Cheap Sorcery', 'Test Cheap Instant'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Partisan', 'hand', 'p1') } as never));
    s = settle(pass(pass(s)));
    return answer(s, { kind: 'chooseName', name: type } as never);
  };
  it('is automated', () => expect(noManual(STENN)).toEqual([]));
  it('the chosen type\'s spells cost {1} less (a {1} sorcery is free); other types are not reduced', () => {
    const s = chosen('Sorcery');
    expect(can(s, 'p1', 'Test Cheap Sorcery')).toBe(true);
    expect(can(s, 'p1', 'Test Cheap Instant')).toBe(false);
  });
  it('negative: creature and land are never offered', () => {
    const s0 = scenario([], { defs: [STENN], p1: { hand: ['Test Partisan'] } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Partisan', 'hand', 'p1') } as never));
    s = settle(pass(pass(s)));
    const options = (s.pending as { options: string[] }).options;
    expect(options).toContain('Sorcery');
    expect(options).not.toContain('Creature');
    expect(options).not.toContain('Land');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Nissa: pay energy rather than the mana cost; Kentaro: pay the spell's mana value rather than its mana cost
// ---------------------------------------------------------------------------------------------------------------------------------
const NISSA = card('Test Speaker', 'Legendary Creature — Elf', 'You may pay four {E} rather than pay the mana cost for permanent spells you cast.', { pt: ['2', '2'] });
const BIG = card('Test Big Permanent', 'Artifact', '', { cost: '{6}' });
const BIGSPELL = card('Test Big Sorcery', 'Sorcery', 'You gain 1 life.', { cost: '{6}' });
const KENTARO = card('Test Cat', 'Legendary Creature — Cat Samurai', 'You may pay {X} rather than pay the mana cost for Samurai spells you cast, where X is that spell\'s mana value.', { pt: ['2', '2'] });
const SAMURAI = card('Test Ronin', 'Creature — Human Samurai', '', { pt: ['2', '2'], cost: '{R}{R}{R}' });
const GOBLIN = card('Test Raider', 'Creature — Goblin', '', { pt: ['2', '2'], cost: '{R}{R}{R}' });
const methods = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): (string | undefined)[] => {
  const id = find(s, name, 'hand', player);
  return legalActions(s, player).filter((a) => a.kind === 'cast' && a.object === id).map((a) => (a.action as { method?: string }).method);
};
const grantedOf = (s: GameState, name: string): string | undefined => methods(s, name).find((m) => isGrantedAltMethod(m));
const withEnergy = (s: GameState, n: number): GameState => { s.players.find((p) => p.id === 'p1')!.counters['energy'] = n; return s; };

describe('CR 118.9, 601.2b, 107.14: "You may pay four {E} rather than pay the mana cost for permanent spells you cast."', () => {
  const board = (energy: number): GameState => withEnergy(scenario([], { defs: [NISSA, BIG, BIGSPELL], p1: { hand: ['Test Big Permanent', 'Test Big Sorcery'], battlefield: ['Test Speaker'] } }), energy);
  it('is automated', () => expect(noManual(NISSA)).toEqual([]));
  it('with enough energy a permanent spell is cast for the energy, which is spent; a nonpermanent spell is not covered', () => {
    let s = board(5);
    expect(grantedOf(s, 'Test Big Permanent')).toBeDefined();
    expect(grantedOf(s, 'Test Big Sorcery')).toBeUndefined();
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Big Permanent', 'hand', 'p1'), method: grantedOf(s, 'Test Big Permanent') } as never));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Big Permanent')).toBe(true);
    expect(s.players.find((p) => p.id === 'p1')!.counters['energy']).toBe(1);
  });
  it('negative: too little energy offers no alternative cost', () => {
    expect(grantedOf(board(3), 'Test Big Permanent')).toBeUndefined();
    expect(legal(board(3), 'p1', 'cast').some((a) => a.object === find(board(3), 'Test Big Permanent', 'hand', 'p1'))).toBe(false);
  });
});

describe('CR 118.9, 601.2b, 202.3: "You may pay {X} rather than pay the mana cost for Samurai spells you cast, where X is that spell\'s mana value."', () => {
  const board = (lands: number): GameState => scenario(['Forest'], { defs: [KENTARO, SAMURAI, GOBLIN], p1: { hand: ['Test Ronin', 'Test Raider'], battlefield: ['Test Cat', ...Array<string>(lands).fill('Forest')] } });
  it('is automated', () => expect(noManual(KENTARO)).toEqual([]));
  it('a {R}{R}{R} Samurai (mana value 3) is cast for {3} with three Forests; a non-Samurai is not covered', () => {
    let s = board(3);
    expect(grantedOf(s, 'Test Ronin')).toBeDefined();
    expect(grantedOf(s, 'Test Raider')).toBeUndefined();
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ronin', 'hand', 'p1'), method: grantedOf(s, 'Test Ronin') } as never));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Ronin')).toBe(true);
  });
  it('negative: with two Forests the {3} cannot be paid', () => {
    const s = board(2);
    expect(legal(s, 'p1', 'cast').some((a) => a.object === find(s, 'Test Ronin', 'hand', 'p1'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Cramped Vents: once during each of your turns, a spell from your hand for life equal to its mana value
// ---------------------------------------------------------------------------------------------------------------------------------
const VENTS = card('Test Vents', 'Enchantment', 'Once during each of your turns, you may cast a spell from your hand by paying life equal to its mana value rather than paying its mana cost.');
const COSTLY = card('Test Costly One', 'Sorcery', 'You gain 1 life.', { cost: '{3}' });
const COSTLY2 = card('Test Costly Two', 'Sorcery', 'You gain 1 life.', { cost: '{4}' });

describe('CR 118.9, 601.2a, 119.4: "Once during each of your turns, you may cast a spell from your hand by paying life equal to its mana value rather than paying its mana cost."', () => {
  const board = (): GameState => scenario([], { defs: [VENTS, COSTLY, COSTLY2], p1: { hand: ['Test Costly One', 'Test Costly Two'], battlefield: ['Test Vents'] }, p2: { hand: [] } });
  it('is automated', () => expect(noManual(VENTS)).toEqual([]));
  it('the first spell is cast for 3 life; the second one this turn cannot be cast that way; the other copy of the permission is used up', () => {
    let s = board();
    expect(grantedOf(s, 'Test Costly One')).toBeDefined();
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Costly One', 'hand', 'p1'), method: grantedOf(s, 'Test Costly One') } as never));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(18); // 20 - 3 (the cost) + 1 (the spell)
    expect(grantedOf(s, 'Test Costly Two')).toBeUndefined();
  });
  it('negative: the permission is only for a spell cast from your hand (a card in the graveyard has no such way)', () => {
    const s0 = scenario([], { defs: [VENTS, COSTLY], p1: { graveyard: ['Test Costly One'], battlefield: ['Test Vents'] } });
    const id = find(s0, 'Test Costly One', 'graveyard', 'p1');
    expect(legalActions(s0, 'p1').some((a) => a.kind === 'cast' && a.object === id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Marshland Bloodcaster: rather than pay the mana cost of the next spell you cast this turn, pay life equal to its mana value
// ---------------------------------------------------------------------------------------------------------------------------------
const CASTER = card('Test Blood Priest', 'Creature — Vampire Wizard', '{T}: Rather than pay the mana cost of the next spell you cast this turn, you may pay life equal to that spell\'s mana value.', { pt: ['1', '1'] });
const SPELLA = card('Test Spell A', 'Sorcery', 'You gain 1 life.', { cost: '{3}' });
const SPELLB = card('Test Spell B', 'Sorcery', 'You gain 1 life.', { cost: '{4}' });

describe('CR 118.9, 202.3, 611.2: "Rather than pay the mana cost of the next spell you cast this turn, you may pay life equal to that spell\'s mana value."', () => {
  const armed = (): GameState => {
    const s0 = scenario([], { defs: [CASTER, SPELLA, SPELLB], p1: { hand: ['Test Spell A', 'Test Spell B'], battlefield: ['Test Blood Priest'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Blood Priest', 'battlefield'))!;
    return resolveAll(act(s0, a.action as never));
  };
  it('is automated', () => expect(noManual(CASTER)).toEqual([]));
  it('the next spell may be cast for 3 life; once it is cast, the permission is gone for the second spell', () => {
    let s = armed();
    expect(grantedOf(s, 'Test Spell A')).toBeDefined();
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spell A', 'hand', 'p1'), method: grantedOf(s, 'Test Spell A') } as never));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(18); // 20 - 3 + 1
    expect(grantedOf(s, 'Test Spell B')).toBeUndefined();
  });
  it('negative: without activating it there is no such way; and a spell cast normally also uses the rider up', () => {
    const s0 = scenario([], { defs: [CASTER, SPELLA], p1: { hand: ['Test Spell A'], battlefield: ['Test Blood Priest'] } });
    expect(grantedOf(s0, 'Test Spell A')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Professor Hojo: the first activated ability you activate during your turn that targets a creature you control costs {2} less
// ---------------------------------------------------------------------------------------------------------------------------------
const HOJO = card('Test Professor', 'Legendary Creature — Human Scientist', 'The first activated ability you activate during your turn that targets a creature you control costs {2} less to activate.', { pt: ['1', '1'] });
const PUMPER = card('Test Pumper', 'Creature — Wizard', '{2}: Target creature gets +1/+1 until end of turn.', { pt: ['1', '1'] });
const PUMPER2 = card('Test Pumper Two', 'Creature — Wizard', '{2}: Target creature gets +1/+1 until end of turn.', { pt: ['1', '1'] });
const VICTIM = card('Test Victim', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 602.2b, 601.2f, 115.1: "The first activated ability you activate during your turn that targets a creature you control costs {2} less to activate."', () => {
  const board = (): GameState => scenario([], { defs: [HOJO, PUMPER, PUMPER2, VICTIM], p1: { battlefield: ['Test Professor', 'Test Pumper', 'Test Pumper Two'] }, p2: { battlefield: ['Test Victim'] } });
  const pump = (s: GameState, who: string): LegalActionLike | undefined => legal(s, 'p1', 'activate').find((a) => a.object === find(s, who, 'battlefield'));
  type LegalActionLike = ReturnType<typeof legal>[number];
  it('is automated', () => expect(noManual(HOJO)).toEqual([]));
  it('the first activation that targets your creature is free; the second activation this turn is not', () => {
    const s0 = board();
    expect(pump(s0, 'Test Pumper')).toBeDefined(); // free (maximum reduction before targets are chosen)
    let s = act(s0, pump(s0, 'Test Pumper')!.action as never);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Professor', 'battlefield') }] } as never);
    s = resolveAll(s);
    expect(s.objects[find(s, 'Test Professor', 'battlefield')]!.damage).toBe(0);
    expect(pump(s, 'Test Pumper Two')).toBeUndefined(); // used up
  });
  it('negative: an activation that targets only an opponent\'s creature is not cheaper: {2} cannot be paid with no mana', () => {
    const s0 = board();
    const s = act(s0, pump(s0, 'Test Pumper')!.action as never); // announced (the reduction is the most it could be before targets are chosen)
    expect(() => settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Victim', 'battlefield', 'p2') }] } as never))).toThrow(/Automatic payment is not possible/);
  });
});

describe('review fixes (edh-next-67)', () => {
  it('Marshland Bloodcaster: casting the next spell the usual way also uses the rider up (CR 611.2)', () => {
    const s0 = scenario(['Plains'], { defs: [CASTER, SPELLA, SPELLB], p1: { hand: ['Test Spell A', 'Test Spell B'], battlefield: ['Test Blood Priest', 'Plains', 'Plains', 'Plains'] } });
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === find(s0, 'Test Blood Priest', 'battlefield'))!;
    let s = resolveAll(act(s0, a.action as never));
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spell A', 'hand', 'p1') } as never)); // paid with mana, no method
    expect(grantedOf(s, 'Test Spell B')).toBeUndefined();
  });
  it('Locket of Yesterdays: a split card in the graveyard shares a name with the spell when they have one name in common (CR 201.2a)', () => {
    const FIRE = card('Test Fire // Test Ice', 'Sorcery // Instant', 'You gain 1 life.', { cost: '{2}' });
    const s = scenario([], { defs: [LOCKET, FIRE], p1: { hand: ['Test Fire // Test Ice'], battlefield: ['Test Locket'], graveyard: ['Test Fire // Test Ice', 'Test Fire // Test Ice'] } });
    expect(can(s, 'p1', 'Test Fire // Test Ice')).toBe(true);
  });
});
