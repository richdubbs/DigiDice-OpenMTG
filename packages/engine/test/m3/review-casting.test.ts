/**
 * Fixes from the milestone 3 review: casting, resolution and compilation. Each test is named after the rule it checks.
 * Real cards come from the fixture; rules no real card exercises yet use synthetic cards (synthetic.ts).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, hasKeyword, isSummoningSick, type CardDef, type GameState, type OracleCard } from '../../src/index';
import { clone } from '../../src/util/clone';
import { compiledDef, nativeDef, withNativeLines } from '../fixtures';
import { act, advanceTo, answer, castAuto, find, labels, legal, life, pass, passBoth, pool, reject, scenario, zoneNames } from './scenario';
import { activated, keyword, spellAbility, synth, targetCreature } from './synthetic';

const NAME_OMEN = 'Cunning Azurescale // Divining Dive';
const manual = (s: GameState, ops: object[] = []): GameState => answer(s, { kind: 'manualResolve', ops: ops as never });
const stackIds = (s: GameState): string[] => s.zones.stack;

describe('Omen spells (CR 720) are not Adventures (CR 715)', () => {
  it('CR 720.3d: an Omen spell is shuffled into its owner\'s library as it resolves, not exiled', () => {
    let s = scenario([NAME_OMEN, 'Island'], { p1: { hand: [NAME_OMEN], battlefield: ['Island', 'Island'] } });
    s = castAuto(s, NAME_OMEN, { face: 1 });
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    s = manual(s);
    expect(zoneNames(s, 'library', 'p1')).toContain(NAME_OMEN);
    expect(s.zones.exile).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
    expect(Object.values(s.objects).some((o) => o.chosen?.onAdventure === true)).toBe(false);
    expect(labels(s, 'p1').filter((l) => /from exile/.test(l))).toEqual([]);
    expect(s.log.some((e) => e.rules?.includes('CR 720.3d'))).toBe(true);
  });

  it('CR 715.3d: a real Adventure (Bonecrusher Giant // Stomp) is still exiled "on an adventure" and can be cast as the creature', () => {
    const name = 'Bonecrusher Giant // Stomp';
    let s = scenario([name, 'Mountain'], { p1: { hand: [name], battlefield: Array(6).fill('Mountain') }, manual: [name] });
    s = castAuto(s, name, { face: 1 });
    s = passBoth(s);
    s = manual(s);
    expect(s.zones.exile).toHaveLength(1);
    expect(s.objects[s.zones.exile[0]!]!.chosen).toEqual({ onAdventure: true });
    expect(labels(s, 'p1')).toContain('Cast Bonecrusher Giant from exile');
  });
});

describe('a spell that fizzles never resolved (CR 608.2b)', () => {
  const adventure = (): CardDef => {
    const raw: OracleCard = {
      name: 'Test Adv // Test Spell', layout: 'adventure', type_line: 'Creature — Giant // Instant — Adventure',
      card_faces: [
        { name: 'Test Adv', type_line: 'Creature — Giant', mana_cost: '{1}{R}', power: '2', toughness: '2', oracle_text: '' },
        { name: 'Test Spell', type_line: 'Instant — Adventure', mana_cost: '{R}', oracle_text: '(synthetic)' },
      ],
    } as OracleCard;
    return compileCard(raw, (face) => (face.name === 'Test Spell' ? { abilities: [spellAbility('Target creature.', [targetCreature])], unsupported: [] } : { abilities: [], unsupported: [] }));
  };
  const dummy = synth({ name: 'Dummy', cost: '{1}', type: 'Creature', pt: ['1', '1'], abilities: [] });

  it('CR 608.2b, 715.3d: an Adventure whose targets are all illegal goes to the graveyard, not to exile', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Adv // Test Spell'], battlefield: ['Mountain', 'Mountain'] }, p2: { battlefield: ['Dummy'] }, defs: [adventure(), dummy] });
    s = castAuto(s, 'Test Adv // Test Spell', { face: 1, answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Dummy', 'battlefield') }] }] });
    const t = clone(s); // the target disappears before the spell resolves
    const dummyId = find(t, 'Dummy', 'battlefield');
    t.zones.battlefield = t.zones.battlefield.filter((id) => id !== dummyId);
    delete t.objects[dummyId];
    s = passBoth(t);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Adv // Test Spell']);
    expect(s.zones.exile).toEqual([]);
    expect(labels(s, 'p1').filter((l) => /from exile/.test(l))).toEqual([]);
    expect(s.log.some((e) => e.rules?.includes('CR 608.2b'))).toBe(true);
  });

  it('CR 715.3d: the same Adventure that resolves is exiled on an adventure', () => {
    let s = scenario(['Mountain'], { p1: { hand: ['Test Adv // Test Spell'], battlefield: ['Mountain', 'Mountain'] }, p2: { battlefield: ['Dummy'] }, defs: [adventure(), dummy] });
    s = castAuto(s, 'Test Adv // Test Spell', { face: 1, answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Dummy', 'battlefield') }] }] });
    s = passBoth(s);
    expect(s.zones.exile).toHaveLength(1);
    expect(s.objects[s.zones.exile[0]!]!.chosen).toEqual({ onAdventure: true });
  });
});

describe('Aftermath (CR 702.127a)', () => {
  const NAME = 'Commit // Memory';
  const lands = Array(6).fill('Island');

  it('CR 702.127a: the Aftermath half can\'t be cast from the hand; the other half can', () => {
    // (r4-refs: Commit is automated now, "put target spell or nonland permanent into its owner's library second from the top", so it needs a legal target to
    // be cast, CR 601.2c: Bob's creature)
    const s = scenario([NAME, 'Island', 'Grizzly Bears'], { p1: { hand: [NAME], battlefield: lands }, p2: { battlefield: ['Grizzly Bears'] } });
    expect(labels(s, 'p1')).toContain('Cast Commit');
    expect(labels(s, 'p1')).not.toContain('Cast Memory');
    const err = reject(s, { type: 'cast', player: 'p1', card: find(s, NAME, 'hand'), face: 1 });
    expect(err.rules).toContain('CR 702.127a');
  });

  it('CR 702.127a: from the graveyard only the Aftermath half can be cast, and it is exiled after resolving', () => {
    // std-rn: Memory ("Each player shuffles their hand and graveyard into their library, then draws seven cards") is automated now; this test is about the
    // aftermath cast, so its text is kept manual (as the Fuse tests below)
    let s = scenario([NAME, 'Island'], { p1: { graveyard: [NAME], battlefield: lands }, manual: [NAME] });
    expect(labels(s, 'p1')).toContain('Cast Memory');
    expect(labels(s, 'p1')).not.toContain('Cast Commit');
    reject(s, { type: 'cast', player: 'p1', card: find(s, NAME, 'graveyard'), face: 0 });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, NAME, 'graveyard'), face: 1 });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(s.zones.stack).toHaveLength(1);
    s = passBoth(s);
    s = manual(s);
    expect(s.zones.exile).toHaveLength(1);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
    expect(s.objects[s.zones.exile[0]!]!.chosen).toBeUndefined(); // exiled, not "on an adventure"
  });
});

describe('Fuse (CR 702.102)', () => {
  const NAME = 'Wear // Tear';

  it('CR 702.102a-c: a split card with fuse may be cast as both halves from the hand, paying both costs, with combined characteristics', () => {
    // WP18: Wear and Tear are automated now (each needs a target); these tests are about the fused cast, so their text is kept manual.
    let s = scenario([NAME, 'Mountain', 'Plains'], { p1: { hand: [NAME], battlefield: ['Mountain', 'Mountain', 'Plains'] }, manual: [NAME] });
    expect(labels(s, 'p1')).toEqual(expect.arrayContaining(['Cast Wear', 'Cast Tear', 'Cast Wear // Tear (fused)']));
    s = act(s, { type: 'cast', player: 'p1', card: find(s, NAME, 'hand'), method: 'fuse' });
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{1}{R}{W}' });
    s = answer(s, { kind: 'payCost', auto: true });
    const c = getChars(s, stackIds(s)[0]!);
    expect(c.name).toBe('Wear // Tear');
    expect(c.manaValue).toBe(3);
    expect([...c.colors].sort()).toEqual(['R', 'W']);
    s = passBoth(s);
    s = manual(s); // 702.102d: the left half, then the right half
    s = manual(s);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([NAME]);
  });

  it('CR 702.102a: no fused cast from the graveyard, for a split card without fuse, or for a half cast alone', () => {
    const inGrave = scenario([NAME, 'Mountain', 'Plains'], { p1: { graveyard: [NAME], battlefield: ['Mountain', 'Mountain', 'Plains'] }, manual: [NAME] });
    expect(labels(inGrave, 'p1').filter((l) => /fused/.test(l))).toEqual([]);
    expect(reject(inGrave, { type: 'cast', player: 'p1', card: find(inGrave, NAME, 'graveyard'), method: 'fuse' }).rules).toContain('CR 702.102a');
    const fire = scenario(['Fire // Ice', 'Mountain', 'Island'], { p1: { hand: ['Fire // Ice'], battlefield: ['Mountain', 'Mountain', 'Island', 'Island'] }, manual: ['Fire // Ice'] });
    expect(labels(fire, 'p1').filter((l) => /fused/.test(l))).toEqual([]);
    expect(reject(fire, { type: 'cast', player: 'p1', card: find(fire, 'Fire // Ice', 'hand'), method: 'fuse' }).rules).toContain('CR 702.102a');
    // A fused cast needs both costs: Wear {1}{R} + Tear {W}.
    const poor = scenario([NAME, 'Mountain'], { p1: { hand: [NAME], battlefield: ['Mountain', 'Mountain'] }, manual: [NAME] });
    expect(labels(poor, 'p1')).toContain('Cast Wear');
    expect(labels(poor, 'p1').filter((l) => /fused/.test(l))).toEqual([]);
  });
});

describe('alternative and optional costs', () => {
  const flashbackX = (): CardDef =>
    synth({
      name: 'Test DP', cost: '{X}{R}', type: 'Sorcery',
      abilities: [spellAbility('Nothing.'), keyword('flashback', { mana: [{ kind: 'variable', name: 'X' }, { kind: 'colored', color: 'R' }, { kind: 'colored', color: 'R' }, { kind: 'colored', color: 'R' }] })],
    });

  it('CR 107.3, 702.34a: X in a flashback cost is announced and paid (Devil\'s Play)', () => {
    let s = scenario(['Mountain'], { p1: { graveyard: ['Test DP'], battlefield: Array(6).fill('Mountain') }, defs: [flashbackX()] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test DP', 'graveyard'), method: 'flashback' });
    expect(s.pending).toMatchObject({ kind: 'chooseNumber', min: 0, max: 3 });
    s = answer(s, { kind: 'chooseNumber', n: 2 });
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{2}{R}{R}{R}' });
    s = answer(s, { kind: 'payCost', auto: true });
    expect(s.objects[stackIds(s)[0]!]!.stack!.x).toBe(2);
  });

  it('CR 107.3: if the flashback cost has no X the X of the mana cost is 0', () => {
    const plain = synth({
      name: 'Test Flash X', cost: '{X}{R}', type: 'Sorcery',
      abilities: [spellAbility('Nothing.'), keyword('flashback', { mana: [{ kind: 'colored', color: 'R' }] })],
    });
    let s = scenario(['Mountain'], { p1: { graveyard: ['Test Flash X'], battlefield: Array(3).fill('Mountain') }, defs: [plain] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Flash X', 'graveyard'), method: 'flashback' });
    expect(s.pending).toMatchObject({ kind: 'payCost', costText: '{R}' });
  });

  it('CR 601.2b, 118.3: the kicker question is only asked when the kicked spell could be paid', () => {
    const kick = synth({ name: 'Test Kick', cost: '{R}', type: 'Instant', abilities: [spellAbility('Nothing.'), keyword('kicker', { mana: [{ kind: 'generic', amount: 4 }] })] });
    let poor = scenario(['Mountain'], { p1: { hand: ['Test Kick'], battlefield: ['Mountain'] }, defs: [kick] });
    poor = act(poor, { type: 'cast', player: 'p1', card: find(poor, 'Test Kick', 'hand') });
    expect(poor.pending).toMatchObject({ kind: 'payCost', costText: '{R}' });
    expect(poor.suspended!.base.log.length).toBeLessThanOrEqual(poor.log.length);
    expect(poor.log.some((e) => /can't pay the kicker/.test(e.text))).toBe(true);
    let rich = scenario(['Mountain'], { p1: { hand: ['Test Kick'], battlefield: Array(5).fill('Mountain') }, defs: [kick] });
    rich = act(rich, { type: 'cast', player: 'p1', card: find(rich, 'Test Kick', 'hand') });
    expect(rich.pending).toMatchObject({ kind: 'yesNo' });
    rich = answer(rich, { kind: 'yesNo', yes: true });
    expect(rich.pending).toMatchObject({ kind: 'payCost', costText: '{4}{R}' }); // CMDF: canonical order (CR 107.4, 202.1)
    expect(rich.pending).toMatchObject({ autoPayable: true });
  });
});

describe('casting restrictions (CR 601.3)', () => {
  it('CR 601.3: "Cast this spell only during combat." is enforced (Angelic Favor)', () => {
    // WP18 review (D14): the renderer cannot print this restriction yet, so the milestone 4 recognizer's reading drives this engine test (nativeDef)
    let s = scenario(['Plains'], { defs: [nativeDef('Angelic Favor')], p1: { hand: ['Angelic Favor'], battlefield: Array(5).fill('Plains') } });
    expect(labels(s, 'p1')).not.toContain('Cast Angelic Favor');
    expect(reject(s, { type: 'cast', player: 'p1', card: find(s, 'Angelic Favor', 'hand') }).rules).toContain('CR 601.3');
    s = advanceTo(s, 1, 'beginCombat');
    expect(labels(s, 'p1')).toContain('Cast Angelic Favor');
    expect(castAuto(s, 'Angelic Favor').zones.stack).toHaveLength(1);
  });

  it('CR 601.3: timing restrictions that name a turn ("only during an opponent\'s turn") are enforced', () => {
    const raw = (text: string): OracleCard => ({ name: 'Test Timing', layout: 'normal', type_line: 'Instant', mana_cost: '{W}', oracle_text: text }) as OracleCard;
    const def = withNativeLines(raw('Cast this spell only during an opponent\'s turn.\nDraw a card.')); // WP18 review (D14): see nativeDef
    expect(def.faces[0]!.abilities.map((a) => a.kind)).toEqual(['static', 'spell']); // WP18: "Draw a card." is automated now
    let s = scenario([], { p1: { hand: ['Test Timing'], battlefield: ['Plains'] }, defs: [def] });
    expect(labels(s, 'p1')).not.toContain('Cast Test Timing');
    s = advanceTo(s, 2, 'upkeep');
    s = pass(s);
    expect(labels(s, 'p1')).toContain('Cast Test Timing');
  });

  it('docs/ARCHITECTURE.md "never silently skip": a restriction the engine can\'t check is shown when the spell is cast', () => {
    const def = compileCard({ name: 'Test Cond', layout: 'normal', type_line: 'Instant', mana_cost: '{W}', oracle_text: 'Cast this spell only if you were dealt damage this turn by a red instant or sorcery spell.\nDraw a card.' } as OracleCard);
    let s = scenario([], { p1: { hand: ['Test Cond'], battlefield: ['Plains'] }, defs: [def] });
    s = castAuto(s, 'Test Cond');
    const warn = s.log.filter((e) => e.level === 'manual' && /casting restriction/.test(e.text));
    expect(warn).toHaveLength(1);
    expect(warn[0]!.text).toContain('Cast this spell only if you were dealt damage this turn by a red instant or sorcery spell.');
  });
});

describe('split second (CR 702.61)', () => {
  it('CR 702.61a-b: while Sudden Shock is on the stack nobody can cast spells or activate non-mana abilities, but mana abilities are fine', () => {
    // WP18: both spells' damage is automated now; split second is the subject, so their effects are kept manual (the keyword stays automated)
    let s = scenario(['Sudden Shock', 'Lightning Bolt', 'Mountain'], { p1: { hand: ['Sudden Shock'], battlefield: ['Mountain', 'Mountain'] }, p2: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, manual: ['Sudden Shock', 'Lightning Bolt'] });
    s = castAuto(s, 'Sudden Shock');
    s = pass(s); // p2 receives priority
    expect(s.pending!.player).toBe('p2');
    expect(labels(s, 'p2')).not.toContain('Cast Lightning Bolt');
    expect(labels(s, 'p2').some((l) => /Mountain/.test(l))).toBe(true);
    expect(reject(s, { type: 'cast', player: 'p2', card: find(s, 'Lightning Bolt', 'hand', 'p2') }).rules).toContain('CR 702.61a');
    s = act(s, { type: 'activate', player: 'p2', source: find(s, 'Mountain', 'battlefield', 'p2'), ability: 'r:basic:R' });
    expect(pool(s, 'p2')).toBe('R');
    s = passBoth(s); // p2 passes, then p1: Sudden Shock resolves
    s = manual(s);
    expect(s.zones.stack).toEqual([]);
  });

  it('CR 702.61a: activated abilities that aren\'t mana abilities are stopped too', () => {
    const pinger = synth({ name: 'Test Pinger', cost: '{1}', type: 'Artifact', abilities: [activated('{0}: ping.', {})] });
    let s = scenario(['Sudden Shock', 'Mountain'], { p1: { hand: ['Sudden Shock'], battlefield: ['Mountain', 'Mountain', 'Test Pinger'] }, defs: [pinger], manual: ['Sudden Shock'] });
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana)).toHaveLength(1);
    s = castAuto(s, 'Sudden Shock');
    expect(legal(s, 'p1', 'activate').filter((a) => !a.isMana)).toEqual([]);
    expect(reject(s, { type: 'activate', player: 'p1', source: find(s, 'Test Pinger', 'battlefield'), ability: 'p:0:0' }).rules).toContain('CR 702.61a');
  });
});

describe('planeswalkers and battles enter with counters (CR 306.5b, 310.4b)', () => {
  it('CR 306.5b: a planeswalker enters with loyalty counters equal to its printed loyalty', () => {
    let s = scenario(['Jace Beleren', 'Island'], { p1: { hand: ['Jace Beleren'], battlefield: Array(3).fill('Island') } });
    s = castAuto(s, 'Jace Beleren');
    s = passBoth(s);
    expect(s.objects[find(s, 'Jace Beleren', 'battlefield')]!.counters.loyalty).toBe(3);
    expect(s.log.some((e) => e.rules?.includes('CR 306.5b'))).toBe(true);
  });

  it('CR 310.4b: a battle enters with defense counters equal to its printed defense', () => {
    const name = 'Invasion of Ergamon // Truga Cliffcharger';
    let s = scenario([name, 'Mountain', 'Forest'], { p1: { hand: [name], battlefield: ['Mountain', 'Forest'] } });
    s = castAuto(s, name);
    s = passBoth(s);
    expect(s.objects[find(s, name, 'battlefield')]!.counters.defense).toBe(5);
  });

  it('CR 606.4: a loyalty ability with a minus cost can be activated on the turn the planeswalker enters', () => {
    const walker = compileCard(
      { name: 'Test Walker', layout: 'normal', type_line: 'Planeswalker — Test', mana_cost: '{3}', loyalty: '3', oracle_text: '(synthetic)' } as OracleCard,
      () => ({ abilities: [activated('-2: Do a thing.', { loyalty: -2 }, [], { isLoyalty: true })], unsupported: [] }),
    );
    let s = scenario([], { p1: { hand: ['Test Walker'], battlefield: Array(3).fill('Plains') }, defs: [walker] });
    s = castAuto(s, 'Test Walker');
    s = passBoth(s);
    expect(legal(s, 'p1', 'activate')).toHaveLength(1);
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Walker', 'battlefield'), ability: 'p:0:0' });
    expect(s.objects[find(s, 'Test Walker', 'battlefield')]!.counters.loyalty).toBe(1);
  });

  it('CR 306.5b: also when it is put onto the battlefield by hand', () => {
    const bolt = scenario(['Lightning Bolt', 'Jace Beleren', 'Mountain'], { p1: { hand: ['Lightning Bolt'], graveyard: ['Jace Beleren'], battlefield: ['Mountain'] }, manual: ['Lightning Bolt'] });
    let s = castAuto(bolt, 'Lightning Bolt');
    s = passBoth(s);
    s = manual(s, [{ op: 'move', object: find(s, 'Jace Beleren', 'graveyard'), to: 'battlefield' }]);
    expect(s.objects[find(s, 'Jace Beleren', 'battlefield')]!.counters.loyalty).toBe(3);
  });
});

describe('keyword lines with several keywords (CR 702.10, 702.8)', () => {
  it('CR 702.10b: "Flying, haste" gives the creature haste, so it isn\'t summoning sick (Akoum Firebird, Glorybringer)', () => {
    for (const name of ['Akoum Firebird', 'Glorybringer']) {
      const s = scenario([name], { p1: { battlefield: [{ name, since: 1 }] } });
      const o = s.objects[find(s, name, 'battlefield')]!;
      const c = getChars(s, o.id);
      expect(hasKeyword(c, 'haste'), name).toBe(true);
      expect(isSummoningSick(s, o, c), name).toBe(false);
      // Milestone 4 understands "Flying" too; the other text of Glorybringer stays manual (std-sos and cloud std-woe: Akoum Firebird's landfall return from the
      // graveyard is automated now, CR 113.6m)
      expect(hasKeyword(c, 'flying'), name).toBe(true);
      expect(c.abilities.some((a) => a.def.kind === 'manual'), name).toBe(name === 'Glorybringer');
    }
  });

  it('CR 702.10b: "First strike, haste" (Ash Zealot) and any order of keywords', () => {
    const def = compiledDef('Ash Zealot');
    // WP18: keyword abilities are in printed order (milestone 4 put the keywords it learned after the ones milestone 3 knew)
    expect(def.faces[0]!.abilities.filter((a) => a.kind === 'keyword').map((a) => (a as { keyword: string }).keyword)).toEqual(['first strike', 'haste']);
    const t = compileCard({ name: 'T', layout: 'normal', type_line: 'Creature — Dragon', mana_cost: '{R}', power: '1', toughness: '1', oracle_text: 'Haste, trample, flash' } as OracleCard);
    expect(t.faces[0]!.abilities.filter((a) => a.kind === 'keyword').map((a) => (a as { keyword: string }).keyword)).toEqual(['haste', 'trample', 'flash']);
  });

  it('CR 702.8a: "Flash, flying" lets the creature be cast at instant speed', () => {
    const def = compileCard({ name: 'Test Flash Flyer', layout: 'normal', type_line: 'Creature — Bird', mana_cost: '{W}', power: '1', toughness: '1', oracle_text: 'Flash, flying' } as OracleCard);
    expect(def.faces[0]!.abilities.map((a) => a.kind)).toEqual(['keyword', 'keyword']);
    let s = scenario([], { p1: { hand: ['Test Flash Flyer'], battlefield: ['Plains'] }, defs: [def] });
    s = advanceTo(s, 1, 'beginCombat');
    expect(labels(s, 'p1')).toContain('Cast Test Flash Flyer');
  });

  it('sentences that merely contain the word "haste" are not keyword lines', () => {
    const def = compileCard({ name: 'T', layout: 'normal', type_line: 'Sorcery', mana_cost: '{R}', oracle_text: 'Target creature gains haste, flying until end of turn.' } as OracleCard);
    expect(def.faces[0]!.abilities.map((a) => a.kind)).toEqual(['manual']);
  });
});

describe('manual resolution never crashes the engine (docs/ARCHITECTURE.md principle 4)', () => {
  const bolt = (): GameState => {
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: ['Mountain'] }, manual: ['Lightning Bolt'] });
    s = castAuto(s, 'Lightning Bolt');
    return passBoth(s);
  };
  const answerOps = (s: GameState, ops: object[]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'manualResolve' as const, ops: ops as never } });

  it('CR 608.2n: the resolving spell can\'t be moved by hand: the answer is rejected and the decision stays', () => {
    const s = bolt();
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    const resolving = stackIds(s)[0]!;
    const err = reject(s, answerOps(s, [{ op: 'move', object: resolving, to: 'graveyard' }]));
    expect(err.message).toMatch(/being resolved/);
    // The decision is still pending and a legal answer works.
    const done = manual(s, [{ op: 'note', text: 'ok' }]);
    expect(zoneNames(done, 'graveyard', 'p1')).toEqual(['Lightning Bolt']);
  });

  it('the resolving ability can\'t be moved either', () => {
    const pinger = synth({ name: 'Test Pinger', cost: '{1}', type: 'Artifact', abilities: [activated('{0}: ping.', {}, [], {}, [{ op: 'ping' }])] });
    let s = scenario([], { p1: { battlefield: ['Test Pinger'] }, defs: [pinger] });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Pinger', 'battlefield'), ability: 'p:0:0' });
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    reject(s, answerOps(s, [{ op: 'move', object: stackIds(s)[0]!, to: 'exile' }]));
    s = manual(s);
    expect(s.zones.stack).toEqual([]);
  });

  it('invalid zones, unknown objects and players, and malformed operations are IllegalActions, not crashes', () => {
    const s = bolt();
    const mountain = find(s, 'Mountain', 'battlefield');
    for (const op of [
      { op: 'move', object: mountain, to: 'nonsense' },
      { op: 'move', object: 'o99999', to: 'hand' },
      { op: 'life', player: 'nobody', delta: 1 },
      { op: 'life', player: 'p1', delta: 1.5 },
      { op: 'draw', player: 'p9', count: 1 },
      { op: 'tap', object: mountain },
      { op: 'mana', player: 'p1', types: ['X'] },
      { op: 'mana', player: 'p1', types: [] },
      { op: 'teleport' },
      null,
    ]) {
      expect(() => reject(s, answerOps(s, [op as never])), JSON.stringify(op)).not.toThrow();
    }
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
  });

  it('a second operation on an object an earlier operation already moved is rejected cleanly', () => {
    const s = bolt();
    const mountain = find(s, 'Mountain', 'battlefield');
    reject(s, answerOps(s, [{ op: 'move', object: mountain, to: 'hand' }, { op: 'tap', object: mountain, tapped: true }]));
  });
});

describe('mana added by hand (CR 106.3)', () => {
  it('CR 106.3: a spell that adds mana can be resolved by hand with a mana operation (Dark Ritual)', () => {
    // W3b: the default compiler reads "Add {B}{B}{B}." now (next test); resolution by hand is the subject here, so the text is kept manual
    let s = scenario(['Dark Ritual', 'Swamp'], { p1: { hand: ['Dark Ritual'], battlefield: ['Swamp'] }, manual: ['Dark Ritual'] });
    s = castAuto(s, 'Dark Ritual');
    s = passBoth(s);
    expect(s.pending).toMatchObject({ kind: 'manualResolve', text: 'Add {B}{B}{B}.' });
    s = manual(s, [{ op: 'mana', player: 'p1', types: ['B', 'B', 'B'] }]);
    expect(pool(s, 'p1')).toBe('BBB');
    expect(s.log.some((e) => e.level === 'manual' && /adds \{B\}\{B\}\{B\}/.test(e.text))).toBe(true);
    s = passBoth(s); // CR 500.5: it empties at the end of the step
    expect(pool(s, 'p1')).toBe('');
  });

  it('W3b, CR 106.3, 608.2: Dark Ritual compiled by the default compiler adds {B}{B}{B} as it resolves (no manual prompt)', () => {
    let s = scenario(['Dark Ritual', 'Swamp'], { p1: { hand: ['Dark Ritual'], battlefield: ['Swamp'] } });
    s = castAuto(s, 'Dark Ritual');
    s = passBoth(s);
    expect(s.pending?.kind).toBe('priority');
    expect(pool(s, 'p1')).toBe('BBB');
  });

  it('CR 106.3: loyalty abilities and other non-mana abilities that add mana work the same way', () => {
    // W2 merge: WP13 performs a real addMana step itself, so the step the players resolve by hand is a manual one (design 8.9).
    const ritual = synth({ name: 'Test Ritual', cost: '{B}', type: 'Instant', abilities: [spellAbility('Add {B}{B}{B}.', [], [{ op: 'manual', text: 'Add {B}{B}{B}.', reason: 'resolved by hand in this test' }])] });
    let s = scenario(['Swamp'], { p1: { hand: ['Test Ritual'], battlefield: ['Swamp'] }, defs: [ritual] });
    s = castAuto(s, 'Test Ritual');
    s = passBoth(s);
    s = manual(s, [{ op: 'mana', player: 'p1', types: ['B', 'B', 'B'], snow: true }]);
    expect(s.players[0]!.manaPool.map((u) => [u.type, u.snow])).toEqual([['B', true], ['B', true], ['B', true]]);
  });
});

describe('mana abilities the recognizer rejects can be activated by hand (CR 605.3b)', () => {
  // CMD5: a pain land's "This land deals 1 damage to you." is automated now (cloud/cmd5/cmd5-mana.test.ts); a mana ability with another instruction beside
  // the mana ("Each opponent gains 1 life.", invented wording) is still one the player activates by hand
  const GROVE = compileCard({ name: 'Test Gift Grove', layout: 'normal', mana_cost: '', type_line: 'Land', oracle_text: '{T}: Add {C}.\n{T}: Add {R} or {G}. Each opponent gains 1 life.', colors: [] } as OracleCard);
  it('Test Gift Grove: the ability with a rider is its own manual ability, offered as a mana action', () => {
    const def = GROVE;
    expect(def.faces[0]!.abilities.map((a) => a.kind)).toEqual(['activated', 'manual']);
    expect(def.faces[0]!.abilities[1]).toMatchObject({ kind: 'manual', mana: true });
    const s = scenario([], { defs: [GROVE], p1: { battlefield: ['Test Gift Grove'] } });
    const byHand = legal(s, 'p1', 'activate').filter((a) => /by hand/.test(a.label));
    expect(byHand).toHaveLength(1);
    expect(byHand[0]!.isMana).toBe(true);
  });

  it('activating it pays {T}, then the player adds the mana and applies the rider by hand; cancelling undoes it', () => {
    let s = scenario([], { defs: [GROVE], p1: { battlefield: ['Test Gift Grove'] } });
    const forest = find(s, 'Test Gift Grove', 'battlefield');
    const start = s;
    s = act(s, { type: 'activate', player: 'p1', source: forest, ability: 'p:0:1' });
    expect(s.pending).toMatchObject({ kind: 'manualResolve', cancellable: true });
    expect(s.objects[forest]!.tapped).toBe(true);
    const cancelled = act(s, { type: 'cancel', player: 'p1' });
    expect(cancelled.objects[forest]!.tapped).toBe(false);
    expect(pool(cancelled, 'p1')).toBe('');
    s = manual(s, [{ op: 'mana', player: 'p1', types: ['R'] }, { op: 'life', player: 'p2', delta: 1 }]);
    expect(pool(s, 'p1')).toBe('R');
    expect(life(s, 'p2')).toBe(21);
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    // It can't be activated again: the land is tapped.
    expect(legal(s, 'p1', 'activate').filter((a) => /by hand/.test(a.label))).toEqual([]);
    void start;
  });
});
