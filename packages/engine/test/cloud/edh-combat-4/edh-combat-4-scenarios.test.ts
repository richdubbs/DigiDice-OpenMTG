/**
 * Commander lane edh-combat, round edh-combat-4: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites checked against the 2026-09-25 text.
 *
 *   CR 506.3e, 509.3a, 509.1h         "create a ... token ... that's blocking that creature" (the token blocks the attacker, no "blocks" trigger)
 *   CR 508.4, 107.3, 608.2h           "Create a tapped and attacking X/X ... token, where X is the greatest power among other attacking creatures."
 *   CR 106.4, 508.1a, 603.2c, 511.3   "Whenever a player attacks, add {R}{R}. Until end of combat, you don't lose this mana as steps end."
 *   CR 506.2, 508.5, 611.3a, 107.3    "As long as this creature is attacking, it gets +X/+0, where X is the number of lands defending player controls."
 *   CR 508.1a, 508.3e, 603.2c, 508.4  "Whenever a player attacks one of your opponents, that attacking player creates a tapped ... token that's attacking that opponent."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, pass, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id);

/** Answer the decisions that come up until priority (payments automatic; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: ObjectId[]; yes?: boolean } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.splice(0, 1).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const byName = (s: GameState, name: string, p?: PlayerId): ObjectId[] => (p ? findAll(s, name, 'battlefield', p) : s.zones.battlefield.filter((id) => chars(s, id).name === name));
const power = (s: GameState, id: ObjectId): number => Number(chars(s, id).power);

const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', { pt: ['4', '4'], colors: ['G'] });

describe('CR 506.3e, 509.3a: "create a 1/1 ... token ... that\'s blocking that creature"', () => {
  const GUARD = card('Test Cat Guard', 'Creature — Cat', "Whenever this creature blocks a creature, create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature.", { pt: ['2', '2'] });
  const WATCH = card('Test Block Watcher', 'Creature — Wizard', 'Whenever a creature blocks, you gain 1 life.', { pt: ['1', '1'] });
  const SHIELD = card('Test Phantom Rank', 'Instant', "Create a 1/1 white Soldier creature token that's blocking target attacking creature.");
  it('is understood', () => {
    expect(noManual(GUARD)).toBe(true);
    expect(noManual(SHIELD)).toBe(true);
  });
  it('the token enters blocking the creature the Guard blocks, is a blocker for damage, and "whenever a creature blocks" triggers once (the Guard), not for the token (CR 509.3a)', () => {
    const defs = [GUARD, WATCH, BEAR];
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Cat Guard', 'Test Block Watcher'] } });
    const bear = byName(advanceTo(s0, 3, 'main1'), 'Test Plain Bear', 'p1')[0]!;
    let s = declareAttackers(toDeclareAttackers(advanceTo(s0, 3, 'main1')), [[bear]]);
    s = toDeclareBlockers(s);
    const guard = byName(s, 'Test Cat Guard', 'p2')[0]!;
    const life = s.players.find((p) => p.id === 'p2')!.life;
    s = resolveAll(declareBlockers(s, [[guard, bear]]));
    const cat = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && chars(s, id).subtypes.includes('Cat'))!;
    expect(cat).toBeDefined();
    const att = s.combat!.attackers.find((a) => a.id === bear)!;
    expect(att.blockedBy).toContain(cat);
    expect(att.blockedBy).toContain(guard);
    expect(s.combat!.blockers.find((b) => b.id === cat)!.blocking).toEqual([bear]);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(life + 1); // the watcher triggered once, for the Guard
  });
  it('CR 509.3c-d: the attacker "becomes blocked by a creature" for the Guard AND for the token that enters blocking it, but "becomes blocked" only once (it was already blocked)', () => {
    const RAM = card('Test Charging Ram', 'Creature — Ram', 'Whenever this creature becomes blocked by a creature, you gain 1 life.\nWhenever this creature becomes blocked, you gain 10 life.', { pt: ['2', '2'] });
    const defs = [GUARD, RAM];
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Charging Ram'] }, p2: { battlefield: ['Test Cat Guard'] } }), 3, 'main1');
    const ram = byName(s0, 'Test Charging Ram', 'p1')[0]!;
    let s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[ram]]));
    const guard = byName(s, 'Test Cat Guard', 'p2')[0]!;
    const life = s.players.find((p) => p.id === 'p1')!.life;
    s = resolveAll(declareBlockers(s, [[guard, ram]]));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life + 10 + 1 + 1);
  });
  it('CR 509.3c: a token put onto the battlefield blocking an UNBLOCKED attacker makes it a blocked creature and "becomes blocked" triggers (the attacker deals no damage to the player)', () => {
    const RAM = card('Test Charging Ram', 'Creature — Ram', 'Whenever this creature becomes blocked, you gain 10 life.', { pt: ['2', '2'] });
    const defs = [BEAR, SHIELD, RAM];
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Charging Ram'] }, p2: { battlefield: ['Test Plain Bear'], hand: ['Test Phantom Rank'] } });
    const s1 = advanceTo(s0, 3, 'main1');
    const ram = byName(s1, 'Test Charging Ram', 'p1')[0]!;
    const p2life = s1.players.find((p) => p.id === 'p2')!.life;
    const life = s1.players.find((p) => p.id === 'p1')!.life;
    let s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s1), [[ram]]));
    s = pass(declareBlockers(s, []));
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Phantom Rank', 'hand', 'p2') }), { targets: [ram] }), { targets: [ram] });
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life + 10);
    expect(s.combat!.attackers.find((a) => a.id === ram)!.blocked).toBe(true);
    for (let i = 0; i < 12 && s.turn.step !== 'main2'; i++) s = pass(s);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(p2life); // the Ram was blocked: no damage to the player
  });
  it('negative (CR 506.3e): a token made by the attacking player\'s own instant is not blocking (its controller is not the player attacked)', () => {
    const defs = [BEAR, SHIELD];
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Plain Bear'], hand: ['Test Phantom Rank'] } });
    const s1 = advanceTo(s0, 3, 'main1');
    const bear = byName(s1, 'Test Plain Bear', 'p1')[0]!;
    let s = declareAttackers(toDeclareAttackers(s1), [[bear]]);
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Phantom Rank', 'hand', 'p1') }), { targets: [bear] }), { targets: [bear] });
    const tok = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(tok).toBeDefined();
    expect(s.combat!.blockers.some((b) => b.id === tok)).toBe(false);
    expect(s.combat!.attackers.find((a) => a.id === bear)!.blockedBy).not.toContain(tok);
  });
  it('the defending player\'s instant puts the token onto the battlefield blocking the target attacker', () => {
    const defs = [BEAR, SHIELD];
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'], hand: ['Test Phantom Rank'] } });
    const s1 = advanceTo(s0, 3, 'main1');
    const bear = byName(s1, 'Test Plain Bear', 'p1')[0]!;
    let s = declareAttackers(toDeclareAttackers(s1), [[bear]]);
    s = toDeclareBlockers(s);
    s = declareBlockers(s, []);
    s = pass(s); // p1 passes priority in the declare blockers step
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Phantom Rank', 'hand', 'p2') }), { targets: [bear] }), { targets: [bear] });
    const tok = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(tok).toBeDefined();
    expect(s.combat!.blockers.find((b) => b.id === tok)?.blocking).toEqual([bear]);
  });
});

describe('CR 508.4, 107.3, 608.2h: "Create a tapped and attacking X/X ... token, where X is the greatest power among other attacking creatures."', () => {
  const LEADER = card('Test Pack Leader', 'Creature — Dinosaur', 'Whenever you attack, create a tapped and attacking X/X green Dinosaur creature token with trample, where X is the greatest power among other attacking creatures.', { pt: ['3', '3'] });
  const defs = [LEADER, BEAR, OGRE];
  it('is understood', () => expect(noManual(LEADER)).toBe(true));
  it('the token is tapped and attacking, as big as the greatest power among the OTHER attackers (the Leader\'s own 3 power does not count)', () => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Pack Leader', 'Test Plain Bear', 'Test Plain Ogre'] } }), 3, 'main1');
    const bear = byName(s0, 'Test Plain Bear', 'p1')[0]!;
    const ogre = byName(s0, 'Test Plain Ogre', 'p1')[0]!;
    const leader = byName(s0, 'Test Pack Leader', 'p1')[0]!;
    const s = resolveAll(declareAttackers(toDeclareAttackers(s0), [[bear], [ogre], [leader]]));
    const tok = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(tok).toBeDefined();
    expect(power(s, tok)).toBe(4);
    expect(s.objects[tok]!.tapped).toBe(true);
    expect(s.combat!.attackers.some((a) => a.id === tok)).toBe(true);
  });
  it('negative: the Leader is the only attacker: X is 0 and the 0/0 token dies', () => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Pack Leader', 'Test Plain Ogre'] } }), 3, 'main1');
    const leader = byName(s0, 'Test Pack Leader', 'p1')[0]!;
    const s = resolveAll(declareAttackers(toDeclareAttackers(s0), [[leader]]));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token')).toBe(false);
  });
});

describe('CR 106.4, 508.1a, 511.3: "Whenever a player attacks, add {R}{R}. Until end of combat, you don\'t lose this mana as steps end."', () => {
  const FORGE = card('Test War Forge', 'Enchantment', "Whenever a player attacks, add {R}{R}. Until end of combat, you don't lose this mana as steps end.");
  const defs = [FORGE, BEAR];
  const pool = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.manaPool.length;
  it('is understood', () => expect(noManual(FORGE)).toBe(true));
  it('any player attacking gives the Forge\'s controller the mana, and it stays through the combat steps and is gone after combat', () => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test War Forge', 'Test Plain Bear'] } }), 3, 'main1');
    const bear = byName(s0, 'Test Plain Bear', 'p1')[0]!;
    let s = resolveAll(declareAttackers(toDeclareAttackers(s0), [[bear]]));
    expect(pool(s, 'p2')).toBe(2);
    expect(pool(s, 'p1')).toBe(0);
    s = toDeclareBlockers(s);
    expect(pool(s, 'p2')).toBe(2); // still there in the declare blockers step
    s = declareBlockers(s, []);
    for (let i = 0; i < 12 && s.turn.step !== 'main2'; i++) s = pass(s);
    expect(s.turn.step).toBe('main2');
    expect(pool(s, 'p2')).toBe(0);
  });
  it('negative: no attack, no mana', () => {
    const s0 = advanceTo(scenario([], { defs, p1: { battlefield: ['Test Plain Bear'] }, p2: { battlefield: ['Test War Forge'] } }), 3, 'main1');
    expect(pool(s0, 'p2')).toBe(0);
  });
});

describe('CR 506.2, 508.5, 611.3a: "As long as this creature is attacking, it gets +X/+0, where X is the number of lands defending player controls."', () => {
  const RAIDER = card('Test Land Raider', 'Creature — Giant', 'As long as this creature is attacking, it gets +X/+0, where X is the number of lands defending player controls.', { pt: ['1', '1'] });
  const defs = [RAIDER];
  const start = (): GameState => mpScenario({
    players: 3, defs, options: { startingPlayer: 'p1' },
    zones: {
      p1: { battlefield: [{ name: 'Test Land Raider', since: -1 }, 'Plains'] },
      p2: { battlefield: ['Plains', 'Plains', 'Plains'] },
      p3: { battlefield: ['Plains'] },
    },
  });
  it('is understood', () => expect(noManual(RAIDER)).toBe(true));
  it('not attacking it has its printed power; attacking a player it counts THAT player\'s lands (and no one else\'s)', () => {
    for (const [defender, lands] of [['p2', 3], ['p3', 1]] as const) {
      let s = start();
      const raider = byName(s, 'Test Land Raider', 'p1')[0]!;
      expect(power(s, raider)).toBe(1);
      for (let i = 0; i < 80 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: raider, defender }] });
      expect(power(s, raider)).toBe(1 + lands);
    }
  });
  it('after combat it is a 1/1 again', () => {
    let s = start();
    const raider = byName(s, 'Test Land Raider', 'p1')[0]!;
    for (let i = 0; i < 80 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: raider, defender: 'p2' }] });
    for (let i = 0; i < 40 && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(s.turn.step).toBe('main2');
    expect(power(s, raider)).toBe(1);
  });
});

describe('CR 508.1a, 508.3e, 603.2c, 508.4: "Whenever a player attacks one of your opponents, that attacking player creates a tapped ... token that\'s attacking that opponent."', () => {
  const SCRIBE = card('Test Ink Scribe', 'Creature — Bird', "Whenever a player attacks one of your opponents, that attacking player creates a tapped 2/1 white and black Inkling creature token with flying that's attacking that opponent.", { pt: ['1', '1'] });
  const defs = [SCRIBE, BEAR];
  const start = (active: PlayerId): GameState => mpScenario({
    players: 3, defs, options: { startingPlayer: active },
    zones: {
      p1: { battlefield: ['Test Ink Scribe', { name: 'Test Plain Bear', since: -1 }, { name: 'Test Plain Bear', since: -1 }] },
      p2: { battlefield: [{ name: 'Test Plain Bear', since: -1 }, { name: 'Test Plain Bear', since: -1 }] },
      p3: { battlefield: [{ name: 'Test Plain Bear', since: -1 }, { name: 'Test Plain Bear', since: -1 }] },
    },
  });
  function attackWith(s0: GameState, who: PlayerId, attacks: [number, PlayerId][]): GameState {
    let s = s0;
    for (let i = 0; i < 80 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(s.turn.activePlayer).toBe(who);
    const bears = byName(s, 'Test Plain Bear', who);
    return resolveAll(drive(answer(s, { kind: 'declareAttackers', attacks: attacks.map(([i, defender]) => ({ attacker: bears[i]!, defender })) })));
  }
  const inklings = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.kind === 'token' && chars(s, id).subtypes.includes('Inkling'));
  const attackedBy = (s: GameState, id: ObjectId): string | undefined => { const a = s.combat?.attackers.find((x) => x.id === id); return a?.defendingPlayer; };
  it('is understood', () => expect(noManual(SCRIBE)).toBe(true));
  it('an opponent attacks the other opponent: THAT attacking player gets a tapped flying Inkling attacking that opponent (not the Scribe\'s controller)', () => {
    const s = attackWith(start('p2'), 'p2', [[0, 'p3'], [1, 'p3']]);
    const mine = inklings(s, 'p2');
    expect(mine.length).toBe(1);
    expect(s.objects[mine[0]!]!.tapped).toBe(true);
    expect(attackedBy(s, mine[0]!)).toBe('p3');
    expect(inklings(s, 'p1').length).toBe(0);
    expect(inklings(s, 'p3').length).toBe(0);
  });
  it('CR 603.2c: you attack both opponents with one creature each: one trigger for each opponent attacked, each token attacking its own opponent', () => {
    const s = attackWith(start('p1'), 'p1', [[0, 'p2'], [1, 'p3']]);
    const mine = inklings(s, 'p1');
    expect(mine.length).toBe(2);
    expect(mine.map((id) => attackedBy(s, id)).sort()).toEqual(['p2', 'p3']);
  });
  it('two creatures attack the same opponent: still one trigger, one Inkling', () => {
    const s = attackWith(start('p1'), 'p1', [[0, 'p2'], [1, 'p2']]);
    expect(inklings(s, 'p1').length).toBe(1);
  });
  it('negative: an opponent who attacks only the Scribe\'s controller (not one of their opponents) gets nothing', () => {
    const s = attackWith(start('p2'), 'p2', [[0, 'p1'], [1, 'p1']]);
    expect(inklings(s, 'p2').length).toBe(0);
    expect(inklings(s, 'p1').length).toBe(0);
  });
  it('an opponent attacking you and the other opponent: one Inkling, attacking the other opponent only', () => {
    const s = attackWith(start('p2'), 'p2', [[0, 'p1'], [1, 'p3']]);
    const mine = inklings(s, 'p2');
    expect(mine.length).toBe(1);
    expect(attackedBy(s, mine[0]!)).toBe('p3');
  });
});

describe('CR 506.2, 611.3a: "defending player" in an Equipment\'s static quantity is the player the EQUIPPED creature attacks', () => {
  const BLADE = card('Test Spoils Blade', 'Artifact — Equipment', 'Equipped creature gets +X/+0, where X is the number of lands defending player controls.');
  const defs = [BLADE, BEAR];
  it('is understood and counts the lands of the player the equipped attacker attacks; 0 lands when it is not attacking', () => {
    expect(noManual(BLADE)).toBe(true);
    let s = mpScenario({
      players: 3, defs, options: { startingPlayer: 'p1' },
      zones: { p1: { battlefield: ['Test Spoils Blade', { name: 'Test Plain Bear', since: -1 }] }, p2: { battlefield: ['Plains', 'Plains', 'Plains'] }, p3: { battlefield: ['Plains'] } },
    });
    const bear = byName(s, 'Test Plain Bear', 'p1')[0]!;
    s.objects[byName(s, 'Test Spoils Blade', 'p1')[0]!]!.attachedTo = bear;
    expect(power(s, bear)).toBe(2);
    for (let i = 0; i < 80 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    expect(power(s, bear)).toBe(2 + 3);
  });
});
