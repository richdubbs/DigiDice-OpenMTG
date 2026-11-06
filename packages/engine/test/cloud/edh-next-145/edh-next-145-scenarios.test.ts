/**
 * Round edh-next-145 (must-finish round, group "other"): the behaviour it added, played through the engine with synthetic cards (invented names, the printed wordings of the real
 * cards), compiled by the game's default compiler, in four-player games.
 *
 *   CR 611.2c, 608.2h, 613.4c, 702.1   Akroma, Vision of Ixidor: "At the beginning of each combat, until end of turn, each other creature you control gets +1/+1 if it has flying, +1/+1 if
 *                                       it has first strike, and so on for double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, protection, reach, trample,
 *                                       vigilance, and partner." (rulings 2020-11-10: one bonus per listed keyword, variants and repeats once; partner and "partner with" only; the set
 *                                       and the sizes are fixed as the ability resolves)
 *   CR 603.7, 603.7c, 120.3, 608.2h     Arcbond: "Choose target creature. Whenever that creature is dealt damage this turn, it deals that much damage to each other creature and each player."
 *                                       (rulings 2014-11-24: the creature is the source; it triggers even on lethal damage; the new damage is not combat damage)
 *   CR 603.12, 608.2h, 613.4c           Inferno of the Star Mounts: "{R}: Inferno of the Star Mounts gets +1/+0 until end of turn. When its power becomes 20 this way, it deals 20 damage
 *                                       to any target." (rulings 2021-07-23: the target is chosen only when it triggers; only a power that BECOMES exactly 20 through this ability; it can
 *                                       trigger again if the power goes down and back up)
 *   CR 614.15, 608.2d, 701.21a, 601.2h   Mythos of Snapdax: "Each player chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control,
 *                                       then sacrifices the rest. If {B}{R} was spent to cast this spell, you choose the permanents for each player instead." (rulings 2020-04-17: a permanent
 *                                       of several types may be kept for each; the choices must be legal; lands are never chosen nor sacrificed)
 *   CR 601.2i, 611.2c, 101.2            Irencrag Feat: "Add seven {R}. You can cast only one more spell this turn." (rulings 2019-10-04: spells cast before do not matter; abilities and
 *                                       land plays are not stopped)
 *   CR 603.12, 701.21a, 608.2c, 608.2d  Ravenous Rotbelly: "When this creature enters, you may sacrifice up to three Zombies. When you sacrifice one or more Zombies this way, each opponent
 *                                       sacrifices that many creatures of their choice." (rulings 2021-09-24: a reflexive trigger players may respond to; each opponent chooses, then all
 *                                       are sacrificed at once)
 *   CR 205.3m, 602.2b, 608.2c           Cryptic Gateway: "Tap two untapped creatures you control: You may put a creature card from your hand that shares a creature type with each creature
 *                                       tapped this way onto the battlefield." (ruling 2022-12-08: the two need not share a type; the card must share one with EACH of them)
 *   CR 120.6, 704.5g, 702.19b, 120.10    Zilortha, Strength Incarnate: "Lethal damage dealt to creatures you control is determined by their power rather than their toughness." (rulings
 *                                       2020-04-17: every check of lethal damage, trample assignment and excess damage included; 0 power needs 1 damage; 0 toughness still dies; damage
 *                                       already marked becomes lethal when Zilortha arrives)
 *   CR 301.5a, 201.2, 608.2d, 608.2h,    Hand of Vecna: "At the beginning of combat on your turn, equipped creature or a creature you control named Vecna gets +X/+X until end of turn, where X
 *   118.3, 702.6a                       is the number of cards in your hand. / Equip--Pay 1 life for each card in your hand. / Equip {2}" (rulings 2021-07-23: you choose the creature as it
 *                                       resolves; X is fixed then)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId } from '../../../src/index';
import { mpScenario, passUntil } from '../../m12/rules/helpers';
import { card, cast, full, named, pt, settle } from '../cmd3/helpers';
import { act, answer } from '../../m3/scenario';
import { activatedAbilities } from '../../../src/rules/abilities';
import { lifeOf } from '../../m12/rules/helpers';

describe('CR 611.2c, 608.2h, 702.1: Akroma, Vision of Ixidor ("+1/+1 if it has flying, +1/+1 if it has first strike, and so on for ...")', () => {
  const AKROMA = card('Test Ixidor Vision', 'Legendary Creature — Angel', 'Flying, first strike, vigilance, trample\nAt the beginning of each combat, until end of turn, each other creature you control gets +1/+1 if it has flying, +1/+1 if it has first strike, and so on for double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, protection, reach, trample, vigilance, and partner.\nPartner', ['6', '6']);
  const FLIER = card('Test Swift Hawk', 'Creature — Bird', 'Flying, first strike\nLifelink', ['1', '1']);
  const WARDED = card('Test Twice Warded Knight', 'Creature — Knight', 'Protection from black\nProtection from red', ['2', '2']);
  const PARTNERED = card('Test Bonded Scout', 'Legendary Creature — Human Scout', 'Partner with Test Bonded Guide\nFlash', ['1', '1']);
  const PLAIN = card('Test Plain Soldier', 'Creature — Human Soldier', 'Choose a Background', ['2', '2']);
  const THEIRS = card('Test Foreign Hawk', 'Creature — Bird', 'Flying', ['1', '1']);
  const SILENCE = card('Test Sudden Silence', 'Instant', 'Target creature loses all abilities until end of turn.');
  const defs = [AKROMA, FLIER, WARDED, PARTNERED, PLAIN, THEIRS, SILENCE];

  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Sudden Silence'], battlefield: ['Test Ixidor Vision', 'Test Swift Hawk', 'Test Twice Warded Knight', 'Test Bonded Scout', 'Test Plain Soldier'] }, p2: { battlefield: ['Test Foreign Hawk'] } } });
  /** Pass priority into the beginning of combat and let the trigger resolve. */
  const toCombat = (s0: GameState): GameState => {
    let s = passUntil(s0, (x) => x.turn.step === 'beginCombat' && x.zones.stack.length > 0, 'the trigger');
    s = passUntil(s, (x) => x.zones.stack.length === 0, 'its resolution');
    return s;
  };
  const one = (s: GameState, defId: string): ObjectId => named(s, defId)[0]!;

  it('compiles full', () => {
    expect(full(AKROMA)).toBe(true);
    expect(JSON.stringify(AKROMA.faces[0]!.abilities)).toContain('"q":"keywordsHad"');
  });

  it('gives each other creature you control +1/+1 per listed keyword it has: protection counts once, "partner with" counts, a Background choice does not', () => {
    const s = toCombat(start());
    expect(pt(s, one(s, FLIER.id))).toBe('4/4'); // flying, first strike, lifelink
    expect(pt(s, one(s, WARDED.id))).toBe('3/3'); // protection twice: once
    expect(pt(s, one(s, PARTNERED.id))).toBe('2/2'); // "partner with" (flash is not listed)
    expect(pt(s, one(s, PLAIN.id))).toBe('2/2'); // "choose a Background" is not partner
  });

  it('negative: not Akroma herself (other) and not an opponent\'s creature', () => {
    const s = toCombat(start());
    expect(pt(s, one(s, AKROMA.id))).toBe('6/6');
    expect(pt(s, one(s, THEIRS.id))).toBe('1/1');
  });

  it('the bonus is fixed as it resolves: a keyword lost afterwards does not shrink it, and it ends with the turn', () => {
    let s = toCombat(start());
    const hawk = one(s, FLIER.id);
    // after the resolution the hawk loses all its abilities until end of turn (a later layer 6 effect): its bonus was fixed at +3/+3 and stays
    s = cast(s, 'Test Sudden Silence', { targets: [{ kind: 'object', id: hawk }] });
    s = passUntil(s, (x) => x.zones.stack.length === 0, 'the instant');
    expect(getChars(s, hawk)!.keywords.length).toBe(0);
    expect(pt(s, hawk)).toBe('4/4');
    s = passUntil(s, (x) => x.turn.activePlayer !== 'p1', 'the next turn', 600);
    expect(pt(s, one(s, FLIER.id))).toBe('1/1');
  });

  it('triggers at the beginning of each combat, an opponent\'s too', () => {
    let s = toCombat(start());
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'beginCombat' && x.zones.stack.length > 0, 'the opponent\'s combat', 600);
    s = passUntil(s, (x) => x.zones.stack.length === 0, 'its resolution');
    expect(pt(s, one(s, FLIER.id))).toBe('4/4');
    expect(pt(s, one(s, THEIRS.id))).toBe('1/1');
  });
});

describe('CR 603.7, 603.7c, 120.3: Arcbond ("Whenever that creature is dealt damage this turn, it deals that much damage to each other creature and each player.")', () => {
  const ARC = card('Test Arc Tether', 'Instant', 'Choose target creature. Whenever that creature is dealt damage this turn, it deals that much damage to each other creature and each player.');
  const BOLT = card('Test Spark Jab', 'Instant', 'Test Spark Jab deals 2 damage to any target.');
  const BIG = card('Test Heavy Jab', 'Instant', 'Test Heavy Jab deals 7 damage to target creature.');
  const OGRE = card('Test Bonded Ogre', 'Creature — Ogre', '', ['3', '3']);
  const BEAR = card('Test Near Bear', 'Creature — Bear', '', ['2', '3']);
  const WALL = card('Test Far Wall', 'Creature — Wall', 'Defender', ['0', '8']);
  const defs = [ARC, BOLT, BIG, OGRE, BEAR, WALL];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Arc Tether', 'Test Spark Jab', 'Test Heavy Jab'], battlefield: ['Test Bonded Ogre', 'Test Near Bear'] }, p3: { battlefield: ['Test Far Wall'] } } });
  const dmg = (s: GameState, id: ObjectId): number => s.objects[id]!.damage ?? 0;
  const resolve = (s: GameState): GameState => passUntil(s, (x) => x.zones.stack.length === 0, 'the stack');

  it('compiles full', () => {
    expect(full(ARC)).toBe(true);
  });

  it('the creature deals the damage it was dealt to each other creature and each player (its controller too), not to itself', () => {
    let s = start();
    const ogre = named(s, OGRE.id)[0]!;
    s = resolve(cast(s, 'Test Arc Tether', { targets: [{ kind: 'object', id: ogre }] }));
    s = resolve(cast(s, 'Test Spark Jab', { targets: [{ kind: 'object', id: ogre }] }));
    expect(dmg(s, ogre)).toBe(2);
    expect(dmg(s, named(s, BEAR.id)[0]!)).toBe(2);
    expect(dmg(s, named(s, WALL.id)[0]!)).toBe(2);
    for (const p of ['p1', 'p2', 'p3', 'p4'] as const) expect(lifeOf(s, p), p).toBe(18);
    expect(s.log.some((l) => /Test Bonded Ogre deals 2 damage/.test(l.text))).toBe(true); // the creature is the source (ruling)
  });

  it('lethal damage still triggers: the creature, gone, deals that much (as it last existed)', () => {
    let s = start();
    const ogre = named(s, OGRE.id)[0]!;
    s = resolve(cast(s, 'Test Arc Tether', { targets: [{ kind: 'object', id: ogre }] }));
    s = resolve(cast(s, 'Test Heavy Jab', { targets: [{ kind: 'object', id: ogre }] }));
    expect(named(s, OGRE.id)).toHaveLength(0);
    expect(named(s, BEAR.id)).toHaveLength(0); // 7 damage to a 2/3
    expect(dmg(s, named(s, WALL.id)[0]!)).toBe(7);
    for (const p of ['p1', 'p2', 'p3', 'p4'] as const) expect(lifeOf(s, p), p).toBe(13);
  });

  it('negative: damage to another creature does nothing, and the trigger ends with the turn', () => {
    let s = start();
    const ogre = named(s, OGRE.id)[0]!;
    const bear = named(s, BEAR.id)[0]!;
    s = resolve(cast(s, 'Test Arc Tether', { targets: [{ kind: 'object', id: ogre }] }));
    s = resolve(cast(s, 'Test Spark Jab', { targets: [{ kind: 'object', id: bear }] }));
    expect(dmg(s, ogre)).toBe(0);
    expect(lifeOf(s, 'p2')).toBe(20);
    // the next turn: damage to the creature no longer triggers
    const t = mpScenario({ defs, zones: { p1: { hand: ['Test Arc Tether'], battlefield: ['Test Bonded Ogre', 'Test Near Bear'] }, p2: { hand: ['Test Spark Jab'] } } });
    let u = resolve(cast(t, 'Test Arc Tether', { targets: [{ kind: 'object', id: named(t, OGRE.id)[0]! }] }));
    u = passUntil(u, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1', 'the next turn', 600);
    u = resolve(cast(u, 'Test Spark Jab', { targets: [{ kind: 'object', id: named(u, OGRE.id)[0]! }] }, 'p2'));
    expect(lifeOf(u, 'p3')).toBe(20);
    expect(dmg(u, named(u, BEAR.id)[0]!)).toBe(0);
  });
});

describe('CR 603.12, 608.2h, 613.4c: Inferno of the Star Mounts ("When its power becomes 20 this way, it deals 20 damage to any target.")', () => {
  const INFERNO = card('Test Starmount Blaze', 'Legendary Creature — Dragon God', "This spell can't be countered.\nFlying, haste\n{R}: Test Starmount Blaze gets +1/+0 until end of turn. When its power becomes 20 this way, it deals 20 damage to any target.", ['6', '6'], '{4}{R}{R}');
  const SHRINK = card('Test Small Doubt', 'Instant', 'Target creature gets -1/-0 until end of turn.');
  const GROW = card('Test Sudden Might', 'Instant', 'Target creature gets +14/+0 until end of turn.');
  const defs = [INFERNO, SHRINK, GROW];
  const start = (): GameState => mpScenario({ defs, cards: ['Mountain'], zones: { p1: { hand: ['Test Small Doubt', 'Test Sudden Might'], battlefield: ['Test Starmount Blaze', ...Array(24).fill('Mountain')] } } });
  const blaze = (s: GameState): ObjectId => named(s, INFERNO.id)[0]!;
  const power = (s: GameState): number => Number(getChars(s, blaze(s))!.power);
  /** Activate the pump once (paying {R}) and resolve the stack, answering the reflexive trigger's target with p2. */
  const pump = (s0: GameState, seen?: { targets: number }, who: 'p2' | 'p3' = 'p2'): GameState => {
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: blaze(s0), ability: activatedAbilities(s0, s0.objects[blaze(s0)]!)[0]!.key } as never));
    for (let g = 0; g < 60; g++) {
      if (s.pending?.kind === 'chooseTargets') { if (seen) seen.targets++; s = settle(s, { targets: [{ kind: 'player', id: who }] }); continue; }
      if (s.pending?.kind !== 'priority') { s = settle(s); continue; }
      if (s.zones.stack.length === 0) break;
      s = act(s, { type: 'pass', player: s.pending.player });
    }
    return s;
  };

  it('compiles full', () => {
    expect(full(INFERNO)).toBe(true);
  });

  it('the fourteenth activation (19 -> 20) deals 20 damage to the target chosen then; the earlier ones ask for no target', () => {
    let s = start();
    const seen = { targets: 0 };
    for (let k = 0; k < 13; k++) s = pump(s, seen);
    expect(power(s)).toBe(19);
    expect(seen.targets).toBe(0);
    expect(lifeOf(s, 'p2')).toBe(20);
    s = pump(s, seen);
    expect(power(s)).toBe(20);
    expect(seen.targets).toBe(1);
    expect(lifeOf(s, 'p2')).toBe(0);
  });

  it('negative: 20 -> 21 does not trigger; a power that became 20 another way (a spell) does not either', () => {
    let s = start();
    for (let k = 0; k < 14; k++) s = pump(s);
    expect(lifeOf(s, 'p2')).toBe(0);
    const t0 = start();
    let t = t0;
    // 6 + 14 = 20 through a spell: nothing; then this ability takes it to 21: nothing
    t = passUntil(cast(t, 'Test Sudden Might', { targets: [{ kind: 'object', id: blaze(t) }] }), (x) => x.zones.stack.length === 0, 'the spell');
    expect(power(t)).toBe(20);
    const seen = { targets: 0 };
    t = pump(t, seen);
    expect(power(t)).toBe(21);
    expect(seen.targets).toBe(0);
    for (const p of ['p2', 'p3', 'p4'] as const) expect(lifeOf(t, p)).toBe(20);
  });

  it('it triggers again when the power goes down and back up to 20 through it (ruling)', () => {
    let s = start();
    const seen = { targets: 0 };
    for (let k = 0; k < 14; k++) s = pump(s, seen);
    expect(seen.targets).toBe(1);
    s = passUntil(cast(s, 'Test Small Doubt', { targets: [{ kind: 'object', id: blaze(s) }] }), (x) => x.zones.stack.length === 0, 'the spell');
    expect(power(s)).toBe(19);
    s = pump(s, seen, 'p3');
    expect(seen.targets).toBe(2);
    expect(lifeOf(s, 'p3')).toBe(0);
  });
});

describe('CR 614.15, 608.2d, 701.21a: Mythos of Snapdax ("If {B}{R} was spent to cast this spell, you choose the permanents for each player instead.")', () => {
  const MYTHOS = card('Test Snapping Myth', 'Sorcery', 'Each player chooses an artifact, a creature, an enchantment, and a planeswalker from among the nonland permanents they control, then sacrifices the rest. If {B}{R} was spent to cast this spell, you choose the permanents for each player instead.', undefined, '{2}{W}');
  const A = card('Test Myth Wolf', 'Creature — Wolf', '', ['2', '2']);
  const B = card('Test Myth Boar', 'Creature — Boar', '', ['3', '3']);
  const GOLEM = card('Test Myth Golem', 'Artifact Creature — Golem', '', ['1', '1']);
  const VAULT = card('Test Myth Vault', 'Artifact Land', '{T}: Add {C}.');
  const defs = [MYTHOS, A, B, GOLEM, VAULT];
  const board = ['Test Myth Wolf', 'Test Myth Boar', 'Test Myth Golem', 'Test Myth Vault'];
  const start = (lands: string[]): GameState => mpScenario({ defs, cards: ['Swamp', 'Mountain'], zones: { p1: { hand: ['Test Snapping Myth'], battlefield: lands }, p2: { battlefield: board }, p3: { battlefield: board } } });
  /** Cast it and answer every choice by keeping the LAST option offered; returns the state and who was asked. */
  const play = (s0: GameState): { s: GameState; askedBy: string[] } => {
    const askedBy: string[] = [];
    let s = act(s0, { type: 'cast', player: 'p1', card: s0.zones.hand['p1']![0]! } as never);
    for (let g = 0; g < 80; g++) {
      const d = s.pending;
      if (d === null || d === undefined) break;
      if (d.kind === 'payCost') { s = settle(s); continue; }
      if (d.kind === 'chooseObjects') { const o = (d as unknown as { options: ObjectId[]; min: number }); askedBy.push(d.player); s = answer(s, { kind: 'chooseObjects', ids: o.options.slice(-o.min) }); continue; }
      if (d.kind !== 'priority') { s = settle(s); continue; }
      if (s.zones.stack.length === 0) break;
      s = act(s, { type: 'pass', player: d.player });
    }
    return { s, askedBy };
  };
  const kinds = (s: GameState, p: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name).sort();

  it('compiles full', () => {
    expect(full(MYTHOS)).toBe(true);
  });

  it('without {B}{R}: each player chooses for themselves; the artifact land stays; each keeps one creature and the artifact (the Golem counts for both)', () => {
    const { s, askedBy } = play(start(['Plains', 'Plains', 'Plains']));
    expect(new Set(askedBy)).toEqual(new Set(['p2', 'p3']));
    for (const p of ['p2', 'p3']) {
      const left = kinds(s, p);
      expect(left).toContain('Test Myth Vault');
      expect(left.filter((n) => n !== 'Test Myth Vault').length).toBeLessThanOrEqual(2);
    }
  });

  it('with {B}{R} spent: you choose the permanents for each player', () => {
    const { s, askedBy } = play(start(['Swamp', 'Mountain', 'Plains']));
    expect(askedBy.length).toBeGreaterThan(0);
    expect(new Set(askedBy)).toEqual(new Set(['p1']));
    for (const p of ['p2', 'p3']) expect(kinds(s, p)).toContain('Test Myth Vault');
  });

  it('negative: {B} alone (no {R}) is not {B}{R}: each player still chooses', () => {
    const { askedBy } = play(start(['Swamp', 'Plains', 'Plains']));
    expect(new Set(askedBy)).toEqual(new Set(['p2', 'p3']));
  });
});

describe('CR 601.2i, 611.2c: Irencrag Feat ("You can cast only one more spell this turn.")', () => {
  const FEAT = card('Test Forge Feat', 'Sorcery', 'Add seven {R}. You can cast only one more spell this turn.', undefined, '{1}{R}{R}');
  const ZAP = card('Test Tiny Zap', 'Instant', 'Draw a card.', undefined, '{R}');
  const ZAP2 = card('Test Tiny Spark', 'Instant', 'Draw a card.', undefined, '{R}');
  const ZAP3 = card('Test Tiny Flare', 'Instant', 'Draw a card.', undefined, '{R}');
  const TAPPER = card('Test Feat Tinkerer', 'Artifact', '{T}: Draw a card.');
  const defs = [FEAT, ZAP, ZAP2, ZAP3, TAPPER];
  const start = (): GameState => mpScenario({ defs, cards: ['Mountain'], zones: { p1: { hand: ['Test Tiny Zap', 'Test Forge Feat', 'Test Tiny Spark', 'Test Tiny Flare', 'Mountain'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Test Feat Tinkerer'] } } });
  const resolve = (s: GameState): GameState => passUntil(s, (x) => x.zones.stack.length === 0, 'the stack');
  const tryCast = (s: GameState, name: string): GameState | Error => { try { return cast(s, name); } catch (e) { return e as Error; } };

  it('compiles full', () => {
    expect(full(FEAT)).toBe(true);
  });

  it('a spell cast before does not count: after the Feat, one more spell, then no more; the mana is there', () => {
    let s = resolve(cast(start(), 'Test Tiny Zap')); // a spell before the Feat
    s = resolve(cast(s, 'Test Forge Feat'));
    expect(s.players.find((p) => p.id === 'p1')!.manaPool.length).toBe(7);
    const one = tryCast(s, 'Test Tiny Spark');
    expect(one).not.toBeInstanceOf(Error);
    s = resolve(one as GameState);
    const two = tryCast(s, 'Test Tiny Flare');
    expect(two).toBeInstanceOf(Error);
  });

  it('negative: abilities and land plays are not stopped, and the next turn is free again', () => {
    let s = resolve(cast(start(), 'Test Forge Feat'));
    s = resolve(cast(s, 'Test Tiny Spark'));
    expect(tryCast(s, 'Test Tiny Flare')).toBeInstanceOf(Error);
    const tinker = named(s, TAPPER.id)[0]!;
    s = resolve(settle(act(s, { type: 'activate', player: 'p1', source: tinker, ability: activatedAbilities(s, s.objects[tinker]!)[0]!.key } as never)));
    s = act(s, { type: 'playLand', player: 'p1', card: s.zones.hand['p1']!.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Mountain')! } as never);
    expect(s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Mountain').length).toBe(5);
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.player === 'p1', 'the next turn', 600);
    expect(tryCast(s, 'Test Tiny Flare')).not.toBeInstanceOf(Error); // p1 may cast an instant on p2's turn
  });
});

describe('CR 603.12, 701.21a, 608.2c: Ravenous Rotbelly ("you may sacrifice up to three Zombies. When you sacrifice one or more Zombies this way, ...")', () => {
  const ROT = card('Test Gorging Ghoul', 'Creature — Zombie Horror', 'When this creature enters, you may sacrifice up to three Zombies. When you sacrifice one or more Zombies this way, each opponent sacrifices that many creatures of their choice.', ['1', '5']);
  const ZOMB = card('Test Shambling Dead', 'Creature — Zombie', '', ['2', '2']);
  const ELF = card('Test Rot Elf', 'Creature — Elf', '', ['1', '1']);
  const defs = [ROT, ZOMB, ELF];
  const four = ['Test Rot Elf', 'Test Rot Elf', 'Test Rot Elf', 'Test Rot Elf'];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Gorging Ghoul'], battlefield: ['Test Shambling Dead', 'Test Shambling Dead', 'Test Shambling Dead', 'Test Shambling Dead', 'Test Rot Elf'] }, p2: { battlefield: four }, p3: { battlefield: four }, p4: { battlefield: ['Test Rot Elf'] } } });
  const count = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).length;
  /** Cast it; at the "up to three" choice pick `n` Zombies other than itself; answer yes/no to the option; everyone else's choices take the first options. */
  const play = (n: number, yes = true): { s: GameState; maxOffered: number } => {
    let s = cast(start(), 'Test Gorging Ghoul');
    let maxOffered = -1;
    for (let g = 0; g < 200; g++) {
      const d = s.pending;
      if (d === null || d === undefined) break;
      if (d.kind === 'yesNo') { s = answer(s, { kind: 'yesNo', yes }); continue; }
      if (d.kind === 'chooseObjects') {
        const o = d as unknown as { options: ObjectId[]; min: number; max: number };
        if (d.player === 'p1') { maxOffered = o.max; const zs = o.options.filter((id) => s.objects[id]!.defId === ZOMB.id).slice(0, n); s = answer(s, { kind: 'chooseObjects', ids: zs }); }
        else s = answer(s, { kind: 'chooseObjects', ids: o.options.slice(0, o.min) });
        continue;
      }
      if (d.kind !== 'priority') { s = settle(s); continue; }
      if (s.zones.stack.length === 0) break;
      s = act(s, { type: 'pass', player: d.player });
    }
    return { s, maxOffered };
  };

  it('compiles full', () => {
    expect(full(ROT)).toBe(true);
  });

  it('two Zombies sacrificed: each opponent sacrifices two creatures (one who has fewer sacrifices all); at most three are offered', () => {
    const { s, maxOffered } = play(2);
    expect(maxOffered).toBe(3);
    expect(count(s, 'p1')).toBe(4); // 4 Zombies + Elf + itself - 2
    expect(count(s, 'p2')).toBe(2);
    expect(count(s, 'p3')).toBe(2);
    expect(count(s, 'p4')).toBe(0);
  });

  it('negative: declining, or sacrificing no Zombie, makes no opponent sacrifice anything', () => {
    for (const [n, yes] of [[0, true], [2, false]] as const) {
      const { s } = play(n, yes);
      expect(count(s, 'p2'), `${n} ${yes}`).toBe(4);
      expect(count(s, 'p3'), `${n} ${yes}`).toBe(4);
      expect(count(s, 'p1'), `${n} ${yes}`).toBe(6);
    }
  });
});

describe('CR 205.3m, 602.2b, 608.2c: Cryptic Gateway ("a creature card from your hand that shares a creature type with each creature tapped this way")', () => {
  const GATE = card('Test Hidden Portal', 'Artifact', 'Tap two untapped creatures you control: You may put a creature card from your hand that shares a creature type with each creature tapped this way onto the battlefield.');
  const EW = card('Test Elf Sage', 'Creature — Elf Wizard', '', ['1', '1']);
  const HW = card('Test Human Brawler', 'Creature — Human Warrior', '', ['2', '2']);
  const ELFWAR = card('Test Elf Blademaster', 'Creature — Elf Warrior', '', ['4', '4'], '{5}');
  const ELFDRU = card('Test Elf Grower', 'Creature — Elf Druid', '', ['3', '3'], '{5}');
  const SHAPER = card('Test Many Faced', 'Creature — Shapeshifter', 'Changeling', ['5', '5'], '{6}');
  const defs = [GATE, EW, HW, ELFWAR, ELFDRU, SHAPER];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Elf Blademaster', 'Test Elf Grower', 'Test Many Faced'], battlefield: ['Test Hidden Portal', 'Test Elf Sage', 'Test Human Brawler'] } } });
  /** Activate (the two creatures are tapped for the cost) and, at the choice, see what is offered and pick `pick` (a name) if offered. */
  const play = (pick: string | null): { s: GameState; offered: string[] } => {
    const s0 = start();
    const gate = named(s0, GATE.id)[0]!;
    let s = act(s0, { type: 'activate', player: 'p1', source: gate, ability: activatedAbilities(s0, s0.objects[gate]!)[0]!.key } as never);
    let offered: string[] = [];
    for (let g = 0; g < 60; g++) {
      const d = s.pending;
      if (d === null || d === undefined) break;
      if (d.kind === 'chooseObjects' && d.player === 'p1' && (d as unknown as { options: ObjectId[] }).options.every((id) => s.objects[id]!.zone === 'hand')) {
        const o = (d as unknown as { options: ObjectId[] }).options;
        offered = o.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
        s = answer(s, { kind: 'chooseObjects', ids: o.filter((id) => s.defs[s.objects[id]!.defId]!.name === pick) });
        continue;
      }
      if (d.kind === 'yesNo') { s = answer(s, { kind: 'yesNo', yes: true }); continue; }
      if (d.kind !== 'priority') { s = settle(s); continue; }
      if (s.zones.stack.length === 0) break;
      s = act(s, { type: 'pass', player: d.player });
    }
    return { s, offered };
  };

  it('compiles full', () => {
    expect(full(GATE)).toBe(true);
  });

  it('an Elf Warrior shares a type with the Elf Wizard AND the Human Warrior: it may be put onto the battlefield; a changeling too; the tapped two are tapped', () => {
    const { s, offered } = play('Test Elf Blademaster');
    expect(offered).toEqual(['Test Elf Blademaster', 'Test Many Faced']);
    expect(named(s, ELFWAR.id)).toHaveLength(1);
    expect(s.objects[named(s, EW.id)[0]!]!.tapped).toBe(true);
    expect(s.objects[named(s, HW.id)[0]!]!.tapped).toBe(true);
  });

  it('negative: an Elf Druid shares a type with only one of them and is never offered; choosing nothing puts nothing', () => {
    const { s, offered } = play(null);
    expect(offered).not.toContain('Test Elf Grower');
    expect(named(s, ELFDRU.id)).toHaveLength(0);
    expect(named(s, ELFWAR.id)).toHaveLength(0);
  });
});

describe('CR 120.6, 704.5g, 702.19b, 120.10: Zilortha, Strength Incarnate ("Lethal damage dealt to creatures you control is determined by their power rather than their toughness.")', () => {
  const ZIL = card('Test Apex Titan', 'Legendary Creature — Dinosaur', 'Trample\nLethal damage dealt to creatures you control is determined by their power rather than their toughness.', ['7', '3']);
  const WALL = card('Test Thick Hide', 'Creature — Beast', '', ['1', '5']);
  const ZERO = card('Test Nil Wall', 'Creature — Wall', 'Defender', ['0', '4']);
  const SHOCK = card('Test Two Sparks', 'Instant', 'Test Two Sparks deals 2 damage to target creature.');
  const SPILL = card('Test Spill Over', 'Instant', "Test Spill Over deals 4 damage to target creature. Excess damage is dealt to that creature's controller instead.");
  const PING = card('Test One Spark', 'Instant', 'Test One Spark deals 1 damage to target creature.');
  const TRAMPLER = card('Test Stomping Brute', 'Creature — Beast', 'Trample', ['4', '4']);
  const defs = [ZIL, WALL, ZERO, SHOCK, SPILL, PING, TRAMPLER];
  const spells = ['Test Two Sparks', 'Test Spill Over', 'Test One Spark'];
  const start = (withZil = true): GameState => mpScenario({ defs, zones: { p1: { hand: [...spells, ...(withZil ? [] : ['Test Apex Titan'])], battlefield: [...(withZil ? ['Test Apex Titan'] : []), 'Test Thick Hide', 'Test Nil Wall'] }, p2: { battlefield: ['Test Thick Hide', 'Test Stomping Brute'] } } });
  const resolve = (s: GameState): GameState => passUntil(s, (x) => x.zones.stack.length === 0, 'the stack');
  const mine = (s: GameState, defId: string, p = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);
  const zap = (s: GameState, spell: string, id: ObjectId): GameState => resolve(cast(s, spell, { targets: [{ kind: 'object', id }] }));

  it('compiles full', () => {
    expect(full(ZIL)).toBe(true);
  });

  it('2 damage destroys a 1/5 you control (power 1), not an opponent\'s 1/5; without the rule it survives', () => {
    let s = start();
    s = zap(s, 'Test Two Sparks', mine(s, WALL.id)[0]!);
    expect(mine(s, WALL.id)).toHaveLength(0);
    let t = start();
    t = zap(t, 'Test Two Sparks', mine(t, WALL.id, 'p2')[0]!);
    expect(mine(t, WALL.id, 'p2')).toHaveLength(1);
    let u = start(false);
    u = zap(u, 'Test Two Sparks', mine(u, WALL.id)[0]!);
    expect(mine(u, WALL.id)).toHaveLength(1);
  });

  it('a 0-power creature dies only with 1 or more damage; the 7/3 itself survives 4 damage', () => {
    let s = start();
    expect(mine(s, ZERO.id)).toHaveLength(1); // no damage: not destroyed
    s = zap(s, 'Test One Spark', mine(s, ZERO.id)[0]!);
    expect(mine(s, ZERO.id)).toHaveLength(0);
    s = zap(s, 'Test Spill Over', mine(s, ZIL.id)[0]!);
    expect(mine(s, ZIL.id)).toHaveLength(1); // 4 damage < power 7 (though more than toughness 3)
  });

  it('damage already marked becomes lethal when the rule arrives', () => {
    let s = start(false);
    s = zap(s, 'Test Two Sparks', mine(s, WALL.id)[0]!);
    expect(mine(s, WALL.id)).toHaveLength(1);
    s = resolve(cast(s, 'Test Apex Titan'));
    expect(mine(s, WALL.id)).toHaveLength(0);
  });

  it('excess damage is counted from the power (4 to a 1/5: 3 excess to its controller)', () => {
    let s = start();
    s = zap(s, 'Test Spill Over', mine(s, WALL.id)[0]!);
    expect(lifeOf(s, 'p1')).toBe(17);
  });

  it('a trampler blocked by your 1/5 needs to assign only 1 to it (lethal by power)', () => {
    let s = passUntil(start(), (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', "p2's attack", 600);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: mine(s, TRAMPLER.id, 'p2')[0]!, defender: 'p1' }] });
    let lethal: number | undefined;
    for (let g = 0; g < 200 && lethal === undefined; g++) {
      const d = s.pending;
      if (d === null || d === undefined) break;
      if (d.kind === 'declareBlockers') { s = answer(s, d.player === 'p1' ? { kind: 'declareBlockers', blocks: [{ blocker: mine(s, WALL.id)[0]!, attacker: mine(s, TRAMPLER.id, 'p2')[0]! }] } : { kind: 'declareBlockers', blocks: [] }); continue; }
      if (d.kind === 'assignDamage') { lethal = (d as unknown as { recipients: { id: string; lethal: number }[] }).recipients.find((r) => r.id === mine(s, WALL.id)[0])?.lethal; break; }
      if (d.kind !== 'priority') { s = settle(s); continue; }
      s = act(s, { type: 'pass', player: d.player });
    }
    expect(lethal).toBe(1);
  });
});

describe('CR 301.5a, 608.2d, 608.2h, 702.6a: Hand of Vecna ("equipped creature or a creature you control named Vecna gets +X/+X"; "Equip--Pay 1 life for each card in your hand")', () => {
  const HAND = card('Test Lich Hand', 'Legendary Artifact — Equipment', 'At the beginning of combat on your turn, equipped creature or a creature you control named Vecna gets +X/+X until end of turn, where X is the number of cards in your hand.\nEquip--Pay 1 life for each card in your hand.\nEquip {2}');
  const VECNA = card('Vecna', 'Legendary Creature — Zombie God', '', ['4', '4']);
  const KNIGHT = card('Test Hand Knight', 'Creature — Knight', '', ['2', '2']);
  const FODDER = card('Test Hand Fodder', 'Sorcery', 'Draw a card.');
  const defs = [HAND, VECNA, KNIGHT, FODDER];
  const hand3 = ['Test Hand Fodder', 'Test Hand Fodder', 'Test Hand Fodder'];
  const equipBy = (s0: GameState, which: 'life' | 'mana', target: ObjectId): GameState => {
    const h = named(s0, HAND.id)[0]!;
    const abil = activatedAbilities(s0, s0.objects[h]!).filter((a) => ((a as unknown as { def: { cost?: { other?: { kind: string }[] } } }).def.cost?.other?.some((p) => p.kind === 'payLife') ?? false) === (which === 'life'))[0]!;
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: h, ability: abil.key } as never), { targets: [{ kind: 'object', id: target }] });
    return passUntil(s, (x) => x.zones.stack.length === 0, 'the equip');
  };
  /** Pass into the beginning of combat, resolve the trigger, choosing `pick` when a choice is asked. */
  const toCombat = (s0: GameState, pick?: (o: ObjectId[], s: GameState) => ObjectId, asked?: ObjectId[][]): GameState => {
    let s = passUntil(s0, (x) => x.turn.step === 'beginCombat' && x.zones.stack.length > 0, 'the trigger');
    for (let g = 0; g < 40; g++) {
      const d = s.pending;
      if (d?.kind === 'chooseObjects') { const o = (d as unknown as { options: ObjectId[] }).options; asked?.push(o); s = answer(s, { kind: 'chooseObjects', ids: [pick ? pick(o, s) : o[0]!] }); continue; }
      if (d?.kind !== 'priority') { s = settle(s); continue; }
      if (s.zones.stack.length === 0) break;
      s = act(s, { type: 'pass', player: d.player });
    }
    return s;
  };

  it('compiles full', () => {
    expect(full(HAND)).toBe(true);
  });

  it('Equip--Pay 1 life for each card in your hand: 3 cards, 3 life; the equipped creature gets +3/+3 at the beginning of combat', () => {
    let s = mpScenario({ defs, zones: { p1: { hand: hand3, battlefield: ['Test Lich Hand', 'Test Hand Knight'] } } });
    const knight = named(s, KNIGHT.id)[0]!;
    const n = s.zones.hand['p1']!.length;
    expect(n).toBeGreaterThanOrEqual(3);
    s = equipBy(s, 'life', knight);
    expect(lifeOf(s, 'p1')).toBe(20 - n);
    expect(s.objects[named(s, HAND.id)[0]!]!.attachedTo).toBe(knight);
    s = toCombat(s);
    expect(pt(s, knight)).toBe(`${2 + n}/${2 + n}`);
  });

  it('with Vecna as well, you choose which one gets the bonus as it resolves; X is fixed then', () => {
    let s = mpScenario({ defs, zones: { p1: { hand: hand3, battlefield: ['Test Lich Hand', 'Test Hand Knight', 'Vecna', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Vecna'] } } });
    const knight = named(s, KNIGHT.id)[0]!;
    s = equipBy(s, 'mana', knight);
    const n = s.zones.hand['p1']!.length;
    expect(lifeOf(s, 'p1')).toBe(20);
    const mineV = s.zones.battlefield.find((id) => s.objects[id]!.defId === VECNA.id && s.objects[id]!.controller === 'p1')!;
    const theirsV = s.zones.battlefield.find((id) => s.objects[id]!.defId === VECNA.id && s.objects[id]!.controller === 'p2')!;
    const asked: ObjectId[][] = [];
    s = toCombat(s, (o) => o.find((id) => id === mineV)!, asked);
    expect(asked).toHaveLength(1);
    expect([...asked[0]!].sort()).toEqual([knight, mineV].sort()); // not the opponent's Vecna
    expect(pt(s, mineV)).toBe(`${4 + n}/${4 + n}`);
    expect(pt(s, knight)).toBe('2/2');
    expect(pt(s, theirsV)).toBe('4/4');
    // a card leaves the hand after the resolution: the bonus stays (ruling)
    s = passUntil(s, (x) => x.turn.step === 'main2', 'the second main phase', 600);
    s = passUntil(cast(s, 'Test Hand Fodder'), (x) => x.zones.stack.length === 0, 'the sorcery');
    expect(s.zones.hand['p1']!.length).toBe(n); // cast one, drew one
    s = passUntil(cast(s, 'Test Hand Fodder'), (x) => x.zones.stack.length === 0, 'the sorcery');
    expect(pt(s, mineV)).toBe(`${4 + n}/${4 + n}`);
  });

  it('negative: unattached and no Vecna: nothing gets a bonus', () => {
    let s = mpScenario({ defs, zones: { p1: { hand: hand3, battlefield: ['Test Lich Hand', 'Test Hand Knight'] } } });
    s = passUntil(s, (x) => x.turn.step === 'declareAttackers' || (x.turn.step === 'beginCombat' && x.zones.stack.length > 0), 'combat');
    s = passUntil(s, (x) => x.zones.stack.length === 0, 'the trigger');
    expect(pt(s, named(s, KNIGHT.id)[0]!)).toBe('2/2');
  });
});
