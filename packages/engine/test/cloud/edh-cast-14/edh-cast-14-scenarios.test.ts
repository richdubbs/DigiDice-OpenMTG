/**
 * edh-cast-14 scenarios (Commander lane edh-cast): each new reading played through the engine with synthetic cards (invented names, design 6.10), with its negative case.
 * Rules (Comprehensive Rules 2026-09-25, fetched; cites checked against that text unless the record says otherwise):
 *   CR 707.10, 707.12, 608.2g  "Copy that card three times. You may cast the copies without paying their mana costs." (Mnemonic Deluge)
 *   CR 118.9, 601.2b, 608.2c   "If this spell was cast from a graveyard, you may play cards this way without paying their mana costs." (Ignite the Future)
 *   CR 118.9, 118.1, 119.7     "If you control a Forest, rather than pay this spell's mana cost, you may have an opponent gain 3 life." (Invigorate)
 *   CR 707.10c, 115.1, 601.2c  "copy that spell for each other creature you control that the spell could target. Each copy targets a different one of those creatures." (Zada, Hedron Grinder)
 */
import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, type GameState } from '../../../src/index';
import { act, card, drive, find, full, lifeOf, obj, resolveAll, scenario } from '../r3-cost/support';
import { answer, pass } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

const canCastFrom = (s0: GameState, name: string, zone: 'hand' | 'graveyard', method?: string): boolean => {
  const s = s0.pending?.kind === 'priority' && s0.pending.player !== 'p1' ? pass(s0) : s0;
  return applyAction(s, { type: 'cast', player: 'p1', card: find(s, name, zone, 'p1'), ...(method !== undefined ? { method } : {}) }).error === undefined;
};

describe('CR 707.10, 707.12, 608.2g: "Copy that card three times. You may cast the copies without paying their mana costs."', () => {
  const SURGE = card('Test Echo Surge', 'Sorcery', 'Exile target instant or sorcery card from a graveyard. Copy that card three times. You may cast the copies without paying their mana costs. Exile ~.', '{1}');
  const BOLT = card('Test Pebble Bolt', 'Instant', 'Test Pebble Bolt deals 2 damage to any target.', '{1}');
  const DEFS = [SURGE, BOLT];
  const setup = () => scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains'], hand: ['Test Echo Surge'], graveyard: ['Test Pebble Bolt'] } });
  const target = (s: GameState) => ({ kind: 'object' as const, id: find(s, 'Test Pebble Bolt', 'graveyard', 'p1') });
  const cast = (s: GameState, script: Parameters<typeof drive>[1]) =>
    resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Echo Surge', 'hand', 'p1') }), { targets: [[target(s)]] }), script);
  const p2 = { kind: 'player' as const, id: 'p2' };
  it('is automated', () => { expect(full(SURGE)).toBe(true); });
  it('three copies of the exiled bolt are cast free: 6 damage; the bolt and the surge end in exile and nothing is left in the graveyard (the copies cease to exist)', () => {
    const s = cast(setup(), { yes: [true, true, true], targets: [[p2], [p2], [p2]] });
    expect(lifeOf(s, 'p2')).toBe(14);
    expect(s.zones.exile.filter((id) => ['Test Pebble Bolt', 'Test Echo Surge'].includes(s.objects[id]!.defId)).length).toBe(2);
  });
  it('CR 707.12: the copies are cast during the resolution; casting only two of them (the third declined) deals 4 damage', () => {
    const s = cast(setup(), { yes: [true, true, false], targets: [[p2], [p2]] });
    expect(lifeOf(s, 'p2')).toBe(16);
  });
  it('declining every copy: no damage, and no card stays behind except the exiled original', () => {
    const s = cast(setup(), { yes: [false, false, false] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Pebble Bolt')).toBe(false);
  });
});

describe('CR 118.9, 608.2c: "If this spell was cast from a graveyard, you may play cards this way without paying their mana costs." (the second sentence is a free permission for the cards of the first)', () => {
  const STUDY = card('Test Ember Study', 'Sorcery', 'Exile the top two cards of your library. Until the end of your next turn, you may play those cards. If ~ was cast from a graveyard, you may play cards this way without paying their mana costs.\nFlashback {1}', '{1}');
  const TOME = card('Test Costly Tome', 'Sorcery', 'You gain 5 life.', '{5}');
  const DEFS = [STUDY, TOME];
  const setup = (zone: 'hand' | 'graveyard') => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Plains', 'Plains'], ...(zone === 'hand' ? { hand: ['Test Ember Study'] } : { graveyard: ['Test Ember Study'] }), library: ['Test Costly Tome', 'Test Costly Tome'] } });
    return s;
  };
  const resolved = (zone: 'hand' | 'graveyard') => {
    const s = setup(zone);
    return resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ember Study', zone, 'p1'), ...(zone === 'graveyard' ? { method: 'flashback' } : {}) })));
  };
  it('is automated', () => { expect(full(STUDY)).toBe(true); });
  it('cast from the hand: the exiled {5} sorcery can be cast only by paying its mana cost (two lands: not castable)', () => {
    const s = resolved('hand');
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Costly Tome').length).toBe(2);
    expect(applyAction(s, { type: 'cast', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Costly Tome')! }).error).toBeDefined();
  });
  it('cast with flashback from the graveyard: the exiled cards can be cast without paying (no mana is spent)', () => {
    const s = resolved('graveyard');
    const tome = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Costly Tome')!;
    const opts = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && (a.action as { card?: string }).card === tome);
    expect(opts.length).toBeGreaterThanOrEqual(1); // the free cast is offered
    const next = resolveAll(drive(act(s, opts[0]!.action)));
    expect(lifeOf(next, 'p1')).toBe(25);
    expect(next.zones.battlefield.filter((id) => next.objects[id]!.defId === 'Plains' && next.objects[id]!.tapped).length).toBe(1); // only the flashback cost {1} was paid: the tome cost nothing
  });
});

describe('CR 118.9, 601.2b: cast from a graveyard the exiled cards may still be cast by paying their mana cost (ruling 2019-08-23)', () => {
  const STUDY = card('Test Ember Study', 'Sorcery', 'Exile the top two cards of your library. Until the end of your next turn, you may play those cards. If ~ was cast from a graveyard, you may play cards this way without paying their mana costs.\nFlashback {1}', '{1}');
  const TONIC = card('Test Cheap Tonic', 'Sorcery', 'You gain 3 life.', '{1}');
  it('with the flashback cast, a {1} sorcery can be cast for {1} or for nothing: two options', () => {
    const s0 = scenario([], { defs: [STUDY, TONIC], p1: { battlefield: ['Plains', 'Plains'], graveyard: ['Test Ember Study'], library: ['Test Cheap Tonic', 'Test Cheap Tonic'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ember Study', 'graveyard', 'p1'), method: 'flashback' })));
    const tonic = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Cheap Tonic')!;
    const opts = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && (a.action as { card?: string }).card === tonic);
    expect(opts.length).toBe(2);
  });
});

describe('CR 118.9, 118.1, 119.7: "If you control a Forest, rather than pay this spell\'s mana cost, you may have an opponent gain 3 life." (Invigorate)', () => {
  const GIFT = card('Test Verdant Gift', 'Instant', 'If you control a Forest, rather than pay this spell\'s mana cost, you may have an opponent gain 3 life.\nYou gain 1 life.', '{3}{G}');
  const BAN = card('Test Life Ban', 'Enchantment', 'Players can\'t gain life.', '{1}');
  const DEFS = [GIFT, BAN];
  const setup = (battlefield: string[], p2: string[] = []) => scenario(['Forest'], { defs: DEFS, p1: { battlefield, hand: ['Test Verdant Gift'] }, p2: { battlefield: p2 } });
  it('is automated', () => { expect(full(GIFT)).toBe(true); });
  it('with a Forest and no mana: cast for the alternative cost, the opponent gains 3 life (23) and you gain 1', () => {
    const s = setup(['Forest']);
    expect(canCastFrom(s, 'Test Verdant Gift', 'hand', 'alternative')).toBe(true);
    const done = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Verdant Gift', 'hand', 'p1'), method: 'alternative' })));
    expect(lifeOf(done, 'p2')).toBe(23);
    expect(lifeOf(done, 'p1')).toBe(21);
  });
  it('without a Forest the alternative cost is not available', () => {
    expect(canCastFrom(setup(['Plains']), 'Test Verdant Gift', 'hand', 'alternative')).toBe(false);
  });
  it('CR 118.1, 601.2b: in a three-player game the payer chooses WHICH opponent gains the 3 life (only that one gains it)', () => {
    const s0 = tweak(setup(['Forest']), (x) => { x.players.push({ ...structuredClone(x.players[1]!), id: 'p3', name: 'Carol' }); x.zones.library['p3'] = []; x.zones.hand['p3'] = []; x.zones.graveyard['p3'] = []; });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Verdant Gift', 'hand', 'p1'), method: 'alternative' });
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) {
      const d = s.pending;
      if (d.kind === 'chooseOption') {
        expect(d.player).toBe('p1');
        expect(d.options.map((o) => o.id).sort()).toEqual(['p2', 'p3']);
        s = answer(s, { kind: 'chooseOption', ids: ['p3'] });
      } else s = drive(s, { targets: [[obj(find(s, 'Test Verdant Gift', 'stack', 'p1'))]] });
    }
    expect(lifeOf(s, 'p3')).toBe(23);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('CR 119.7: when no opponent can gain life the cost cannot be paid', () => {
    const s = setup(['Forest', 'Test Life Ban']);
    expect(canCastFrom(s, 'Test Verdant Gift', 'hand', 'alternative')).toBe(false);
  });
});

describe('CR 707.10c, 115.1, 601.2c: "copy that spell for each other creature you control that the spell could target. Each copy targets a different one of those creatures." (Zada, Hedron Grinder)', () => {
  const ZADA = card('Test Hedron Goblin', 'Creature — Goblin', 'Whenever you cast an instant or sorcery spell that targets only ~, copy that spell for each other creature you control that the spell could target. Each copy targets a different one of those creatures.', '{1}', ['3', '9']);
  const FOX = card('Test Sprout Fox', 'Creature — Fox', '', '{1}', ['1', '1']);
  const OWL = card('Test Sprout Owl', 'Creature — Bird', '', '{1}', ['1', '1']);
  const WARDED = card('Test Red Ward', 'Creature — Wall', 'Protection from red', '{1}', ['1', '1']);
  const FOE = card('Test Foe Bear', 'Creature — Bear', '', '{1}', ['1', '1']);
  const SPARK = card('Test Ember Spark', 'Instant', 'Test Ember Spark deals 1 damage to target creature.', '{R}', undefined, ['R']);
  const DEFS = [ZADA, FOX, OWL, WARDED, FOE, SPARK];
  const setup = () => scenario(['Mountain'], { defs: DEFS, p1: { battlefield: ['Mountain', 'Test Hedron Goblin', 'Test Sprout Fox', 'Test Sprout Owl', 'Test Red Ward'], hand: ['Test Ember Spark'] }, p2: { battlefield: ['Test Foe Bear'] } });
  const zap = (s: GameState, at: string, zone: 'battlefield' = 'battlefield', owner: 'p1' | 'p2' = 'p1') =>
    resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ember Spark', 'hand', 'p1') }), { targets: [[obj(find(s, at, zone, owner))]] }));
  const alive = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.defs[s.objects[id]!.defId]!.name === name && s.objects[id]!.controller === 'p1');
  const damage = (s: GameState, name: string, owner: 'p1' | 'p2' = 'p1'): number => s.objects[find(s, name, 'battlefield', owner)]!.damage;
  it('is automated', () => { expect(full(ZADA)).toBe(true); });
  it('the spell targets only the goblin: each other creature you control that could be targeted gets one copy (1 damage to the fox and to the owl); the goblin takes the original', () => {
    const s = zap(setup(), 'Test Hedron Goblin');
    expect(damage(s, 'Test Hedron Goblin')).toBe(1);
    expect(alive(s, 'Test Sprout Fox')).toBe(false); // 1 damage kills a 1/1
    expect(alive(s, 'Test Sprout Owl')).toBe(false);
  });
  it('a creature the spell could not target (protection from red) is ignored; so is the opponent\'s creature', () => {
    const s = zap(setup(), 'Test Hedron Goblin');
    expect(damage(s, 'Test Red Ward')).toBe(0);
    expect(damage(s, 'Test Foe Bear', 'p2')).toBe(0);
  });
  it('the trigger does not happen for a spell that targets another creature', () => {
    const s = zap(setup(), 'Test Sprout Fox');
    expect(damage(s, 'Test Sprout Owl')).toBe(0);
    expect(damage(s, 'Test Hedron Goblin')).toBe(0);
  });
  it('the copies are not cast: the number of spells cast this turn is 1', () => {
    const s = zap(setup(), 'Test Hedron Goblin');
    expect(s.players.find((p) => p.id === 'p1')!.turnStats.spellsCast).toBe(1);
  });
});

describe('CR 608.2g, 118.9: "you may cast an instant or sorcery spell with mana value 2 or less from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead." (Sword of Once and Future)', () => {
  const STUDY = card('Test Grave Study', 'Sorcery', 'You gain 1 life. Then you may cast an instant or sorcery spell with mana value 2 or less from your graveyard without paying its mana cost. If that spell would be put into your graveyard, exile it instead.', '{1}');
  const BOLT = card('Test Pebble Bolt', 'Instant', 'Test Pebble Bolt deals 2 damage to any target.', '{1}');
  const BLAST = card('Test Big Blast', 'Instant', 'Test Big Blast deals 5 damage to any target.', '{3}');
  const DEFS = [STUDY, BOLT, BLAST];
  const setup = () => scenario([], { defs: DEFS, p1: { battlefield: ['Plains'], hand: ['Test Grave Study'], graveyard: ['Test Pebble Bolt', 'Test Big Blast'] } });
  const run = (s: GameState, script: Parameters<typeof drive>[1]) => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Grave Study', 'hand', 'p1') })), script);
  it('is automated', () => { expect(full(STUDY)).toBe(true); });
  it('only the mana value 2 or less instant is offered; cast free it deals 2 damage and is exiled afterwards (not put into the graveyard); the big spell stays', () => {
    const s0 = setup();
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Grave Study', 'hand', 'p1') }));
    s = drive(act(s, { type: 'pass', player: 'p1' }), {});
    // the resolution asks which spell to cast: only the bolt is a legal choice
    s = act(s, { type: 'pass', player: 'p2' });
    expect(s.pending?.kind).toBe('chooseObjects');
    const d = s.pending as { options: string[] };
    expect(d.options.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Test Pebble Bolt']);
    s = resolveAll(drive(s, { objects: [d.options], targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Pebble Bolt')).toBe(true);
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Big Blast')).toBe(true);
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Pebble Bolt')).toBe(false);
  });
  it('declining (choosing nothing) casts nothing', () => {
    const s = run(setup(), { objects: [[]] });
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Pebble Bolt')).toBe(true);
  });
});

describe('CR 608.2g, 608.2d, 305.9: "You may cast any number of spells from your hand without paying their mana costs." (Jin-Gitaxias // The Great Synthesis)', () => {
  const SYNTH = card('Test Hand Burst', 'Sorcery', 'You may cast any number of spells from your hand without paying their mana costs.', '{1}');
  const BOLT = card('Test Pebble Bolt', 'Instant', 'Test Pebble Bolt deals 2 damage to any target.', '{9}');
  const DEFS = [SYNTH, BOLT];
  const setup = () => scenario([], { defs: DEFS, p1: { battlefield: ['Plains'], hand: ['Test Hand Burst', 'Test Pebble Bolt', 'Test Pebble Bolt', 'Plains'] } });
  const run = (s: GameState, script: Parameters<typeof drive>[1]) => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hand Burst', 'hand', 'p1') })), script);
  it('is automated', () => { expect(full(SYNTH)).toBe(true); });
  it('two {9} spells are cast free in one resolution (4 damage); the land card in the hand is never offered or played', () => {
    const s0 = setup();
    const bolts = s0.zones.hand['p1']!.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Pebble Bolt');
    const p2 = { kind: 'player' as const, id: 'p2' };
    const s = run(s0, { objects: [bolts], targets: [[p2], [p2]] });
    expect(lifeOf(s, 'p2')).toBe(16);
    expect(s.zones.hand['p1']!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains')).toBe(true);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length).toBe(1);
  });
  it('choosing one of the two casts one; choosing none casts none', () => {
    const s0 = setup();
    const bolts = s0.zones.hand['p1']!.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Pebble Bolt');
    expect(lifeOf(run(s0, { objects: [[bolts[0]!]], targets: [[{ kind: 'player', id: 'p2' }]] }), 'p2')).toBe(18);
    expect(lifeOf(run(s0, { objects: [[]] }), 'p2')).toBe(20);
  });
});

describe('CR 614.1a, 707.10c: Zada\'s copies with "instead copy it that many times plus an additional time" (Twinning Staff)', () => {
  const ZADA = card('Test Hedron Goblin', 'Creature — Goblin', 'Whenever you cast an instant or sorcery spell that targets only ~, copy that spell for each other creature you control that the spell could target. Each copy targets a different one of those creatures.', '{1}', ['3', '9']);
  const FOX = card('Test Sprout Fox', 'Creature — Fox', '', '{1}', ['1', '1']);
  const ROD = card('Test Duplicating Rod', 'Artifact', 'If you would copy a spell one or more times, instead copy it that many times plus an additional time. You may choose new targets for the additional copy.', '{1}');
  const SPARK = card('Test Ember Spark', 'Instant', 'Test Ember Spark deals 1 damage to target creature.', '{R}', undefined, ['R']);
  it('one other creature and a rod: one copy for the fox and one additional copy (which may keep its target): the goblin takes 3 damage in all', () => {
    const s0 = scenario(['Mountain'], { defs: [ZADA, FOX, ROD, SPARK], p1: { battlefield: ['Mountain', 'Test Hedron Goblin', 'Test Sprout Fox', 'Test Duplicating Rod'], hand: ['Test Ember Spark'] } });
    const s = resolveAll(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ember Spark', 'hand', 'p1') }), { targets: [[obj(find(s0, 'Test Hedron Goblin', 'battlefield', 'p1'))]] }), { yes: [false] });
    expect(s.objects[find(s, 'Test Hedron Goblin', 'battlefield', 'p1')]!.damage).toBe(2);
  });
});

