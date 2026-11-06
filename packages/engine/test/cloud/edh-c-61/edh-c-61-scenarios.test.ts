/**
 * Commander lane edh-c, round edh-c-61 (second pass of EDHREC ranks 25,501 to 26,000): the round's readings played through the engine with synthetic cards (invented
 * names), compiled by the game's default compiler. Alice (p1) casts or controls the card under test. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 120.1, 120.3        "deals 2 damage to each creature dealt damage this turn" (Inflame); "creature that has been dealt damage this turn" (Giant Shark)
 *   CR 120.4a, 120.10      "Excess damage is dealt to that creature's controller instead." (Pigment Storm)
 *   CR 701.8a, 700.4       "deals X plus 3 damage to you, where X is the number of creatures that died this way" (Hellfire)
 *   CR 400.3, 700.4        "return to your hand all creature cards that were put into your graveyard from the battlefield this turn" (Fell Shepherd)
 *   CR 401.4, 701.24a      "Put ~ and target creature on top of their owners' libraries, then those players shuffle their libraries." (Void Stalker)
 *   CR 701.23a, 701.20a    "Search your library and graveyard for a card named X (both zones are always searched), reveal it, put it into your hand, then shuffle." (Verdant Crescendo)
 *   CR 604.2, 613.4c       "gets +1/+1 for each black permanent your opponents control as long as there are seven or more cards in your graveyard" (Nantuko Blightcutter)
 */
import { describe, expect, it } from 'vitest';
import { activatedAbilities, compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, put, scenario } from '../../m3/scenario';
import { card, cast, full, pt, resolveAll, settle } from '../cmd3/helpers';

const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: string): string[] => s.zones[zone][p]!.map((id) => s.objects[id]!.defId).filter((n) => n !== 'Plains');
const onBf = (s: GameState, p: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.objects[id]!.defId);

/** A card with a color (the shared helper makes colorless ones). */
const colored = (name: string, type: string, text: string, color: string, p?: [string, string], cost = '{0}'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [color], ...(p ? { power: p[0], toughness: p[1] } : {}) } as OracleCard);

const hasLifelink = (s: GameState, id: ObjectId): boolean => getChars(s, id)!.keywords.some((k) => (k as { keyword?: string }).keyword === 'lifelink');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{1}');
const PING = card('Test Ping', 'Instant', 'Test Ping deals 1 damage to target creature.');

describe('CR 120.1, 120.3: "deals 2 damage to each creature dealt damage this turn"', () => {
  const FLARE = card('Test Flare', 'Sorcery', 'Test Flare deals 2 damage to each creature dealt damage this turn.');
  const DEFS: CardDef[] = [FLARE, PING, BEAR, OGRE];
  it('is automated', () => expect(full(FLARE)).toBe(true));
  it('only the creatures already dealt damage this turn take the damage, whoever controls them', () => {
    let s = scenario([], { p1: { hand: ['Test Flare', 'Test Ping'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const mineOgre = find(s, 'Test Ogre', 'battlefield', 'p1');
    const theirOgre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Ping', { targets: [obj(theirOgre)] }));
    s = resolveAll(cast(s, 'Test Flare'));
    expect(s.zones.battlefield).not.toContain(theirOgre); // 1 from the Ping, 2 from the Flare: 3 damage kills the 3/3
    expect(names(s, 'graveyard', 'p2')).toContain('Test Ogre');
    expect(s.objects[mineOgre]!.damage).toBe(0); // never dealt damage before the Flare
    expect(s.objects[bear]!.damage).toBe(0);
  });
  it('negative: with no creature dealt damage this turn nothing happens', () => {
    let s = scenario([], { p1: { hand: ['Test Flare'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Flare'));
    expect(s.objects[find(s, 'Test Ogre', 'battlefield', 'p2')]!.damage).toBe(0);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.damage).toBe(0);
  });
});

describe('CR 120.1, 509.1: "Whenever ~ blocks or becomes blocked by a creature that has been dealt damage this turn, ~ gets +2/+0 and gains trample until end of turn"', () => {
  const SHARK = card('Test Shark', 'Creature — Fish', "Whenever this creature blocks or becomes blocked by a creature that has been dealt damage this turn, this creature gets +2/+0 and gains trample until end of turn.", ['3', '3'], '{1}');
  const DEFS: CardDef[] = [SHARK, PING, BEAR, OGRE];
  it('is automated', () => expect(full(SHARK)).toBe(true));
  it('the Shark blocking a creature dealt damage this turn gets +2/+0 and trample; blocking an undamaged creature it does not', () => {
    const run = (ping: boolean): string => {
      let s = scenario([], { p1: { hand: ['Test Ping'], battlefield: ['Test Ogre', 'Test Bear'] }, p2: { battlefield: ['Test Shark'] }, defs: DEFS });
      s = advanceTo(s, 3, 'main1');
      const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
      const shark = find(s, 'Test Shark', 'battlefield', 'p2');
      if (ping) s = resolveAll(cast(s, 'Test Ping', { targets: [obj(ogre)] }));
      s = resolveAll(attackAndBlock(s, ogre, shark));
      return pt(s, shark);
    };
    expect(run(true)).toBe('5/3');
    expect(run(false)).toBe('3/3');
  });
});

import { declareAttackers, declareBlockers, toDeclareAttackers } from '../../m4/helpers';
function attackAndBlock(s0: GameState, attacker: ObjectId, blocker: ObjectId): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
  for (let i = 0; i < 20; i++) {
    const d = s.pending as { kind: string } | undefined;
    if (d?.kind === 'declareBlockers') return declareBlockers(s, [[blocker, attacker]]);
    s = pass(s);
  }
  return s;
}

describe('CR 120.4a, 120.10: "Test Storm deals 5 damage to target creature. Excess damage is dealt to that creature\'s controller instead."', () => {
  const STORM = card('Test Storm', 'Instant', "Test Storm deals 5 damage to target creature. Excess damage is dealt to that creature's controller instead.", undefined, '{0}');
  const DEFS: CardDef[] = [STORM, BEAR, OGRE];
  it('is automated', () => expect(full(STORM)).toBe(true));
  it('damage beyond what the creature needs to die goes to its controller, not to the creature', () => {
    let s = scenario([], { p1: { hand: ['Test Storm'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const before = life(s, 'p2');
    s = resolveAll(cast(s, 'Test Storm', { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p2'))] }));
    expect(onBf(s, 'p2')).not.toContain('Test Bear'); // lethal damage 2
    expect(life(s, 'p2')).toBe(before - 3); // the excess 3
  });
  it('a creature that already has damage marked needs less: the excess grows by that damage', () => {
    let s = scenario([], { p1: { hand: ['Test Storm', 'Test Ping'] }, p2: { battlefield: ['Test Ogre'] }, defs: [...DEFS, PING] });
    s = advanceTo(s, 3, 'main1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const before = life(s, 'p2');
    s = resolveAll(cast(s, 'Test Ping', { targets: [obj(ogre)] }));
    s = resolveAll(cast(s, 'Test Storm', { targets: [obj(ogre)] }));
    expect(life(s, 'p2')).toBe(before - 3); // 3/3 with 1 marked: lethal is 2, the other 3 is excess
  });
  it('negative: damage that does not exceed what the creature needs is all dealt to the creature', () => {
    const SMALL = card('Test Spark', 'Instant', "Test Spark deals 2 damage to target creature. Excess damage is dealt to that creature's controller instead.", undefined, '{0}');
    let s = scenario([], { p1: { hand: ['Test Spark'] }, p2: { battlefield: ['Test Ogre'] }, defs: [SMALL, OGRE] });
    s = advanceTo(s, 3, 'main1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const before = life(s, 'p2');
    s = resolveAll(cast(s, 'Test Spark', { targets: [obj(ogre)] }));
    expect(life(s, 'p2')).toBe(before);
    expect(s.objects[ogre]!.damage).toBe(2);
  });
});

describe('CR 701.8a, 700.4: "Test Fire deals X plus 3 damage to you, where X is the number of creatures that died this way."', () => {
  const FIRE = card('Test Fire', 'Sorcery', 'Destroy all nonblack creatures. Test Fire deals X plus 3 damage to you, where X is the number of creatures that died this way.', undefined, '{0}');
  const BLACK = colored('Test Ghoul', 'Creature — Zombie', '', 'B', ['1', '1'], '{B}');
  const TOUGH = card('Test Golem', 'Artifact Creature — Golem', 'Indestructible', ['2', '2'], '{2}');
  const DEFS: CardDef[] = [FIRE, BEAR, OGRE, BLACK, TOUGH];
  it('is automated', () => expect(full(FIRE)).toBe(true));
  it('counts only the creatures that died: the black one and the indestructible one stay and are not counted', () => {
    let s = scenario([], { p1: { hand: ['Test Fire'], battlefield: ['Test Bear', 'Test Golem'] }, p2: { battlefield: ['Test Ogre', 'Test Ghoul'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const before = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Fire'));
    expect(onBf(s, 'p1')).toEqual(['Test Golem']);
    expect(onBf(s, 'p2')).toEqual(['Test Ghoul']);
    expect(life(s, 'p1')).toBe(before - 5); // two died: 2 + 3
  });
  it('Hellfire ruling 2009-10-01: a creature a replacement effect exiled instead was destroyed but did not die, so it is not counted', () => {
    const VACUUM = card('Test Vacuum', 'Enchantment', 'If a creature would die, exile it instead.', undefined, '{0}');
    let s = scenario([], { p1: { hand: ['Test Fire'], battlefield: ['Test Bear', 'Test Vacuum'] }, p2: { battlefield: ['Test Ogre'] }, defs: [...DEFS, VACUUM] });
    s = advanceTo(s, 3, 'main1');
    const before = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Fire'));
    expect(onBf(s, 'p1')).toEqual(['Test Vacuum']);
    expect(s.zones.exile.length).toBeGreaterThanOrEqual(2); // both creatures were exiled
    expect(life(s, 'p1')).toBe(before - 3); // none died: X is 0
  });
  it('negative: when nothing dies it is 3 damage', () => {
    let s = scenario([], { p1: { hand: ['Test Fire'] }, p2: { battlefield: ['Test Ghoul'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const before = life(s, 'p1');
    s = resolveAll(cast(s, 'Test Fire'));
    expect(life(s, 'p1')).toBe(before - 3);
  });
});

describe('CR 400.3, 700.4: "return to your hand all creature cards that were put into your graveyard from the battlefield this turn"', () => {
  const SHEPHERD = card('Test Shepherd', 'Creature — Horror', 'Whenever this creature deals combat damage to a player, you may return to your hand all creature cards that were put into your graveyard from the battlefield this turn.', ['2', '2'], '{1}');
  const RAISE = card('Test Raise', 'Sorcery', 'You may return to your hand all creature cards that were put into your graveyard from the battlefield this turn.', undefined, '{0}');
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', undefined, '{0}');
  const DEFS: CardDef[] = [SHEPHERD, RAISE, KILL, BEAR, OGRE];
  it('is automated', () => expect(full(SHEPHERD)).toBe(true));
  it('returns the creature cards that died this turn, not the ones that were already in the graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Raise', 'Test Kill'], battlefield: ['Test Bear'], graveyard: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Kill', { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p1'))] }));
    s = resolveAll(cast(s, 'Test Raise', { yes: true }));
    expect(names(s, 'hand', 'p1')).toEqual(['Test Bear']);
    expect(names(s, 'graveyard', 'p1').sort()).toEqual(['Test Kill', 'Test Ogre', 'Test Raise'].sort());
  });
  it('negative: a creature that died in an opponent\'s graveyard is not yours to return', () => {
    let s = scenario([], { p1: { hand: ['Test Raise', 'Test Kill'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(cast(s, 'Test Kill', { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p2'))] }));
    s = resolveAll(cast(s, 'Test Raise', { yes: true }));
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(names(s, 'graveyard', 'p2')).toEqual(['Test Bear']);
  });
});

describe('CR 401.4, 701.24a: "Put ~ and target creature on top of their owners\' libraries, then those players shuffle their libraries."', () => {
  const STALKER = card('Test Stalker', 'Creature — Specter', "{T}: Put this creature and target creature on top of their owners' libraries, then those players shuffle their libraries.", ['2', '2'], '{1}');
  const DEFS: CardDef[] = [STALKER, BEAR, OGRE];
  it('is automated', () => expect(full(STALKER)).toBe(true));
  it('both the stalker and the target go into their owners\' libraries (the library sizes grow by one each)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Stalker'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const stalker = find(s, 'Test Stalker', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    const libs = [s.zones.library['p1']!.length, s.zones.library['p2']!.length];
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: stalker, ability: activatedAbilities(s, s.objects[stalker]!)[0]!.key }), { targets: [obj(ogre)] });
    expect(onBf(s, 'p1')).not.toContain('Test Stalker');
    expect(onBf(s, 'p2')).not.toContain('Test Ogre');
    expect(s.zones.library['p1']!.length).toBe(libs[0]! + 1);
    expect(s.zones.library['p2']!.length).toBe(libs[1]! + 1);
    expect(s.zones.graveyard['p1']!.length + s.zones.graveyard['p2']!.length).toBe(0); // no graveyard involved
  });
  it("ruling 2012-07-01: if the stalker left the battlefield before the ability resolves, only the target's owner shuffles", () => {
    const KILL = card('Test Kill', 'Instant', 'Destroy target creature.', undefined, '{0}');
    let s = scenario([], { p1: { hand: ['Test Kill'], battlefield: ['Test Stalker'] }, p2: { battlefield: ['Test Ogre'] }, defs: [...DEFS, KILL] });
    s = advanceTo(s, 3, 'main1');
    const stalker = find(s, 'Test Stalker', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = act(s, { type: 'activate', player: 'p1', source: stalker, ability: activatedAbilities(s, s.objects[stalker]!)[0]!.key });
    s = settle(s, { targets: [obj(ogre)] });
    s = cast(s, 'Test Kill', { targets: [obj(stalker)] });
    s = resolveAll(s);
    const shuffles = (s.log as { text?: string; message?: string }[]).map((e) => e.text ?? e.message ?? '').filter((t) => /shuffles/.test(t));
    expect(shuffles).toHaveLength(1);
    expect(shuffles[0]).toMatch(/Bob/);
    expect(names(s, 'graveyard', 'p1')).toContain('Test Stalker');
  });
  it('negative: another creature that is not the target stays on the battlefield', () => {
    let s = scenario([], { p1: { battlefield: ['Test Stalker', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const stalker = find(s, 'Test Stalker', 'battlefield', 'p1');
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: stalker, ability: activatedAbilities(s, s.objects[stalker]!)[0]!.key }), { targets: [obj(find(s, 'Test Ogre', 'battlefield', 'p2'))] });
    expect(onBf(s, 'p1')).toEqual(['Test Bear']);
  });
});

describe('CR 701.23a, 701.20a: "Search your library and graveyard for a card named X (both zones are always searched), reveal it, put it into your hand, then shuffle."', () => {
  const CRESCENDO = card('Test Crescendo', 'Sorcery', 'Search your library and graveyard for a card named Test Ogre, reveal it, put it into your hand, then shuffle.', undefined, '{0}');
  const DEFS: CardDef[] = [CRESCENDO, OGRE, BEAR];
  it('is automated', () => expect(full(CRESCENDO)).toBe(true));
  /** Cast it, let it resolve, search both zones and pick `pick` (undefined: pick nothing). */
  const crescendo = (s0: GameState, pick?: ObjectId): { s: GameState; offered: ObjectId[] } => {
    let s = cast(s0, 'Test Crescendo');
    for (let i = 0; i < 4 && s.pending?.kind === 'priority'; i++) s = pass(s);
    if (pick !== undefined) expect((s.pending as { kind: string }).kind).toBe('chooseObjects'); // both zones are searched at once, no choice of zones (CR 701.23a)
    const offered = ((s.pending as { options?: ObjectId[] } | undefined)?.options ?? []).slice();
    s = resolveAll(s, { objects: pick === undefined ? [] : [pick] });
    return { s, offered };
  };
  it('finds the named card in the graveyard as well as in the library', () => {
    let s = scenario([], { p1: { hand: ['Test Crescendo'], graveyard: ['Test Ogre'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    put(s, 'p1', 'library', 'Test Bear');
    const r = crescendo(s, find(s, 'Test Ogre', 'graveyard', 'p1'));
    expect(names(r.s, 'hand', 'p1')).toEqual(['Test Ogre']);
    expect(names(r.s, 'graveyard', 'p1')).toEqual(['Test Crescendo']);
  });
  it('finds it in the library too, and a card with another name is never offered', () => {
    let s = scenario([], { p1: { hand: ['Test Crescendo'], graveyard: ['Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    put(s, 'p1', 'library', 'Test Ogre');
    const ogre = find(s, 'Test Ogre', 'library', 'p1');
    const r = crescendo(s, ogre);
    expect(r.offered).toEqual([ogre]);
    expect(names(r.s, 'hand', 'p1')).toEqual(['Test Ogre']);
    expect(names(r.s, 'graveyard', 'p1').sort()).toEqual(['Test Bear', 'Test Crescendo']);
  });
  it('negative: with no card of that name anywhere, nothing is put into the hand', () => {
    let s = scenario([], { p1: { hand: ['Test Crescendo'], graveyard: ['Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const r = crescendo(s);
    expect(r.offered).toEqual([]);
    expect(names(r.s, 'hand', 'p1')).toEqual([]);
  });
});

describe('CR 604.2, 613.4c: "~ gets +1/+1 for each black permanent your opponents control as long as there are seven or more cards in your graveyard."', () => {
  const CUTTER = card('Test Cutter', 'Creature — Elemental', 'Protection from black\nThis creature gets +1/+1 for each black permanent your opponents control as long as there are seven or more cards in your graveyard.', ['2', '2'], '{1}');
  const GHOUL = colored('Test Ghoul', 'Creature — Zombie', '', 'B', ['1', '1'], '{B}');
  const BONES = card('Test Bone', 'Artifact', '', undefined, '{0}');
  const DEFS: CardDef[] = [CUTTER, GHOUL, BEAR, BONES];
  it('is automated', () => expect(full(CUTTER)).toBe(true));
  it('grows by the black permanents the opponents control only with seven cards in your graveyard', () => {
    let s = scenario([], { p1: { battlefield: ['Test Cutter'], graveyard: ['Test Bone', 'Test Bone', 'Test Bone', 'Test Bone', 'Test Bone', 'Test Bone'] }, p2: { battlefield: ['Test Ghoul', 'Test Ghoul', 'Test Bear'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const id = find(s, 'Test Cutter', 'battlefield', 'p1');
    expect(pt(s, id)).toBe('2/2'); // six cards: off
    put(s, 'p1', 'graveyard', 'Test Bone');
    expect(pt(s, id)).toBe('4/4'); // seven cards, two black permanents (the Bear is not black)
  });
  it('negative: black permanents you control are not counted', () => {
    let s = scenario([], { p1: { battlefield: ['Test Cutter', 'Test Ghoul'], graveyard: ['Test Bone', 'Test Bone', 'Test Bone', 'Test Bone', 'Test Bone', 'Test Bone', 'Test Bone'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    expect(pt(s, find(s, 'Test Cutter', 'battlefield', 'p1'))).toBe('2/2');
  });
});
