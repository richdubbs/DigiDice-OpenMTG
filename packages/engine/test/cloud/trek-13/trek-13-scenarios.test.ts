/**
 * trek-13 (lane trek, Star Trek: Borg and assimilate): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. The Star Trek mechanics (assimilate, ...) are newer than the
 * Comprehensive Rules edition of rules/cr (2026-09-25): their reminder text is the rule source; CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 702.56a, 707.10     "Artifact spells you cast have replicate {1}." (Hugh, First of Many): the spell is cast with the replicate cost, paid any number of times; each copy of an artifact
 *                          spell becomes a token; a spell of another kind, a spell another player casts, and a spell cast with no such permanent have none
 *   CR 702.125a, 611.2c    "the next artifact creature spell and the next Spacecraft spell you cast this turn have undaunted." (Võx, Child of the Collective): each spell costs {1} less for each
 *                          opponent; only the first spell of each kind; none of another kind
 *   CR 509.3a, 603.2       "Artifact creatures you control have menace and 'Whenever a creature blocks this creature, that creature gets -1/-1 until end of turn.'" (Extraction Integrant)
 *   CR 702.16a, 611.2c     "... artifact creatures you control gain protection from the color of your choice until end of turn" (Borg Incursion): the artifact creatures there are when it
 *                          resolves, the tokens it just made included; none that comes later
 *   CR 115.1, 601.2c, 404.1 "For each opponent, assimilate up to one target creature card from that player's graveyard that was put there from the battlefield this turn." (Assimilate the Wounded)
 *   CR 701.20a, 101.4      "Each opponent reveals cards from the top of their library until they reveal a creature card. Assimilate one of the creature cards revealed this way. Then each
 *                          opponent puts the other cards they revealed this way on the bottom of their library in a random order." (Gift of Perfection)
 *   CR 607.2a, 611.2a      "I -- Assimilate target nonartifact creature an opponent controls. ... III -- Exile the Borg assimilated with ~, then return it to the battlefield under its owner's
 *                          control." (The Best of Both Worlds): control and a +1/+1 counter for good; chapter III returns the creature as the card it is
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, find } from '../../m5/helpers';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { drive, resolveAll, resolveTop } from '../../m5/cr-examples/helpers';
import { castWith, synthetic } from '../../m6/costs/support';
import { mpScenario, drive as mpDrive } from '../../m12/rules/helpers';
import { scenario } from '../../m3/scenario';

const automatedAll = (d: CardDef): boolean => (d.automation.level === 'full' || d.automation.level === 'partial') && d.automation.autoRatio === 1 && !JSON.stringify(d.faces).includes('"op":"manual"')
  && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const target = (id: string): DecisionAnswer => ({ kind: 'chooseTargets', targets: [id === 'p1' || id === 'p2' || id === 'p3' ? { kind: 'player' as const, id } : { kind: 'object' as const, id }] });
const targets = (...ids: string[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) });
const pick = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });
const subtypes = (s: GameState, id: string): string[] => [...getChars(s, id)!.subtypes].sort();
const zoneOf = (s: GameState, name: string): string[] => Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name).map((o) => o.zone);
const onField = (s: GameState, name: string, controller?: PlayerId): string => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name && (controller === undefined || s.objects[id]!.controller === controller))!;
const countOn = (s: GameState, name: string, controller?: PlayerId): number => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name && (controller === undefined || s.objects[id]!.controller === controller)).length;
const libraryNames = (s: GameState, p: PlayerId): string[] => s.zones.library[p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);
/** Resolve everything on the stack, ordering simultaneous triggers as given (the first order the game offers). */
function settle(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 40; i++) {
    if (s.pending?.kind === 'order') s = act(s, { type: 'answer', player: s.pending.player, decisionId: s.pending.id, answer: { kind: 'order', ids: (s.pending as { items: { id: string }[] }).items.map((x) => x.id) } });
    else if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = act(s, { type: 'pass', player: s.pending.player });
    else break;
  }
  return s;
}
/** Resolve the stack in a game of three players (everyone passes in turn), answering the decisions that come up with `answers` in order. */
function resolveMp(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  for (let i = 0; i < 60 && (s.zones.stack.length > 0 || (s.pending != null && s.pending.kind !== 'priority')); i++) {
    if (s.pending?.kind === 'order') s = settle(s);
    else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
    else s = mpDrive(s, answers);
  }
  return s;
}
/** Everything on the stack resolves (a game of three: the trigger of a main phase is put on the stack, everyone passes). */
const resolveMpTop = (s: GameState): GameState => resolveMp(s);
const stackNames = (s: GameState): string[] => s.zones.stack.map((id) => s.defs[s.objects[id]!.defId]!.name);

describe('CR 702.56a, 707.10: "Artifact spells you cast have replicate {1}." (Hugh, First of Many)', () => {
  const TAILOR = synthetic('Test Hive Tailor', 'Legendary Artifact Creature — Borg', '{0}', 'Artifact spells you cast have replicate {1}.', { power: '2', toughness: '2' });
  const WIDGET = synthetic('Test Copy Widget', 'Artifact Creature — Construct', '{1}', '', { power: '1', toughness: '1' });
  const RITUAL = synthetic('Test Odd Ritual', 'Sorcery', '{1}', 'You gain 1 life.');
  const DEFS = [TAILOR, WIDGET, RITUAL];
  const board = (tailor = true): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Copy Widget', 'Test Odd Ritual'], battlefield: [...(tailor ? ['Test Hive Tailor'] : []), 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Copy Widget'], battlefield: ['Plains', 'Plains'] } });

  it('the static ability is automated (an experimental template caps the level at partial, design 6.9)', () => expect(automatedAll(TAILOR), JSON.stringify(TAILOR.automation)).toBe(true));
  it('an artifact spell asks how many times to pay replicate: paid twice, it is copied twice and each copy becomes a token (the spell and two copies enter)', () => {
    let s = board();
    s = castWith(s, 'Test Copy Widget', [{ kind: 'chooseNumber', n: 2 }]);
    expect(stackNames(s)).toEqual(['Test Copy Widget', 'Test Copy Widget']); // the spell, and the replicate trigger above it
    s = resolveAll(s);
    expect(countOn(s, 'Test Copy Widget', 'p1')).toBe(3);
    expect(Object.values(s.objects).filter((o) => o.zone === 'battlefield' && s.defs[o.defId]!.name === 'Test Copy Widget' && o.kind === 'token')).toHaveLength(2);
  });
  it('paid zero times it is an ordinary spell: no copy', () => {
    let s = board();
    s = castWith(s, 'Test Copy Widget', [{ kind: 'chooseNumber', n: 0 }]);
    expect(stackNames(s)).toEqual(['Test Copy Widget']);
    s = resolveAll(s);
    expect(countOn(s, 'Test Copy Widget', 'p1')).toBe(1);
  });
  it('a spell that is not an artifact has no replicate: no question', () => {
    let s = board();
    s = castWith(s, 'Test Odd Ritual');
    expect(s.pending?.kind).not.toBe('chooseNumber');
    expect(stackNames(s)).toEqual(['Test Odd Ritual']);
  });
  it('without the permanent an artifact spell has no replicate', () => {
    let s = board(false);
    s = castWith(s, 'Test Copy Widget');
    expect(s.pending?.kind).not.toBe('chooseNumber');
    expect(stackNames(s)).toEqual(['Test Copy Widget']);
  });
  it('the opponent\'s artifact spell has none ("spells you cast")', () => {
    let s = board();
    s = advanceTo(s, 2, 'main1');
    s = castWith(s, 'Test Copy Widget', [], undefined, 'p2');
    expect(s.pending?.kind).not.toBe('chooseNumber');
    expect(stackNames(s)).toEqual(['Test Copy Widget']);
  });
});

describe('CR 702.125a, 611.2c, 601.2a: "the next artifact creature spell and the next Spacecraft spell you cast this turn have undaunted." (Võx, Child of the Collective)', () => {
  const SCOUT = synthetic('Test Hive Scout', 'Legendary Artifact Creature — Borg', '{0}', 'When this creature enters and at the beginning of your first main phase, the next artifact creature spell and the next Spacecraft spell you cast this turn have undaunted.', { power: '2', toughness: '3' });
  const GOLEM = synthetic('Test Bolt Golem', 'Artifact Creature — Golem', '{3}', '', { power: '2', toughness: '2' });
  const SHIP = synthetic('Test Stray Ship', 'Artifact — Spacecraft', '{3}', '');
  const BEAR = synthetic('Test Plain Bear', 'Creature — Bear', '{3}', '', { power: '2', toughness: '2' });
  const DEFS = [SCOUT, GOLEM, SHIP, BEAR];
  const three = (hand: string[], lands: number): GameState => mpScenario({ players: 3, defs: DEFS, zones: { p1: { hand: ['Test Hive Scout', ...hand], battlefield: Array(lands).fill('Plains') as string[] } } });
  const cast = (s: GameState, name: string): GameState => castWith(s, name);
  const tapped = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;

  it('the card is automated', () => expect(automatedAll(SCOUT), JSON.stringify(SCOUT.automation)).toBe(true));
  it('undaunted: with two opponents the next artifact creature spell costs {2} less ({3} costs {1}); the next Spacecraft spell too; each only once', () => {
    let s = three(['Test Bolt Golem', 'Test Bolt Golem', 'Test Stray Ship', 'Test Stray Ship'], 9);
    s = resolveAll(cast(s, 'Test Hive Scout'));
    expect(stackNames(s)).toEqual([]);
    const before = tapped(s);
    s = cast(s, 'Test Bolt Golem');
    expect(tapped(s) - before).toBe(1); // {3} less {1} for each of two opponents
    s = resolveAll(s);
    const afterFirst = tapped(s);
    s = cast(s, 'Test Bolt Golem');
    expect(tapped(s) - afterFirst).toBe(3); // the second artifact creature spell: the grant was used up
    s = resolveAll(s);
    const beforeShip = tapped(s);
    s = cast(s, 'Test Stray Ship');
    expect(tapped(s) - beforeShip).toBe(1); // the Spacecraft grant is its own
    s = resolveAll(s);
    const afterShip = tapped(s);
    s = cast(s, 'Test Stray Ship');
    expect(tapped(s) - afterShip).toBe(3);
  });
  it('a creature spell that is not an artifact is not reduced and does not use the grant up', () => {
    let s = three(['Test Plain Bear', 'Test Bolt Golem'], 6);
    s = resolveAll(cast(s, 'Test Hive Scout'));
    const before = tapped(s);
    s = cast(s, 'Test Plain Bear');
    expect(tapped(s) - before).toBe(3);
    s = resolveAll(s);
    const mid = tapped(s);
    s = cast(s, 'Test Bolt Golem');
    expect(tapped(s) - mid).toBe(1); // still waiting for the artifact creature
  });
  it('the grant ends with the turn: waiting riders are cleared as the next turn begins, and the first main phase trigger of the Scout gives the next turn\'s own', () => {
    let s = three(['Test Bolt Golem'], 9);
    s = resolveAll(cast(s, 'Test Hive Scout'));
    expect(s.turn.nextSpell?.length).toBe(2); // one for the artifact creature spell, one for the Spacecraft spell
    s = advanceTo(s, 2, 'main1'); // the next player's turn
    expect(s.turn.nextSpell).toBeUndefined();
    expect(s.turn.activePlayer).not.toBe('p1');
  });
  it('at the beginning of your first main phase it does it again: back in your own next turn the riders are waiting once the main phase has begun', () => {
    let s = three(['Test Bolt Golem'], 9);
    s = resolveAll(cast(s, 'Test Hive Scout'));
    s = advanceTo(s, 4, 'main1');
    s = resolveMpTop(s);
    expect(s.turn.activePlayer).toBe('p1');
    expect(s.turn.nextSpell?.length).toBe(2);
  });
});

describe('CR 509.3a, 603.2, 613.1f: "Artifact creatures you control have menace and \'Whenever a creature blocks this creature, that creature gets -1/-1 until end of turn.\'" (Extraction Integrant)', () => {
  const MASTER = synthetic('Test Hive Master', 'Artifact Creature — Borg', '{0}', 'Artifact creatures you control have menace and "Whenever a creature blocks this creature, that creature gets -1/-1 until end of turn."', { power: '1', toughness: '1' });
  const DRONE = synthetic('Test Hive Drone', 'Artifact Creature — Borg', '{0}', '', { power: '3', toughness: '3' });
  const PUP = synthetic('Test Block Pup', 'Creature — Dog', '{0}', '', { power: '1', toughness: '1' });
  const CUB = synthetic('Test Block Cub', 'Creature — Bear', '{0}', '', { power: '2', toughness: '2' });
  const DEFS = [MASTER, DRONE, PUP, CUB];
  const toBlockers = (s: GameState, attackers: ObjectId[]): GameState => passUntil(declareAttackers(toDeclareAttackers(s), attackers.map((a): [ObjectId] => [a])), (x) => x.pending?.kind === 'declareBlockers', 'blockers');
  const reply = (s: GameState, blocks: { blocker: ObjectId; attacker: ObjectId }[]): GameState => act(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks } });

  it('the card is automated', () => expect(automatedAll(MASTER), JSON.stringify(MASTER.automation)).toBe(true));
  it('each creature that blocks an artifact creature of yours gets -1/-1 (two blockers: both, menace allows two); the pup (1/1) dies, the cub (2/2) lives as a 1/1', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hive Master', 'Test Hive Drone'] }, p2: { battlefield: ['Test Block Pup', 'Test Block Cub'] } });
    const drone = find(s0, 'Test Hive Drone', 'battlefield', 'p1');
    const pup = find(s0, 'Test Block Pup', 'battlefield', 'p2');
    const cub = find(s0, 'Test Block Cub', 'battlefield', 'p2');
    let s = toBlockers(s0, [drone]);
    s = reply(s, [{ blocker: pup, attacker: drone }, { blocker: cub, attacker: drone }]);
    s = settle(s);
    expect(zoneOf(s, 'Test Block Pup')).toEqual(['graveyard']);
    const c = getChars(s, cub)!;
    expect(`${c.power}/${c.toughness}`).toBe('1/1');
  });
  it('menace is granted too: a lone potential blocker can\'t block the drone, so the player is asked nothing', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hive Master', 'Test Hive Drone'] }, p2: { battlefield: ['Test Block Cub'] } });
    const drone = find(s0, 'Test Hive Drone', 'battlefield', 'p1');
    const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[drone]]), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers or damage');
    expect(s.pending?.kind).not.toBe('declareBlockers');
  });
  it('a creature that is not an artifact gets no such ability: blockers keep their size', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hive Master', 'Test Block Cub'] }, p2: { battlefield: ['Test Block Pup'] } });
    const cubA = find(s0, 'Test Block Cub', 'battlefield', 'p1');
    const pup = find(s0, 'Test Block Pup', 'battlefield', 'p2');
    let s = toBlockers(s0, [cubA]);
    s = reply(s, [{ blocker: pup, attacker: cubA }]);
    expect(s.zones.stack).toHaveLength(0); // no trigger: the cub is not an artifact creature
    expect(s.pending?.kind).not.toBe('order');
    const c = getChars(s, pup)!;
    expect(`${c.power}/${c.toughness}`).toBe('1/1');
  });
});

describe('CR 702.16a, 608.2d, 611.2c: "Create two 1/1 colorless Borg artifact creature tokens, then artifact creatures you control gain protection from the color of your choice until end of turn." (Borg Incursion)', () => {
  const INCURSION = synthetic('Test Hive Surge', 'Instant', '{2}{W}', 'Create two 1/1 colorless Borg artifact creature tokens, then artifact creatures you control gain protection from the color of your choice until end of turn.');
  const DRONE = synthetic('Test Hive Drone', 'Artifact Creature — Borg', '{0}', '', { power: '3', toughness: '3' });
  const CUB = synthetic('Test Block Cub', 'Creature — Bear', '{0}', '', { power: '2', toughness: '2' });
  const LATE = synthetic('Test Late Golem', 'Artifact Creature — Golem', '{0}', '', { power: '1', toughness: '1' });
  const DEFS = [INCURSION, DRONE, CUB, LATE];
  const protections = (s: GameState, id: string): string[] => getChars(s, id)!.keywords.filter((k) => k.keyword === 'protection').map((k) => String(k.quality)).sort();
  const board = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Hive Surge', 'Test Late Golem'], battlefield: ['Test Hive Drone', 'Test Block Cub', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Plains'] } });

  it('the card is automated (an experimental template caps the level at partial, design 6.9)', () => expect(automatedAll(INCURSION), JSON.stringify(INCURSION.automation)).toBe(true));
  it('two Borg artifact creature tokens enter, and every artifact creature of yours, the tokens too, has protection from the chosen color; the non-artifact creature does not', () => {
    let s = board();
    s = castWith(s, 'Test Hive Surge');
    s = drive(resolveTop(s), [{ kind: 'chooseColor', color: 'R' }]);
    const tokens = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.kind === 'token');
    expect(tokens).toHaveLength(2);
    for (const t of tokens) {
      expect(subtypes(s, t.id)).toEqual(['Borg']);
      expect(protections(s, t.id)).toEqual(['color:R']);
    }
    expect(protections(s, onField(s, 'Test Hive Drone'))).toEqual(['color:R']);
    expect(protections(s, onField(s, 'Test Block Cub'))).toEqual([]);
  });
  it('CR 611.2c: an artifact creature that enters afterwards is not affected; it ends at the end of the turn', () => {
    let s = board();
    s = castWith(s, 'Test Hive Surge');
    s = drive(resolveTop(s), [{ kind: 'chooseColor', color: 'U' }]);
    s = resolveAll(castWith(s, 'Test Late Golem'));
    expect(protections(s, onField(s, 'Test Late Golem'))).toEqual([]);
    s = advanceTo(s, 3, 'main1');
    expect(protections(s, onField(s, 'Test Hive Drone'))).toEqual([]);
  });
});

describe('CR 115.1, 601.2c, 404.1: "For each opponent, assimilate up to one target creature card from that player\'s graveyard that was put there from the battlefield this turn." (Assimilate the Wounded)', () => {
  const WOUNDED = synthetic('Test Hive Salvage', 'Instant', '{2}{B}', "For each opponent, assimilate up to one target creature card from that player's graveyard that was put there from the battlefield this turn.");
  const ELF = synthetic('Test Fallen Elf', 'Creature — Elf Druid', '{G}', '', { power: '1', toughness: '1' });
  const OGRE = synthetic('Test Fallen Ogre', 'Creature — Ogre Warrior', '{R}', '', { power: '3', toughness: '3' });
  const DEFS = [WOUNDED, ELF, OGRE];
  const WIPE = synthetic('Test Mass Doom', 'Sorcery', '{1}', 'Destroy all creatures.');
  const ALL = [...DEFS, WIPE];
  const board = (): GameState =>
    mpScenario({
      players: 3, defs: ALL, cards: ['Swamp'],
      zones: {
        p1: { hand: ['Test Mass Doom', 'Test Hive Salvage'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp'] },
        p2: { battlefield: ['Test Fallen Elf'], graveyard: ['Test Fallen Ogre'] },
        p3: { battlefield: ['Test Fallen Ogre', 'Test Fallen Elf'] },
      },
    });
  const afterWipe = (): GameState => resolveAll(castWith(board(), 'Test Mass Doom'));
  const gyId = (s: GameState, name: string, owner: PlayerId): string => s.zones.graveyard[owner]!.find((id) => s.defs[s.objects[id]!.defId]!.name === name)!;
  const targetsOf = (...ids: string[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) });

  it('the card is automated (an experimental template caps the level at partial, design 6.9)', () => expect(automatedAll(WOUNDED), JSON.stringify(WOUNDED.automation)).toBe(true));
  it('compiles with one target spec, at most one target for each opponent, in that opponent\'s graveyard', () => {
    const t = (WOUNDED.faces[0]!.abilities[0] as unknown as { effect: { targets: { perOpponent?: boolean; min: number; max: number; filter: { owner: string; zone: string } }[] } }).effect.targets;
    expect(t).toHaveLength(1);
    expect([t[0]!.perOpponent, t[0]!.min, t[0]!.max, t[0]!.filter.zone, t[0]!.filter.owner]).toEqual([true, 0, 1, 'graveyard', 'opponent']);
  });
  it('one creature card from each opponent\'s graveyard that died this turn is put onto the battlefield under your control with a +1/+1 counter, as a Borg artifact creature; its owner stays its owner', () => {
    let s = afterWipe();
    const elf2 = gyId(s, 'Test Fallen Elf', 'p2');
    const ogre3 = gyId(s, 'Test Fallen Ogre', 'p3');
    s = castWith(s, 'Test Hive Salvage', [targetsOf(elf2, ogre3)]);
    s = resolveAll(s);
    for (const [name, owner] of [['Test Fallen Elf', 'p2'], ['Test Fallen Ogre', 'p3']] as const) {
      const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === name && s.objects[x]!.owner === owner)!;
      expect(s.objects[id]!.controller).toBe('p1');
      expect(s.objects[id]!.counters['+1/+1']).toBe(1);
      expect([...getChars(s, id)!.types].sort()).toEqual(['Artifact', 'Creature']);
      expect(subtypes(s, id)).toEqual(['Borg']);
    }
    expect(countOn(s, 'Test Fallen Elf', 'p1')).toBe(1);
    expect(s.zones.graveyard.p3!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toEqual(['Test Fallen Elf']); // the other card stays
  });
  it('up to one for each opponent: a single target is fine (the other opponent is not targeted)', () => {
    let s = afterWipe();
    s = castWith(s, 'Test Hive Salvage', [targetsOf(gyId(s, 'Test Fallen Ogre', 'p3'))]);
    s = resolveAll(s);
    expect(countOn(s, 'Test Fallen Ogre', 'p1')).toBe(1);
    expect(countOn(s, 'Test Fallen Elf')).toBe(0);
  });
  it('a card that was in the graveyard before this turn is no target (it was not put there from the battlefield this turn)', () => {
    const s = afterWipe();
    const old = gyId(s, 'Test Fallen Ogre', 'p2'); // the Ogre p2 started with in the graveyard
    const wiped = s.zones.graveyard.p2!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Fallen Ogre');
    expect(wiped).toHaveLength(1); // (the scenario's card only; p2 had no Ogre on the battlefield)
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hive Salvage', 'hand', 'p1') });
    expect(JSON.stringify(t.pending)).not.toContain(`"${old}"`);
    void t;
  });
  it('two targets in the same opponent\'s graveyard are not allowed (at most one for each opponent)', () => {
    const s = afterWipe();
    const elf3 = gyId(s, 'Test Fallen Elf', 'p3');
    const ogre3 = gyId(s, 'Test Fallen Ogre', 'p3');
    expect(() => castWith(s, 'Test Hive Salvage', [targetsOf(elf3, ogre3)])).toThrow(/target/i);
  });
  it('with no card of the kind in any graveyard it can\'t be cast with a target, and casts for none (up to one)', () => {
    let s = board();
    s = castWith(s, 'Test Hive Salvage', [targetsOf()]);
    s = resolveAll(s);
    expect(countOn(s, 'Test Fallen Elf', 'p1')).toBe(0);
  });
});

describe('CR 701.20a, 101.4, 400.3: "Each opponent reveals cards from the top of their library until they reveal a creature card. Assimilate one of the creature cards revealed this way. Then each opponent puts the other cards they revealed this way on the bottom of their library in a random order." (Gift of Perfection)', () => {
  const GIFT = synthetic('Test Hive Gift', 'Sorcery', '{4}{U}', 'Each opponent reveals cards from the top of their library until they reveal a creature card. Assimilate one of the creature cards revealed this way. Then each opponent puts the other cards they revealed this way on the bottom of their library in a random order.');
  const ELF = synthetic('Test Fallen Elf', 'Creature — Elf Druid', '{G}', '', { power: '1', toughness: '1' });
  const OGRE = synthetic('Test Fallen Ogre', 'Creature — Ogre Warrior', '{R}', '', { power: '3', toughness: '3' });
  const RITUAL = synthetic('Test Odd Ritual', 'Sorcery', '{1}', 'You gain 1 life.');
  const DEFS = [GIFT, ELF, OGRE, RITUAL];
  const board = (p2: string[], p3: string[]): GameState =>
    mpScenario({ players: 3, defs: DEFS, cards: ['Island'], zones: { p1: { hand: ['Test Hive Gift'], battlefield: ['Island', 'Island', 'Island', 'Island', 'Island'] }, p2: { library: p2 }, p3: { library: p3 } } });
  const top = (s: GameState, p: PlayerId, n: number): string[] => libraryNames(s, p).slice(0, n);
  const idIn = (s: GameState, name: string, owner: PlayerId, zone: 'library' | 'battlefield'): string =>
    (zone === 'library' ? s.zones.library[owner]! : s.zones.battlefield).find((id) => s.defs[s.objects[id]!.defId]!.name === name && s.objects[id]!.owner === owner)!;

  it('the card is automated (an experimental template caps the level at partial, design 6.9)', () => expect(automatedAll(GIFT), JSON.stringify(GIFT.automation)).toBe(true));
  it('each opponent reveals until a creature card; you choose one of the creature cards revealed and assimilate it; every other revealed card goes to the bottom of its owner\'s library', () => {
    let s = board(['Test Odd Ritual', 'Test Fallen Elf', 'Test Odd Ritual'], ['Test Fallen Ogre', 'Test Odd Ritual']);
    const elf = idIn(s, 'Test Fallen Elf', 'p2', 'library');
    const ogre = idIn(s, 'Test Fallen Ogre', 'p3', 'library');
    s = castWith(s, 'Test Hive Gift');
    s = resolveMp(s, [pick(ogre)]);
    const borg = onField(s, 'Test Fallen Ogre'); // (a new object, CR 400.7)
    expect(s.objects[borg]!.controller).toBe('p1');
    expect(s.objects[borg]!.owner).toBe('p3');
    expect(s.objects[borg]!.counters['+1/+1']).toBe(1);
    expect(subtypes(s, borg)).toEqual(['Borg']);
    expect([...getChars(s, borg)!.types].sort()).toEqual(['Artifact', 'Creature']);
    // p2: the Ritual and the Elf (revealed) are the last two cards of their library, the third card (never revealed) is on top; p3: nothing else was revealed
    expect(top(s, 'p2', 1)).toEqual(['Test Odd Ritual']);
    expect(libraryNames(s, 'p2').slice(-2).sort()).toEqual(['Test Fallen Elf', 'Test Odd Ritual']);
    expect(zoneOf(s, 'Test Fallen Elf')).toEqual(['library']);
    expect(top(s, 'p3', 1)).toEqual(['Test Odd Ritual']);
    expect(s.zones.library.p3!.length).toBe(21); // (Ritual and twenty Plains: the Ogre left)
    expect(elf).not.toBe(ogre);
  });
  it('the player with no creature card in their library reveals all of it; with none revealed anywhere nothing is assimilated (and every card goes back to the bottom)', () => {
    let s = board(['Test Odd Ritual'], ['Test Odd Ritual']);
    s = castWith(s, 'Test Hive Gift');
    s = resolveMp(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.defs[s.objects[id]!.defId]!.name !== 'Island')).toHaveLength(0);
    expect(s.zones.library.p2!.length).toBe(21);
    expect(s.zones.library.p3!.length).toBe(21);
  });
  it('only one of the creature cards is assimilated: the other opponent\'s creature card goes to the bottom of its owner\'s library', () => {
    let s = board(['Test Fallen Elf', 'Test Odd Ritual'], ['Test Fallen Ogre', 'Test Odd Ritual']);
    const elf = idIn(s, 'Test Fallen Elf', 'p2', 'library');
    s = castWith(s, 'Test Hive Gift');
    s = resolveMp(s, [pick(elf)]);
    expect(countOn(s, 'Test Fallen Elf', 'p1')).toBe(1);
    expect(countOn(s, 'Test Fallen Ogre')).toBe(0);
    expect(libraryNames(s, 'p3').slice(-1)).toEqual(['Test Fallen Ogre']);
    expect(top(s, 'p3', 1)).toEqual(['Test Odd Ritual']);
  });
});

describe('CR 607.2a, 611.2a, 400.7: "I -- Assimilate target nonartifact creature an opponent controls. II -- Artifact creatures you control get +2/+2 until end of turn. III -- Exile the Borg assimilated with ~, then return it to the battlefield under its owner\'s control." (The Best of Both Worlds)', () => {
  const RITE = synthetic('Test Hive Rite', 'Enchantment — Saga', '{4}{W}{U}',
    "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Assimilate target nonartifact creature an opponent controls. (Gain control of it and put a +1/+1 counter on it. It's a Borg artifact creature and loses all other creature types.)\nII — Artifact creatures you control get +2/+2 until end of turn.\nIII — Exile the Borg assimilated with this Saga, then return it to the battlefield under its owner's control.");
  const CUB = synthetic('Test Block Cub', 'Creature — Bear', '{0}', '', { power: '2', toughness: '2' });
  const DRONE = synthetic('Test Hive Drone', 'Artifact Creature — Borg', '{0}', '', { power: '3', toughness: '3' });
  const DEFS = [RITE, CUB, DRONE];
  const board = (): GameState => scenario(['Island'], { defs: DEFS, p1: { hand: ['Test Hive Rite'], battlefield: ['Plains', 'Plains', 'Plains', 'Island', 'Island', 'Island'] }, p2: { battlefield: ['Test Block Cub', 'Test Hive Drone'] } });
  const chapterI = (): GameState => {
    let s = board();
    const cub = find(s, 'Test Block Cub', 'battlefield', 'p2');
    s = castWith(s, 'Test Hive Rite');
    s = resolveTop(s); // the Saga spell: it enters with a lore counter and chapter I triggers
    s = drive(s, [target(cub)]);
    return resolveAll(s);
  };

  it('the card is automated', () => expect(automatedAll(RITE), JSON.stringify(RITE.automation)).toBe(true));
  it('chapter I: you gain control of the creature for good, it gets a +1/+1 counter and is a Borg artifact creature with Borg its only creature type; an artifact creature is no target', () => {
    const s0 = board();
    const drone = find(s0, 'Test Hive Drone', 'battlefield', 'p2');
    let t = resolveTop(castWith(s0, 'Test Hive Rite'));
    expect(JSON.stringify(t.pending)).not.toContain(`"${drone}"`);
    t = chapterI();
    const cub = onField(t, 'Test Block Cub');
    expect(t.objects[cub]!.controller).toBe('p1');
    expect(t.objects[cub]!.owner).toBe('p2');
    expect(t.objects[cub]!.counters['+1/+1']).toBe(1);
    expect([...getChars(t, cub)!.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(subtypes(t, cub)).toEqual(['Borg']);
  });
  it('chapter II: it is an artifact creature of yours, so it gets +2/+2 until end of turn too; chapter III then exiles it and returns it under its owner\'s control as the card it is (no counter, no Borg)', () => {
    let s = chapterI();
    s = advanceTo(s, 3, 'main1'); // chapter II triggers after the draw step of turn 3
    s = resolveAll(s);
    const cub = onField(s, 'Test Block Cub');
    expect(`${getChars(s, cub)!.power}/${getChars(s, cub)!.toughness}`).toBe('5/5'); // 2/2, the counter, +2/+2
    s = advanceTo(s, 5, 'main1');
    s = resolveAll(s);
    const back = onField(s, 'Test Block Cub');
    expect(back).not.toBe(cub);
    expect(s.objects[back]!.controller).toBe('p2');
    expect(s.objects[back]!.counters['+1/+1'] ?? 0).toBe(0);
    expect([...getChars(s, back)!.types]).toEqual(['Creature']);
    expect(subtypes(s, back)).toEqual(['Bear']);
    expect(zoneOf(s, 'Test Hive Rite')).toEqual(['graveyard']); // sacrificed after III
  });
  it('chapter III with the creature gone does nothing: it was destroyed before, and the opponent\'s artifact creature is not touched', () => {
    const SMITE = synthetic('Test Smite', 'Instant', '{B}', 'Destroy target creature.');
    let s = scenario(['Island', 'Swamp'], { defs: [...DEFS, SMITE], p1: { hand: ['Test Hive Rite'], battlefield: ['Plains', 'Plains', 'Plains', 'Island', 'Island', 'Island'] }, p2: { hand: ['Test Smite'], battlefield: ['Test Block Cub', 'Test Hive Drone', 'Swamp'] } });
    s = resolveTop(castWith(s, 'Test Hive Rite'));
    s = resolveAll(drive(s, [target(find(s, 'Test Block Cub', 'battlefield', 'p2'))]));
    s = advanceTo(s, 2, 'main1'); // p2's turn
    s = castWith(s, 'Test Smite', [target(onField(s, 'Test Block Cub'))], undefined, 'p2');
    s = resolveAll(s);
    expect(zoneOf(s, 'Test Block Cub')).toEqual(['graveyard']);
    s = advanceTo(s, 5, 'main1');
    s = resolveAll(s);
    expect(countOn(s, 'Test Hive Drone', 'p2')).toBe(1);
    expect(zoneOf(s, 'Test Block Cub')).toEqual(['graveyard']); // not exiled, not returned
  });
});
