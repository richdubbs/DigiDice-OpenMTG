/**
 * std-rl (precon round L): the round's keyword expansions and its static template, played through the engine with synthetic cards compiled by the game's
 * default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 *
 *   CR 702.149a  training: whenever it and at least one other creature with greater power attack, a +1/+1 counter on it (not with an equal-power partner, not alone)
 *   CR 702.63a   vanishing N: enters with N time counters; your upkeep: if it has one, remove one; when the last is removed, sacrifice it
 *   CR 702.81a   retrace: cast it from your graveyard by discarding a land card in addition to its other costs; it goes back to the graveyard (not exiled)
 *   CR 613.4c    "Equipped creature gets +X/+X, where X is ..." (sta.stdrl.attached.pump.whereX): X counted continuously; nothing when unattached
 *   CR 601.3     "Cast ~ only if <condition>" (rst.stdrl.cast.self.onlyIf): offered only while the condition holds; "another spell" is a spell cast before it
 *   CR 305.1, 205.3i  "You may play Islands from your graveyard" (sta.stdrl.graveyard.landType): an Island is offered from there, a Plains is not
 *   CR 609.4, 611.2a  "<group> can attack this turn as though they didn't have defender" (eff.stdrl.group.attack.nodefender): the group may attack; others not
 *   CR 701.23a   "Target player searches their library for a basic land card, puts it onto the battlefield tapped, then shuffles" (eff.stdrl.player.searches.bf.tapped)
 *   CR 707.2, 111.4  "Create two tapped tokens that are copies of ~" (eff.stdrl.copy.tokens.tapped)
 *   CR 614.1a, 122.6  "that many plus one +1/+1 counters are put on that permanent instead" (rep.m6.counters.plus): one more counter, also on a noncreature permanent
 *   CR 122.1     "put +1/+1 counters on target creature equal to <amount>" (eff.stdrl.counters.put.equalTo)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, life, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { passUntil } from '../../m4/helpers';
import { attackWith, card, cast, counters, full, inYard, named, pt, resolveAll, settle } from '../cmd3/helpers';

const RECRUIT = card('Test Recruit', 'Creature — Human Soldier', 'Training', ['1', '1']);
const BRUTE = card('Test Brute', 'Creature — Ogre', '', ['3', '3']);
const TWIN = card('Test Twin', 'Creature — Human', '', ['1', '1']);
const MIRAGE = card('Test Mirage', 'Creature — Illusion', 'Vanishing 2', ['4', '4']);
const MENDING = card('Test Mending', 'Sorcery', 'You gain 3 life.\nRetrace', undefined, '{W}');
const ROD = card('Test Rod', 'Artifact — Equipment', 'Equipped creature gets +X/+X, where X is the number of Plains you control.\nEquip {0}');
const BOX = card('Test Box', 'Artifact', '');
const ORACLE = card('Test Oracle', 'Sorcery', 'Cast ~ only if you control two or more Wizards.\nDraw two cards.', undefined, '{0}');
const ECHO = card('Test Echo', 'Creature — Bird', "Flying\nCast ~ only if you've cast another spell this turn.", ['2', '2'], '{0}');
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', ['1', '1']);
const PING = card('Test Ping', 'Instant', 'You gain 1 life.', undefined, '{0}');
const TIDECALLER = card('Test Tidecaller', 'Creature — Merfolk', 'You may play Islands from your graveyard.', ['1', '1']);
const WALL = card('Test Wall', 'Creature — Wall', 'Defender', ['0', '4']);
const HORN = card('Test Horn', 'Artifact', '{0}: Creatures you control with defender can attack this turn as though they didn\'t have defender.');
const SEEKER = card('Test Seeker', 'Sorcery', 'Target player searches their library for a basic land card, puts it onto the battlefield tapped, then shuffles.', undefined, '{0}');
const IDOL = card('Test Idol', 'Artifact', '{0}, Sacrifice this artifact: Create two tapped tokens that are copies of ~.');
const SCALES = card('Test Scales', 'Enchantment', 'If one or more +1/+1 counters would be put on an artifact you control, that many plus one +1/+1 counters are put on that permanent instead.');
const BLESSING = card('Test Blessing', 'Sorcery', 'Put +1/+1 counters on target creature equal to the number of Plains you control.', undefined, '{0}');
const OILER = card('Test Oiler', 'Sorcery', 'Put a +1/+1 counter on target artifact.', undefined, '{0}');
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', ['1', '1']);
const SHRINE = card('Test Shrine', 'Enchantment', 'Instant and sorcery cards in your graveyard have retrace.');
const DEFS = [SHRINE, RECRUIT, BRUTE, TWIN, MIRAGE, MENDING, ROD, BOX, ORACLE, ECHO, WIZARD, PING, TIDECALLER, WALL, HORN, SEEKER, IDOL, SCALES, BLESSING, OILER, GOLEM];
const TALE = compileCard({ name: 'Test Tale // Test Detour', layout: 'adventure', mana_cost: '{0} // {0}', type_line: 'Sorcery // Sorcery — Adventure', colors: [], oracle_text: '',
  card_faces: [{ name: 'Test Tale', mana_cost: '{0}', type_line: 'Sorcery', oracle_text: 'Cast this spell only if you control two or more Wizards.\nDraw two cards.' }, { name: 'Test Detour', mana_cost: '{0}', type_line: 'Sorcery — Adventure', oracle_text: 'You gain 2 life.' }] } as unknown as OracleCard);
DEFS.push(TALE);
const handCasts = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'hand').map((a) => a.label);

const gyCasts = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'graveyard').map((a) => a.label);

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 702.149a: training', () => {
  const attack = (others: string[]): { s: GameState; recruit: ObjectId } => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Recruit', ...others] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const recruit = find(s, 'Test Recruit', 'battlefield');
    const ids = [recruit, ...others.map((n) => find(s, n, 'battlefield'))];
    s = resolveAll(attackWith(s, ids));
    return { s, recruit };
  };
  it('attacking with a creature of greater power puts a +1/+1 counter on it', () => {
    const { s, recruit } = attack(['Test Brute']);
    expect(counters(s, recruit, '+1/+1')).toBe(1);
    expect(pt(s, recruit)).toBe('2/2');
  });
  it('a partner of equal power is not enough (greater, not equal)', () => {
    const { s, recruit } = attack(['Test Twin']);
    expect(counters(s, recruit, '+1/+1')).toBe(0);
  });
  it('attacking alone gives nothing', () => {
    const { s, recruit } = attack([]);
    expect(counters(s, recruit, '+1/+1')).toBe(0);
  });
});

describe('CR 702.63a: vanishing', () => {
  it('enters with two time counters; the next upkeep removes one; the one after removes the last and it is sacrificed', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Mirage'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Mirage'));
    const mirage = find(s, 'Test Mirage', 'battlefield');
    expect(counters(s, mirage, 'time')).toBe(2);
    s = resolveAll(passUntil(advanceTo(s, 3, 'upkeep'), (x) => x.zones.stack.length > 0, 'the vanishing trigger'));
    expect(counters(s, mirage, 'time')).toBe(1);
    expect(named(s, 'Test Mirage')).toEqual([mirage]);
    s = resolveAll(passUntil(advanceTo(s, 5, 'upkeep'), (x) => x.zones.stack.length > 0, 'the vanishing trigger'));
    expect(named(s, 'Test Mirage')).toEqual([]);
    expect(inYard(s, 'Test Mirage')).toBe(true);
  });
  it("only in its controller's upkeep, never the opponent's", () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Mirage'] }, defs: DEFS });
    s = resolveAll(cast(s, 'Test Mirage'));
    s = advanceTo(s, 2, 'draw');
    expect(counters(s, find(s, 'Test Mirage', 'battlefield'), 'time')).toBe(2);
  });
});

describe('CR 702.81a: retrace', () => {
  it('cast from the graveyard by discarding a land card; it resolves and goes back to the graveyard', () => {
    let s = scenario(['Plains'], { p1: { graveyard: ['Test Mending'], hand: ['Plains'], battlefield: ['Plains'] }, defs: DEFS });
    expect(gyCasts(s)).toEqual(['Cast Test Mending']);
    const before = life(s, 'p1');
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mending', 'graveyard') })));
    expect(life(s, 'p1')).toBe(before + 3);
    expect(s.zones.hand['p1']!.filter((id) => s.objects[id]!.zone === 'hand')).toHaveLength(0); // the land was discarded
    expect(inYard(s, 'Test Mending')).toBe(true); // CR 702.81a: no exile, unlike flashback
  });
  it('a granted retrace (CR 613.1f: "cards in your graveyard have retrace") works the same; without the grant the card is not offered', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Shrine'], graveyard: ['Test Ping'], hand: ['Plains'] }, defs: DEFS });
    expect(gyCasts(s)).toEqual(['Cast Test Ping']);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ping', 'graveyard') })));
    expect(s.zones.hand['p1']!).toHaveLength(0); // the land was discarded for it
    const without = scenario(['Plains'], { p1: { graveyard: ['Test Ping'], hand: ['Plains'] }, defs: DEFS });
    expect(gyCasts(without)).toEqual([]);
  });
  it('without a land card in hand it is not offered', () => {
    const s = scenario(['Plains'], { p1: { graveyard: ['Test Mending'], hand: ['Test Box'], battlefield: ['Plains'] }, defs: DEFS });
    expect(gyCasts(s)).toEqual([]);
  });
});

describe('CR 613.4c: "Equipped creature gets +X/+X, where X is the number of Plains you control"', () => {
  it('the equipped creature gets +N/+N for N Plains, counted as the board changes; an unequipped creature gets nothing', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Rod', 'Test Twin', 'Test Brute', 'Plains', 'Plains'], hand: ['Plains'] }, defs: DEFS });
    const twin = find(s, 'Test Twin', 'battlefield');
    const brute = find(s, 'Test Brute', 'battlefield');
    const equip = legalActions(s, 'p1').find((a) => a.kind === 'activate' && /Equip/.test(a.label))!;
    s = resolveAll(settle(act(s, equip.action), { targets: [{ kind: 'object', id: twin }] }), { targets: [{ kind: 'object', id: twin }] });
    expect(pt(s, twin)).toBe('3/3');
    expect(pt(s, brute)).toBe('3/3');
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Plains', 'hand') });
    expect(pt(s, twin)).toBe('4/4');
  });
});

describe('CR 601.3: "Cast ~ only if <condition>"', () => {
  it('two or more Wizards: offered with two, not with one', () => {
    const one = scenario(['Plains'], { p1: { hand: ['Test Oracle'], battlefield: ['Test Wizard'] }, defs: DEFS });
    expect(handCasts(one)).not.toContain('Cast Test Oracle');
    const two = scenario(['Plains'], { p1: { hand: ['Test Oracle'], battlefield: ['Test Wizard', 'Test Wizard'] }, defs: DEFS });
    expect(handCasts(two)).toContain('Cast Test Oracle');
  });
  it('"another spell this turn": not before a spell was cast this turn, then offered', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Echo', 'Test Ping'] }, defs: DEFS });
    expect(handCasts(s)).not.toContain('Cast Test Echo');
    s = resolveAll(cast(s, 'Test Ping'));
    expect(handCasts(s)).toContain('Cast Test Echo');
  });
});

describe('CR 715.3: the restriction of the main half of an adventurer card', () => {
  it('without two Wizards the Adventure half can still be cast; the main half cannot', () => {
    const s = scenario(['Plains'], { p1: { hand: ['Test Tale // Test Detour'] }, defs: DEFS });
    expect(full(TALE)).toBe(true);
    const casts = handCasts(s);
    expect(casts.some((l) => /Detour/.test(l)), casts.join('; ')).toBe(true);
    expect(casts).toEqual(['Cast Test Detour']);
    const two = scenario(['Plains'], { p1: { hand: ['Test Tale // Test Detour'], battlefield: ['Test Wizard', 'Test Wizard'] }, defs: DEFS });
    expect(handCasts(two).sort()).toEqual(['Cast Test Detour', 'Cast Test Tale']);
  });
});

describe('CR 305.1, 205.3i: "You may play Islands from your graveyard"', () => {
  it('an Island in your graveyard can be played; a Plains cannot', () => {
    let s = scenario(['Plains', 'Island'], { p1: { battlefield: ['Test Tidecaller'], graveyard: ['Island', 'Plains'] }, defs: DEFS });
    const lands = legalActions(s, 'p1').filter((a) => a.kind === 'playLand' && s.objects[a.object!]?.zone === 'graveyard');
    expect(lands.map((a) => s.defs[s.objects[a.object!]!.defId]!.name)).toEqual(['Island']);
    s = act(s, lands[0]!.action);
    expect(named(s, 'Island')).toHaveLength(1);
  });
});

describe('CR 609.4, 611.2a: "Creatures you control with defender can attack this turn as though they didn\'t have defender"', () => {
  it('after the ability resolves the Wall may attack this turn; without it, it may not', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Wall', 'Test Horn'] }, defs: DEFS });
    s = advanceTo(s, 3, 'main1');
    const wall = find(s, 'Test Wall', 'battlefield');
    expect(() => attackWith(s, [wall])).toThrow(); // CR 702.3b: no creature able to attack, so no declaration is offered
    const horn = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === find(s, 'Test Horn', 'battlefield'))!;
    s = resolveAll(settle(act(s, horn.action)));
    const after = attackWith(s, [wall]);
    expect(after.combat?.attackers.some((a) => a.id === wall)).toBe(true);
  });
});

describe('CR 701.23a: "Target player searches their library for a basic land card, puts it onto the battlefield tapped, then shuffles"', () => {
  it('the opponent targeted puts a basic land onto the battlefield tapped under their control', () => {
    let s = scenario(['Plains', 'Island'], { p1: { hand: ['Test Seeker'] }, p2: { library: ['Island'] }, defs: DEFS });
    const before = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').length;
    s = cast(s, 'Test Seeker', { targets: [{ kind: 'player', id: 'p2' }] });
    for (let guard = 0; s.zones.stack.length > 0 && guard < 10; guard++) {
      s = s.pending?.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: (s.pending as unknown as { options: ObjectId[] }).options.slice(0, 1) }) : pass(s); // the searcher finds a card
    }
    const theirs = s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2');
    expect(theirs).toHaveLength(before + 1);
    expect(s.objects[theirs[theirs.length - 1]!]!.tapped).toBe(true);
  });
});

describe('CR 707.2, 111.4: "Create two tapped tokens that are copies of ~"', () => {
  it('two tapped token copies of the artifact as it last existed', () => {
    let s = scenario(['Plains'], { p1: { battlefield: ['Test Idol'] }, defs: DEFS });
    const idol = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === find(s, 'Test Idol', 'battlefield'))!;
    s = resolveAll(settle(act(s, idol.action)));
    const copies = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && getChars(s, id)!.name === 'Test Idol');
    expect(copies).toHaveLength(2);
    for (const id of copies) expect(s.objects[id]!.tapped).toBe(true);
  });
});

describe('CR 614.1a, 122.6: "that many plus one +1/+1 counters are put on that permanent instead"', () => {
  it('a +1/+1 counter put on your artifact becomes two; on a creature that is not an artifact it stays one', () => {
    let s = scenario(['Plains'], { p1: { hand: ['Test Oiler', 'Test Blessing'], battlefield: ['Test Scales', 'Test Golem', 'Test Twin', 'Plains'] }, defs: DEFS });
    const golem = find(s, 'Test Golem', 'battlefield');
    const twin = find(s, 'Test Twin', 'battlefield');
    s = resolveAll(cast(s, 'Test Oiler', { targets: [{ kind: 'object', id: golem }] }));
    expect(counters(s, golem, '+1/+1')).toBe(2);
    s = resolveAll(cast(s, 'Test Blessing', { targets: [{ kind: 'object', id: twin }] }));
    expect(counters(s, twin, '+1/+1')).toBe(1); // CR 122.1: one Plains, one counter, not an artifact
  });
});
