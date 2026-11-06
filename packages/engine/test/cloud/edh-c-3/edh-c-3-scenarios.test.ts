/**
 * Commander lane edh-c (EDHREC ranks 16,251-16,875), round edh-c-3: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's
 * default compiler, in 4-player games. CR cites checked against the Comprehensive Rules of 2026-09-25 (media.wizards.com).
 *
 *   CR 115.1, 404.1, 400.3     "Return two target cards from an opponent's graveyard to their hand." (Pulsemage/Spurnmage/Nullmage Advocate: all targets in ONE opponent's graveyard)
 *   CR 205.3m, 613.1d          "Creatures you control are Slivers in addition to their other creature types." (Hivestone), "... and is every creature type" (Arachnoform), "gains X and becomes a Samurai ..."
 *   CR 608.2d, 119.3, 120.2b   "you may have target player lose life equal to ...", "you may have it deal damage to target creature equal to ...", "... equal to its power to you and any target"
 *   CR 601.2f, 115.9b          "Spells that target this creature cost {2} less to cast." (Spellwild Ouphe)
 *   CR 119.7, 611.2a           "Players can't gain life this turn."
 *   CR 604.1, 509.1b           "As long as <condition>, this creature has hexproof and can't be blocked."
 *   CR 615.1a                  "Prevent all damage that would be dealt by enchanted creature." (Temporal Isolation)
 *   CR 500.1, 611.3a           "During turns other than yours, tapped creatures you control have hexproof."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal } from '../../m3/scenario';
import { mpScenario, namesOn, passUntil } from '../../m12/rules/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id }) as TargetChoice;
const pl = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script), script);
const activation = (s: GameState, player: PlayerId, source: ObjectId, index = 0) => legal(s, player, 'activate').filter((a) => a.action.type === 'activate' && a.action.source === source)[index]!.action;
const activate = (s: GameState, source: ObjectId, script: Script = {}, player: PlayerId = 'p1'): GameState => settle(drive(act(s, activation(s, player, source)), script), script);
const count = (s: GameState, p: PlayerId, name: string): number => namesOn(s, p).filter((n) => n === name).length;
const handNames = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);
const yardNames = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const OLD = card('Test Old Relic', 'Artifact', '');
const NEW = card('Test New Relic', 'Artifact', '');
const OTHER = card('Test Other Relic', 'Artifact', '');

describe('CR 115.1, 404.1, 400.3: "Return two target cards from an opponent\'s graveyard to their hand." (all the targets in one opponent\'s graveyard)', () => {
  const ADV = card('Test Grave Hand', 'Creature — Human Cleric', "{T}: Return two target cards from an opponent's graveyard to their hand.", { pt: ['1', '1'] });
  const start = () => mpScenario({ defs: [ADV, OLD, NEW, OTHER], zones: { p1: { battlefield: ['Test Grave Hand'], graveyard: ['Test Other Relic', 'Test Other Relic'] }, p2: { graveyard: ['Test Old Relic', 'Test New Relic'] }, p3: { graveyard: ['Test Old Relic'] }, p4: {} } });
  const yard = (s: GameState, p: PlayerId, name: string): ObjectId => (s.zones.graveyard[p] ?? []).find((id) => s.objects[id]!.defId === name)!;
  it('is automated, and the target spec asks for one owner', () => {
    expect(full(ADV)).toBe(true);
    expect(JSON.stringify(ADV.faces)).toContain('"sameOwner":true');
  });
  it('two cards of one opponent\'s graveyard go to that opponent\'s hand (not yours)', () => {
    const s0 = start();
    const s = activate(s0, find(s0, 'Test Grave Hand', 'battlefield', 'p1'), { targets: [[obj(yard(s0, 'p2', 'Test Old Relic')), obj(yard(s0, 'p2', 'Test New Relic'))]] });
    expect(handNames(s, 'p2').sort()).toEqual(['Test New Relic', 'Test Old Relic']);
    expect(handNames(s, 'p1')).not.toContain('Test Old Relic');
    expect(handNames(s, 'p1')).not.toContain('Test New Relic');
    expect(yardNames(s, 'p2')).toEqual([]);
  });
  it('negative: one card from p2\'s graveyard and one from p3\'s is refused (a single opponent, ruling 2004-10-04)', () => {
    const s0 = start();
    const s1 = act(s0, activation(s0, 'p1', find(s0, 'Test Grave Hand', 'battlefield', 'p1')));
    expect(s1.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s1, { kind: 'chooseTargets', targets: [obj(yard(s0, 'p2', 'Test Old Relic')), obj(yard(s0, 'p3', 'Test Old Relic'))] })).toThrow();
  });
  it('negative: cards of your own graveyard are refused', () => {
    const s0 = start();
    const s1 = act(s0, activation(s0, 'p1', find(s0, 'Test Grave Hand', 'battlefield', 'p1')));
    const [a, b] = findAll(s0, 'Test Other Relic', 'graveyard', 'p1');
    expect(() => answer(s1, { kind: 'chooseTargets', targets: [obj(a!), obj(b!)] })).toThrow();
  });
});

describe('CR 115.1, 404.1: "Exile two target cards from an opponent\'s graveyard." (G10 change: formerly automated cards now ask for one graveyard)', () => {
  const EXILER = card('Test Grave Exiler', 'Creature — Human Rogue', "{T}: Exile two target cards from an opponent's graveyard.", { pt: ['1', '1'] });
  const start = () => mpScenario({ defs: [EXILER, OLD, NEW], zones: { p1: { battlefield: ['Test Grave Exiler'] }, p2: { graveyard: ['Test Old Relic', 'Test New Relic'] }, p3: { graveyard: ['Test Old Relic'] } } });
  const yard = (s: GameState, p: PlayerId, name: string): ObjectId => (s.zones.graveyard[p] ?? []).find((id) => s.objects[id]!.defId === name)!;
  it('two cards of one opponent\'s graveyard are exiled; one from each of two opponents is refused', () => {
    const s0 = start();
    const src = find(s0, 'Test Grave Exiler', 'battlefield', 'p1');
    const s = activate(s0, src, { targets: [[obj(yard(s0, 'p2', 'Test Old Relic')), obj(yard(s0, 'p2', 'Test New Relic'))]] });
    expect(yardNames(s, 'p2')).toEqual([]);
    expect(yardNames(s, 'p3')).toEqual(['Test Old Relic']);
    const s1 = act(s0, activation(s0, 'p1', src));
    expect(() => answer(s1, { kind: 'chooseTargets', targets: [obj(yard(s0, 'p2', 'Test Old Relic')), obj(yard(s0, 'p3', 'Test Old Relic'))] })).toThrow();
  });
});

describe('CR 205.3m, 613.1d: "<group> are Slivers in addition to their other creature types." / "Enchanted creature ... is every creature type" / "gains flying and becomes a Bird in addition to its other creature types"', () => {
  const HIVE = card('Test Hive Relic', 'Artifact', 'Creatures you control are Slivers in addition to their other creature types.');
  const MASK = card('Test Many Masks', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +2/+2, has reach, and is every creature type.');
  const TEACH = card('Test Bird Teacher', 'Creature — Human Monk', '{T}: Put a training counter on target creature. That creature gains flying and becomes a Bird in addition to its other creature types. Activate only as a sorcery.', { pt: ['1', '1'] });
  it('are automated', () => { for (const d of [HIVE, MASK, TEACH]) expect(full(d), d.name).toBe(true); });
  it('your creatures are Slivers and keep their types; an opponent\'s creature is not; the Relic leaving ends it', () => {
    const s = mpScenario({ defs: [HIVE, BEAR, ELF], zones: { p1: { battlefield: ['Test Hive Relic', 'Test Bear'] }, p2: { battlefield: ['Test Elf'] } } });
    const mine = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(getChars(s, mine).subtypes).toEqual(expect.arrayContaining(['Sliver', 'Bear']));
    expect(getChars(s, find(s, 'Test Elf', 'battlefield', 'p2')).subtypes).not.toContain('Sliver');
    expect(getChars(s, find(s, 'Test Hive Relic', 'battlefield', 'p1')).subtypes).not.toContain('Sliver'); // not a creature
    const gone = { ...s, objects: { ...s.objects } } as GameState;
    delete gone.objects[find(s, 'Test Hive Relic', 'battlefield', 'p1')];
    gone.zones = { ...s.zones, battlefield: s.zones.battlefield.filter((id) => id !== find(s, 'Test Hive Relic', 'battlefield', 'p1')) };
    expect(getChars(gone, mine).subtypes).not.toContain('Sliver');
  });
  it('the enchanted creature gets +2/+2 and reach and every creature type (shares a type with an Elf); the Aura\'s creature only', () => {
    const s = mpScenario({ defs: [MASK, BEAR, ELF], zones: { p1: { hand: ['Test Many Masks'], battlefield: ['Test Bear', 'Test Bear'] } } });
    const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
    const t = cast(s, 'Test Many Masks', { targets: [[obj(bears[0]!)]] });
    const c = getChars(t, bears[0]!);
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 4]);
    expect(hasKeyword(getChars(t, bears[0]!), 'reach')).toBe(true);
    expect(c.subtypes.length).toBeGreaterThan(50);
    expect(c.subtypes).toContain('Elf');
    const o = getChars(t, bears[1]!);
    expect([Number(o.power), Number(o.toughness)]).toEqual([2, 2]);
    expect(o.subtypes).not.toContain('Elf');
  });
  it('the ability gives flying and the Bird type for good (no duration), to the chosen creature only', () => {
    const s0 = mpScenario({ defs: [TEACH, BEAR], zones: { p1: { battlefield: ['Test Bird Teacher', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } } });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = activate(s0, find(s0, 'Test Bird Teacher', 'battlefield', 'p1'), { targets: [[obj(mine)]] });
    expect(getChars(s, mine).subtypes).toEqual(expect.arrayContaining(['Bear', 'Bird']));
    expect(hasKeyword(getChars(s, mine), 'flying')).toBe(true);
    expect(s.objects[mine]!.counters['training']).toBe(1);
    const other = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(getChars(s, other).subtypes).not.toContain('Bird');
    const later = passUntil(s, (x) => x.turn.number >= 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'the next turn');
    expect(getChars(later, mine).subtypes).toContain('Bird');
    expect(hasKeyword(getChars(later, mine), 'flying')).toBe(true);
  });
});

describe('CR 608.2d, 119.3: "Whenever this creature or another Ally you control enters, you may have target player lose life equal to the number of Allies you control."', () => {
  const DRAINER = card('Test Ally Drainer', 'Creature — Ogre Ally', 'Whenever this creature or another Ally you control enters, you may have target player lose life equal to the number of Allies you control.', { pt: ['1', '1'] });
  const MATE = card('Test Ally Mate', 'Creature — Human Ally', '', { pt: ['1', '1'] });
  const start = () => mpScenario({ defs: [DRAINER, MATE], zones: { p1: { hand: ['Test Ally Drainer', 'Test Ally Mate'], battlefield: ['Test Ally Mate'] } } });
  it('is automated', () => expect(full(DRAINER)).toBe(true));
  it('counts the Allies as it resolves (two Allies after the Drainer enters: 2 life) and the player chosen as the target loses it', () => {
    const s = cast(start(), 'Test Ally Drainer', { yes: [true], targets: [[pl('p3')]] });
    expect(lifeOf(s, 'p3')).toBe(18);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('another Ally entering triggers it too (3 Allies: 3 life); a non-Ally does not', () => {
    let s = cast(start(), 'Test Ally Drainer', { yes: [true], targets: [[pl('p3')]] });
    s = cast(s, 'Test Ally Mate', { yes: [true], targets: [[pl('p3')]] });
    expect(lifeOf(s, 'p3')).toBe(15);
  });
  it('negative: "may": declining loses no life', () => {
    const s = cast(start(), 'Test Ally Drainer', { yes: [false], targets: [[pl('p3')]] });
    expect(lifeOf(s, 'p3')).toBe(20);
  });
});

describe('CR 608.2d, 120.3, 120.2b: "you may have this creature deal damage to target creature equal to ..." and "... have it deal damage equal to its power to you and any target"', () => {
  const PYRO = card('Test Ally Pyro', 'Creature — Human Shaman Ally', 'Whenever this creature or another Ally you control enters, you may have this creature deal damage to target creature equal to the number of Allies you control.', { pt: ['2', '2'] });
  const RECK = card('Test Reckless', 'Creature — Human Warrior', 'When this creature enters, you may have it deal damage equal to its power to you and any target.', { pt: ['3', '3'] });
  const FODDER = card('Test Fodder', 'Creature — Ox', '', { pt: ['1', '5'] });
  it('are automated', () => { expect(full(PYRO)).toBe(true); expect(full(RECK)).toBe(true); });
  it('the Pyromancer deals damage equal to the Allies you control to the chosen creature; declining deals none', () => {
    const start = () => mpScenario({ defs: [PYRO, FODDER], zones: { p1: { hand: ['Test Ally Pyro'] }, p2: { battlefield: ['Test Fodder'] } } });
    const fodder = (s: GameState) => find(s, 'Test Fodder', 'battlefield', 'p2');
    expect(cast(start(), 'Test Ally Pyro', { yes: [true], targets: [[obj(fodder(start()))]] }).objects[fodder(start())]!.damage).toBe(1);
    expect(cast(start(), 'Test Ally Pyro', { yes: [false], targets: [[obj(fodder(start()))]] }).objects[fodder(start())]!.damage).toBe(0);
  });
  it('the damage equal to its power goes to you and to the target together (3 to you, 3 to an opponent); declining deals none', () => {
    const start = () => mpScenario({ defs: [RECK], zones: { p1: { hand: ['Test Reckless'] } } });
    const s = cast(start(), 'Test Reckless', { yes: [true], targets: [[pl('p2')]] });
    expect(lifeOf(s, 'p1')).toBe(17);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p3')).toBe(20);
    const n = cast(start(), 'Test Reckless', { yes: [false], targets: [[pl('p2')]] });
    expect([lifeOf(n, 'p1'), lifeOf(n, 'p2')]).toEqual([20, 20]);
  });
});

describe('CR 601.2f, 115.9b: "Spells that target this creature cost {2} less to cast."', () => {
  const OUPHE = card('Test Pebble Ouphe', 'Creature — Ouphe', 'Spells that target this creature cost {2} less to cast.', { pt: ['1', '1'] });
  const PUMP = card('Test Pump', 'Instant', 'Target creature gets +1/+1 until end of turn.', { cost: '{2}{W}' });
  const castable = (s: GameState, name: string, player: PlayerId): boolean => legal(s, player, 'cast').some((a) => a.action.type === 'cast' && s.objects[a.action.card]?.defId === name);
  it('is automated', () => expect(full(OUPHE)).toBe(true));
  it('a spell that targets the Ouphe (any player\'s) costs {2} less: castable with one Plains; one that targets another creature is not castable', () => {
    const s0 = mpScenario({ defs: [OUPHE, PUMP, BEAR], zones: { p1: { hand: ['Test Pump'], battlefield: ['Plains', 'Test Pebble Ouphe', 'Test Bear'] }, p2: { hand: ['Test Pump'] } } });
    const ouphe = find(s0, 'Test Pebble Ouphe', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pump', 'hand', 'p1') });
    expect(s1.pending?.kind).toBe('chooseTargets');
    const s2 = drive(answer(s1, { kind: 'chooseTargets', targets: [obj(ouphe)] }));
    expect(s2.zones.stack).toHaveLength(1); // paid with the single Forest: {2}{W} - {2} = {W}
    const t1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pump', 'hand', 'p1') });
    const t2 = answer(t1, { kind: 'chooseTargets', targets: [obj(bear)] });
    expect(() => drive(t2)).toThrow(/pay|mana|cost/i); // {2}{W} with one Plains: the payment fails
    expect(castable(s0, 'Test Pump', 'p2')).toBe(false); // p2 has no mana at all
  });
});

describe('CR 119.7, 611.2a: "Players can\'t gain life this turn."', () => {
  const FAMINE = card('Test Famine Rite', 'Instant', "Players can't gain life this turn.");
  const SIP = card('Test Sip', 'Instant', 'You gain 3 life.');
  it('is automated', () => expect(full(FAMINE)).toBe(true));
  it('nobody gains life after it resolves, this turn; without it life is gained', () => {
    const start = () => mpScenario({ defs: [FAMINE, SIP], zones: { p1: { hand: ['Test Famine Rite', 'Test Sip'] }, p2: { hand: ['Test Sip'] } } });
    let s = cast(start(), 'Test Famine Rite');
    s = cast(s, 'Test Sip');
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(lifeOf(cast(start(), 'Test Sip'), 'p1')).toBe(23);
  });
  it('ends with the turn: next turn the active player gains life again', () => {
    const start = () => mpScenario({ defs: [FAMINE, SIP], zones: { p1: { hand: ['Test Famine Rite'] }, p2: { hand: ['Test Sip'] } } });
    let s = cast(start(), 'Test Famine Rite');
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's turn");
    s = cast(s, 'Test Sip', {}, 'p2');
    expect(lifeOf(s, 'p2')).toBe(23);
  });
});

describe('CR 604.1, 509.1b: "As long as <condition>, this creature has hexproof and can\'t be blocked."', () => {
  const SCOUND = card('Test Sly Rogue', 'Creature — Human Rogue', "As long as you control a Dog, this creature has hexproof and can't be blocked.", { pt: ['2', '2'] });
  const PET = card('Test Pet', 'Creature — Dog', '', { pt: ['1', '1'] });
  const canBlock = (s0: GameState, attacker: ObjectId): boolean => {
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending?.kind !== 'declareAttackers'; guard++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker, defender: 'p2' as PlayerId }] });
    for (let guard = 0; guard < 40 && s.pending?.kind === 'priority' && s.turn.step !== 'end'; guard++) s = act(s, { type: 'pass', player: s.pending.player });
    const d = s.pending;
    if (!d || d.kind !== 'declareBlockers') return false;
    return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: find(s, 'Test Bear', 'battlefield', d.player), attacker }] } }).error === undefined;
  };
  it('is automated', () => expect(full(SCOUND)).toBe(true));
  it('with the Pet: hexproof and unblockable; without it: neither (blockable)', () => {
    const withPet = mpScenario({ defs: [SCOUND, PET, BEAR], zones: { p1: { battlefield: ['Test Sly Rogue', 'Test Pet'] }, p2: { battlefield: ['Test Bear'] } } });
    const rogue = find(withPet, 'Test Sly Rogue', 'battlefield', 'p1');
    expect(hasKeyword(getChars(withPet, rogue), 'hexproof')).toBe(true);
    expect(canBlock(withPet, rogue)).toBe(false);
    const without = mpScenario({ defs: [SCOUND, PET, BEAR], zones: { p1: { battlefield: ['Test Sly Rogue'] }, p2: { battlefield: ['Test Bear'] } } });
    const r2 = find(without, 'Test Sly Rogue', 'battlefield', 'p1');
    expect(hasKeyword(getChars(without, r2), 'hexproof')).toBe(false);
    expect(canBlock(without, r2)).toBe(true);
  });
});

describe('CR 615.1a, 303.4: "Prevent all damage that would be dealt by enchanted creature."', () => {
  const ISO = card('Test Stasis Aura', 'Enchantment — Aura', 'Enchant creature\nPrevent all damage that would be dealt by enchanted creature.');
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 3 damage to target creature.', { colors: ['R'] });
  it('is automated', () => expect(full(ISO)).toBe(true));
  it('damage the enchanted creature would deal is prevented (a creature fight-style source), while other creatures still deal damage', () => {
    const BITE = card('Test Bite', 'Sorcery', 'Target creature you control deals damage equal to its power to target creature you don\'t control.');
    const start = () => mpScenario({ defs: [ISO, BITE, BEAR, ELF], zones: { p1: { hand: ['Test Bite', 'Test Stasis Aura'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Elf'] } } });
    let s = start();
    const bears = findAll(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Stasis Aura', { targets: [[obj(bears[0]!)]] });
    const elf = find(s, 'Test Elf', 'battlefield', 'p2');
    const prevented = cast(s, 'Test Bite', { targets: [[obj(bears[0]!)], [obj(elf)]] });
    expect(prevented.objects[elf]!.damage).toBe(0);
    const allowed = cast(s, 'Test Bite', { targets: [[obj(bears[1]!)], [obj(elf)]] });
    expect(allowed.zones.battlefield.includes(elf) ? allowed.objects[elf]!.damage : 99).toBeGreaterThan(0);
  });
});

describe('CR 615.1a, 301.5 (engine fix, isSet "attachedTo"): "If a source would deal damage to equipped creature, prevent 2 of that damage." (Shield of the Realm wording, formerly never applied)', () => {
  const SHIELD = card('Test Shield Plate', 'Artifact \u2014 Equipment', 'If a source would deal damage to equipped creature, prevent 2 of that damage.\nEquip {0}');
  const ZAP3 = card('Test Zap Three', 'Instant', 'Test Zap Three deals 3 damage to target creature.');
  it('is automated', () => expect(full(SHIELD)).toBe(true));
  it('damage to the equipped creature is reduced by 2; an unequipped creature takes all 3', () => {
    const s0 = mpScenario({ defs: [SHIELD, ZAP3, BEAR], zones: { p1: { hand: ['Test Zap Three', 'Test Zap Three'], battlefield: ['Test Shield Plate', 'Test Bear', 'Test Bear'] } } });
    const bears = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const plate = find(s0, 'Test Shield Plate', 'battlefield', 'p1');
    const eq = settle(drive(act(s0, activation(s0, 'p1', plate)), { targets: [[obj(bears[0]!)]] }));
    expect(eq.objects[plate]!.attachedTo).toBe(bears[0]);
    const hit = cast(eq, 'Test Zap Three', { targets: [[obj(bears[0]!)]] });
    expect(hit.objects[bears[0]!]!.damage).toBe(1);
    const other = cast(eq, 'Test Zap Three', { targets: [[obj(bears[1]!)]] });
    expect(other.zones.battlefield.includes(bears[1]!)).toBe(false); // 3 damage kills the unequipped 2/2
  });
});

describe('CR 500.1, 611.3a, 702.11b: "During turns other than yours, tapped creatures you control have hexproof."', () => {
  const INN = card('Test Night Inn', 'Creature — Human Peasant', 'During turns other than yours, tapped creatures you control have hexproof.', { pt: ['1', '1'] });
  it('is automated', () => expect(full(INN)).toBe(true));
  it('on an opponent\'s turn a tapped creature of yours has hexproof, an untapped one does not; on your own turn neither does', () => {
    const s0 = mpScenario({ defs: [INN, BEAR], zones: { p1: { battlefield: ['Test Night Inn', { name: 'Test Bear', tapped: true }, 'Test Bear'] } } });
    const bears = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const tapped = bears.find((id) => s0.objects[id]!.tapped)!;
    const untapped = bears.find((id) => !s0.objects[id]!.tapped)!;
    expect(hasKeyword(getChars(s0, tapped), 'hexproof')).toBe(false); // p1's own turn
    const s = passUntil(s0, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's turn");
    expect(hasKeyword(getChars(s, tapped), 'hexproof')).toBe(true);
    expect(hasKeyword(getChars(s, untapped), 'hexproof')).toBe(false);
  });
});
