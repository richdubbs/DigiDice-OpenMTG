/**
 * Round edh-replace-6: the behaviour it added, played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 *
 *   CR 701.54e, 702.16a-b   "Wraiths you control have protection from Ring-bearers." (Lord of the Nazgûl): the quality `ringBearer`: a permanent that is a player's
 *                           Ring-bearer now can't target, damage or be blocked by the protected permanent; any other permanent can
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { activatedAbilities } from '../../../src/rules/abilities';
import { act, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';
import { clone } from '../../../src/util/clone';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const lost = (s: GameState, p: PlayerId): boolean => s.players.find((x) => x.id === p)!.hasLost;
/** The scenario helper keeps twenty Plains in every library; this empties one (the cards cease to exist). */
function emptyLibrary(s0: GameState, p: PlayerId): GameState {
  const s = clone(s0);
  for (const id of s.zones.library[p]!) delete s.objects[id];
  s.zones.library[p] = [];
  return s;
}
const legalActivate = (s: GameState, src: ObjectId): Parameters<typeof act>[1] => legal(s, 'p1', 'activate').find((x) => x.object === src)!.action;
const targetsOf = (s: GameState): ObjectId[] => (s.pending as unknown as { objects: ObjectId[] }).objects;
const pingKey = (s: GameState, id: ObjectId): string => activatedAbilities(s, s.objects[id]!).find((i) => i.def.isMana !== true)!.key;
/** Answer the decisions that come up until priority (payments automatic; the first allowed object; no blocks). */
function drive(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, Math.max(1, p.min)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, 1).map((o) => o.id) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
  return s;
}
const cast = (s0: GameState, name: string, player: PlayerId = 'p1'): GameState => resolveAll(drive(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) })));
/** Go to the declare attackers decision, attack p2 with `attackers`, and play combat out to the end of combat. */
function attack(s0: GameState, attackers: ObjectId[]): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((a) => ({ attacker: a, defender: 'p2' as PlayerId })) });
  for (let i = 0; i < 60 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  return s;
}


describe('CR 701.54e, 702.16a-b: "Wraiths you control have protection from Ring-bearers" (Lord of the Nazgûl)', () => {
  const LORD = card('Test Wraith Lord', 'Creature — Wraith Noble', 'Wraiths you control have protection from Ring-bearers.', { pt: ['3', '3'] });
  const WRAITH = card('Test Plain Wraith', 'Creature — Wraith', '', { pt: ['2', '2'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const PINGER = card('Test Pinger', 'Creature — Wizard', 'Haste\n{T}: Test Pinger deals 1 damage to target creature.', { pt: ['1', '1'] });
  const defs = [LORD, WRAITH, BEAR, PINGER];
  const bearer = (s: GameState, id: ObjectId, player: string): GameState => {
    const t = clone(s);
    t.designations.ring = { ...(t.designations.ring ?? {}), [player]: { tempted: 1, bearer: id } };
    return t;
  };
  it('is fully automated, with the quality', () => {
    expect(LORD.automation.level).toBe('full');
    expect(JSON.stringify(LORD.faces[0]!.abilities)).toContain('"quality":"ringBearer"');
  });
  it("a Ring-bearer (of any player) can't target a Wraith the Lord's controller controls; a creature that is not the Ring-bearer can; a non-Wraith is not protected", () => {
    const s0 = scenario([], { defs, p2: { battlefield: ['Test Wraith Lord', 'Test Plain Wraith', 'Test Plain Bear'] }, p1: { battlefield: ['Test Pinger', 'Test Pinger'] } });
    const lord = find(s0, 'Test Wraith Lord', 'battlefield', 'p2');
    const wraith = find(s0, 'Test Plain Wraith', 'battlefield', 'p2');
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    const pingers = s0.zones.battlefield.filter((id) => s0.objects[id]!.controller === 'p1');
    const [pa, pb] = pingers as [ObjectId, ObjectId];
    const s1 = bearer(s0, pa, 'p1');
    expect(getChars(s1, pa)!.ringBearer).toBe(true);
    expect(getChars(s1, pb)!.ringBearer).toBeUndefined();
    const fromBearer = targetsOf(act(s1, { type: 'activate', player: 'p1', source: pa, ability: pingKey(s1, pa) }));
    expect(fromBearer).toContain(bear);
    expect(fromBearer).not.toContain(wraith);
    expect(fromBearer).not.toContain(lord); // the Lord is a Wraith too
    const fromOther = targetsOf(act(s1, { type: 'activate', player: 'p1', source: pb, ability: pingKey(s1, pb) }));
    expect(fromOther).toContain(wraith);
    expect(fromOther).toContain(lord);
    // with no Ring-bearer at all nobody is stopped (negative case)
    const fromNone = targetsOf(act(s0, { type: 'activate', player: 'p1', source: pa, ability: pingKey(s0, pa) }));
    expect(fromNone).toContain(wraith);
  });
  it("a permanent recorded as one player's Ring-bearer but controlled by another is not a Ring-bearer (CR 701.54a, 701.54e): it is not stopped", () => {
    const s0 = scenario([], { defs, p2: { battlefield: ['Test Wraith Lord', 'Test Plain Wraith'] }, p1: { battlefield: ['Test Pinger'] } });
    const wraith = find(s0, 'Test Plain Wraith', 'battlefield', 'p2');
    const pa = find(s0, 'Test Pinger', 'battlefield', 'p1');
    const s1 = bearer(s0, pa, 'p2'); // p2 chose the Pinger, but p1 controls it
    expect(getChars(s1, pa)!.ringBearer).toBeUndefined();
    expect(targetsOf(act(s1, { type: 'activate', player: 'p1', source: pa, ability: pingKey(s1, pa) }))).toContain(wraith);
  });
});

describe('CR 701.27a, 701.27c, 614.1a: "Transform all Humans. Prevent all combat damage that would be dealt this turn by creatures other than Werewolves and Wolves." (Moonmist)', () => {
  const MOON = card('Test Moonrise', 'Instant', 'Transform all Humans. Prevent all combat damage that would be dealt this turn by creatures other than Werewolves and Wolves.');
  const FRONT = { name: 'Test Villager', mana_cost: '{0}', type_line: 'Creature — Human', oracle_text: '', power: '1', toughness: '1', colors: [] };
  const BACK = { name: 'Test Howler', mana_cost: '', type_line: 'Creature — Werewolf', oracle_text: '', power: '3', toughness: '3', colors: [] };
  const VILLAGER: CardDef = compileCard({ name: 'Test Villager // Test Howler', layout: 'transform', mana_cost: '{0}', type_line: 'Creature — Human // Creature — Werewolf', colors: [], card_faces: [FRONT, BACK] } as unknown as OracleCard);
  const HUMAN = card('Test Plain Human', 'Creature — Human', '', { pt: ['5', '5'] });
  const WOLF = card('Test Plain Wolf', 'Creature — Wolf', '', { pt: ['2', '2'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['4', '4'] });
  const defs = [MOON, VILLAGER, HUMAN, WOLF, BEAR];
  it('is fully automated', () => expect(MOON.automation.level).toBe('full'));
  it('transforms every double-faced Human (the back face is a Werewolf, so its damage is not prevented); a Human that is not double-faced and a Human card in a graveyard are untouched; other creatures are prevented', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Moonrise'], battlefield: ['Test Villager // Test Howler', 'Test Plain Human', 'Test Plain Wolf', 'Test Plain Bear'], graveyard: ['Test Villager // Test Howler'] } });
    const villager = find(s0, 'Test Villager // Test Howler', 'battlefield', 'p1');
    const grave = find(s0, 'Test Villager // Test Howler', 'graveyard', 'p1');
    const human = find(s0, 'Test Plain Human', 'battlefield', 'p1');
    const wolf = find(s0, 'Test Plain Wolf', 'battlefield', 'p1');
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p1');
    const s1 = cast(s0, 'Test Moonrise');
    expect(s1.objects[villager]!.face).toBe(1);
    expect(s1.objects[human]!.face).toBe(0);
    expect(s1.objects[grave]!.face).toBe(0);
    const s2 = attack(s1, [villager, human, wolf, bear]);
    // 3 (the transformed Werewolf) + 2 (the Wolf) get through; the Human (5) and the Bear (4) are prevented
    expect(life(s2, 'p2')).toBe(20 - 5);
  });
  it('the negative case: without Moonrise all four creatures deal their damage (a Human is not transformed)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Villager // Test Howler', 'Test Plain Human', 'Test Plain Wolf', 'Test Plain Bear'] } });
    const ids = ['Test Villager // Test Howler', 'Test Plain Human', 'Test Plain Wolf', 'Test Plain Bear'].map((n) => findAll(s0, n, 'battlefield', 'p1')[0]!);
    const s2 = attack(s0, ids);
    expect(life(s2, 'p2')).toBe(20 - (1 + 5 + 2 + 4));
  });
});

describe('CR 614.1a, 121.1, 608.2d: "If you would draw a card while your library has no cards in it, instead return a creature card from your graveyard to the battlefield. If you can\'t, you lose the game." (Out of the Tombs)', () => {
  const TOMB = card('Test Crypt Rite', 'Enchantment', "If you would draw a card while your library has no cards in it, instead return a creature card from your graveyard to the battlefield. If you can't, you lose the game.");
  const DRAW = card('Test Study', 'Instant', 'Draw a card.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  const defs = [TOMB, DRAW, BEAR, OGRE];
  const study = (s0: GameState): GameState => cast(s0, 'Test Study');
  it('is fully automated', () => expect(TOMB.automation.level).toBe('full'));
  it('library empty, a creature card in your graveyard: it returns to the battlefield instead of drawing (no draw, no loss)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Study'], battlefield: ['Test Crypt Rite'], graveyard: ['Test Plain Bear'] } });
    const s1 = study(emptyLibrary(s0, 'p1'));
    expect(s1.zones.battlefield.some((id) => s1.objects[id]!.controller === 'p1' && s1.defs[s1.objects[id]!.defId]!.name === 'Test Plain Bear')).toBe(true);
    expect(s1.zones.graveyard['p1']!.some((id) => s1.defs[s1.objects[id]!.defId]!.name === 'Test Plain Bear')).toBe(false);
    expect(s1.zones.hand['p1']!.length).toBe(0);
    expect(lost(s1, 'p1')).toBe(false);
  });
  it("library empty and no creature card in your graveyard (a land, an instant and another player's creature don't count): you lose the game", () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Study'], battlefield: ['Test Crypt Rite'], graveyard: [] }, p2: { graveyard: ['Test Plain Bear'] } });
    const s1 = study(emptyLibrary(s0, 'p1'));
    expect(lost(s1, 'p1')).toBe(true);
  });
  it('the negative case: with cards in the library you draw normally and nothing returns', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Study'], battlefield: ['Test Crypt Rite'], graveyard: ['Test Plain Bear'] } });
    const s1 = study(s0);
    expect(s1.zones.hand['p1']!.length).toBe(1);
    expect(s1.zones.graveyard['p1']!.some((id) => s1.defs[s1.objects[id]!.defId]!.name === 'Test Plain Bear')).toBe(true);
    expect(s1.zones.battlefield.some((id) => s1.defs[s1.objects[id]!.defId]!.name === 'Test Plain Bear')).toBe(false);
    expect(lost(s1, 'p1')).toBe(false);
  });
  it('a draw of two cards: each draw is replaced independently (ruling 2022-10-07): the one creature card returns, the second draw finds none and you lose', () => {
    const DRAW2 = card('Test Deep Study', 'Instant', 'Draw two cards.');
    const s0 = scenario([], { defs: [...defs, DRAW2], p1: { hand: ['Test Deep Study'], battlefield: ['Test Crypt Rite'], graveyard: ['Test Plain Bear'] } });
    const s1 = cast(emptyLibrary(s0, 'p1'), 'Test Deep Study');
    expect(s1.zones.battlefield.some((id) => s1.defs[s1.objects[id]!.defId]!.name === 'Test Plain Bear')).toBe(true);
    expect(lost(s1, 'p1')).toBe(true);
    const s2 = scenario([], { defs: [...defs, DRAW2], p1: { hand: ['Test Deep Study'], battlefield: ['Test Crypt Rite'], graveyard: ['Test Plain Bear', 'Test Plain Ogre'] } });
    const s3 = cast(emptyLibrary(s2, 'p1'), 'Test Deep Study');
    expect(s3.zones.battlefield.filter((id) => ['Test Plain Bear', 'Test Plain Ogre'].includes(s3.defs[s3.objects[id]!.defId]!.name)).length).toBe(2);
    expect(lost(s3, 'p1')).toBe(false);
  });
  it("an opponent's draw is not replaced (the replacement is for you)", () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Crypt Rite'], graveyard: ['Test Plain Bear'] }, p2: { hand: ['Test Study'] } });
    const s1 = cast(pass(emptyLibrary(s0, 'p2')), 'Test Study', 'p2');
    expect(lost(s1, 'p2')).toBe(true);
    expect(s1.zones.battlefield.some((id) => s1.defs[s1.objects[id]!.defId]!.name === 'Test Plain Bear')).toBe(false);
  });
});

describe('CR 611.2c, 608.2c, 615.1a: "Permanents you control with counters on them gain hexproof and indestructible until end of turn. Prevent all damage that would be dealt to those permanents this turn. Proliferate." (Mutational Advantage)', () => {
  const MUT = card('Test Mutation Boon', 'Instant', 'Permanents you control with counters on them gain hexproof and indestructible until end of turn. Prevent all damage that would be dealt to those permanents this turn. Proliferate.');
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 2 damage to target creature.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '5'] });
  const defs = [MUT, BOLT, BEAR];
  type Target = { kind: 'object'; id: ObjectId };
  const spark = (s0: GameState, at: ObjectId, player: PlayerId = 'p1'): GameState => {
    const asked = act(s0, { type: 'cast', player, card: find(s0, 'Test Spark', 'hand', player) });
    let s = answer(asked, { kind: 'chooseTargets', targets: [{ kind: 'object', id: at } as Target] });
    for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
    return s;
  };
  const withCounter = (s: GameState, id: ObjectId): GameState => { const t = clone(s); t.objects[id]!.counters['+1/+1'] = 1; return t; };
  it('is fully automated, the grant binding its group for the prevention', () => {
    expect(MUT.automation.level).toBe('full');
    const steps = JSON.stringify(MUT.faces[0]!.abilities);
    expect(steps).toContain('"ref":"bound"');
  });
  it('damage to a permanent with counters is prevented, to one without is not; a counter put on the second afterwards does not change that (the set is locked as it resolves)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Mutation Boon', 'Test Spark', 'Test Spark'], battlefield: ['Test Plain Bear', 'Test Plain Bear'] } });
    const [a, b] = findAll(s0, 'Test Plain Bear', 'battlefield', 'p1') as [ObjectId, ObjectId];
    let s = withCounter(s0, a);
    s = cast(s, 'Test Mutation Boon');
    expect(s.objects[a]!.counters['+1/+1']).toBe(2); // proliferate (auto-chosen) added another
    s = spark(s, a);
    expect(s.objects[a]!.damage).toBe(0);
    s = spark(withCounter(s, b), b); // b got a counter only after the effect began
    expect(s.objects[b]!.damage).toBe(2);
  });
  it("the negative case: without the spell nothing is prevented, and an opponent's permanent with a counter is not covered (\"you control\")", () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Mutation Boon', 'Test Spark'] }, p2: { battlefield: ['Test Plain Bear'] } });
    const c = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    const s1 = spark(cast(withCounter(s0, c), 'Test Mutation Boon'), c);
    expect(s1.objects[c]!.damage).toBe(2);
    const s2 = scenario([], { defs, p1: { hand: ['Test Spark'] }, p2: { battlefield: ['Test Plain Bear'] } });
    expect(spark(withCounter(s2, find(s2, 'Test Plain Bear', 'battlefield', 'p2')), find(s2, 'Test Plain Bear', 'battlefield', 'p2')).objects[find(s2, 'Test Plain Bear', 'battlefield', 'p2')]!.damage).toBe(2);
  });
});

describe('CR 603.2d, 510.2: "If a creature you control dealing combat damage to a player causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time." (Felix Five-Boots)', () => {
  const DOUBLER = card('Test Twin Echo', 'Enchantment', 'If a creature you control dealing combat damage to a player causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.');
  const RAIDER = card('Test Raider', 'Creature — Rogue', 'Whenever this creature deals combat damage to a player, you gain 1 life.', { pt: ['2', '2'] });
  const PINGER = card('Test Ember Pinger', 'Creature — Elemental', 'Whenever this creature deals damage to a player, you gain 1 life.\n{0}: This creature deals 1 damage to target player.', { pt: ['1', '1'] });
  const WATCHER = card('Test Watcher', 'Enchantment', 'Whenever a creature you control deals combat damage to a player, you gain 3 life.');
  const defs = [DOUBLER, RAIDER, PINGER, WATCHER];
  const lifeOf = (s: GameState): number => life(s, 'p1');
  it('is fully automated', () => expect(DOUBLER.automation.level).toBe('full'));
  it("its own creature's combat damage trigger happens twice, a trigger of another permanent of yours that reads the same combat damage too (the watcher); the opponent's side is untouched", () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Twin Echo', 'Test Raider', 'Test Watcher'] } });
    const raider = find(s0, 'Test Raider', 'battlefield', 'p1');
    const s1 = attack(s0, [raider]);
    expect(life(s1, 'p2')).toBe(18);
    expect(lifeOf(s1)).toBe(20 + 2 * 1 + 2 * 3);
  });
  it('the negative case: without the doubler each trigger happens once', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Raider', 'Test Watcher'] } });
    const s1 = attack(s0, [find(s0, 'Test Raider', 'battlefield', 'p1')]);
    expect(lifeOf(s1)).toBe(20 + 1 + 3);
  });
  it('a trigger that is caused by the RESULT of the damage (lifelink gain) is not doubled (ruling 2024-04-12, Ajani\'s Pridemate)', () => {
    const LINK = card('Test Lifelinker', 'Creature — Cleric', 'Lifelink', { pt: ['2', '2'] });
    const PRIDE = card('Test Pride', 'Creature — Cat', 'Whenever you gain life, put a +1/+1 counter on this creature.', { pt: ['2', '2'] });
    const s0 = scenario([], { defs: [...defs, LINK, PRIDE], p1: { battlefield: ['Test Twin Echo', 'Test Lifelinker', 'Test Pride'] } });
    const s1 = attack(s0, [find(s0, 'Test Lifelinker', 'battlefield', 'p1')]);
    expect(lifeOf(s1)).toBe(22);
    expect(s1.objects[find(s1, 'Test Pride', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(1); // one gain, one trigger: not caused by dealing damage
  });
  it("noncombat damage to a player is not the cause (the pinger's trigger happens once)", () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Twin Echo', 'Test Ember Pinger'] } });
    const pinger = find(s0, 'Test Ember Pinger', 'battlefield', 'p1');
    const a = legalActivate(s0, pinger);
    let s = act(s0, a);
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
    expect(life(s, 'p2')).toBe(19);
    expect(lifeOf(s)).toBe(21);
  });
});
