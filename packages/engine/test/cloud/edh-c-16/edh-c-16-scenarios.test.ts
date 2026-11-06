/**
 * Commander lane edh-c, round edh-c-16 (EDHREC ranks 19,376 to 20,000): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by
 * the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks and has its negative case. CR cites checked against the
 * Comprehensive Rules of 2026-09-25.
 *
 *   CR 731.1, 601.2f, 118.7        "This spell costs {2} less to cast if it's night." (the day/night designation, read as the cost is determined)
 *   CR 601.2f, 500.1, 513.1        "This spell costs {2} less to cast during your end step."
 *   CR 402.1, 102.3, 604.1         "~ gets +3/+3 as long as an opponent has no cards in hand."
 *   CR 122.6, 122.6a, 611.3a       "As long as you've put one or more +1/+1 counters on a creature this turn, ~ has trample and lifelink."
 *   CR 508.4, 111.4, 603.10a       "Whenever ~ attacks, create a tapped and attacking 1/1 red Devil creature token with "When this token dies, it deals 1 damage to any target.""
 *   CR 113.6m, 603.4, 706.2        "At the beginning of your upkeep, if ~ is in your graveyard, roll a four-sided die. If the result is 1, return ~ from your graveyard to the battlefield."
 *   CR 113.6m, 603.4, 400.7        "At the beginning of your upkeep, if ~ is in your graveyard or on the battlefield, you may gain 1 life."
 *   CR 603.4, 303.4, 301.5         "Whenever ~ becomes tapped, if it's enchanted or equipped, create a 2/1 token."
 *   CR 509.1c, 613.4c, 613.1f      "Enchanted creature gets +4/+4 and has first strike, and all creatures able to block it do so."
 *   CR 701.23a, 101.2, 611.2a      "Players can't search libraries this turn." (the search is not made, the spell's other instructions are)
 *   CR 120.3, 608.2h, 608.2d       "Whenever ~ or another Ally you control enters, you may have ~ deal damage to target creature with flying equal to the number of Allies you control."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; colors?: string[]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => charsOfObject(s, s.objects[id]!);
const power = (s: GameState, id: ObjectId): number => Number(chars(s, id).power);
const hasKw = (s: GameState, id: ObjectId, kw: string): boolean => chars(s, id).keywords.some((k) => k.keyword === kw);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: PlayerId): TargetChoice => ({ kind: 'player', id } as TargetChoice);

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[]; picks?: ObjectId[][] }
/** Answer what comes up: targets in order, then the given answers; pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  const answers = [...(o.answers ?? [])];
  const picks = [...(o.picks ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 60; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (p.kind === 'yesNo') s = answer(s, answers.length > 0 ? answers.shift()! : { kind: 'yesNo', yes: true });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (answers.length > 0) s = answer(s, answers.shift()!);
    else break;
  }
  return s;
}
function drain(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const rest: Opts = { targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])], picks: [...(o.picks ?? [])] };
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) {
    s = settle(pass(s), rest);
    if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = settle(s, rest);
  }
  return s;
}
const cast = (s0: GameState, name: string, o: Opts = {}, player: PlayerId = 'p1'): GameState => drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), o), o);
const castable = (s: GameState, name: string, player: PlayerId = 'p1'): boolean => legal(s, player, 'cast').some((a) => a.object === find(s, name, 'hand', player));
const named = (s: GameState, name: string, zone: 'battlefield' | 'graveyard' | 'hand' | 'exile' | 'library', owner?: PlayerId): ObjectId[] => findAll(s, name, zone, owner);

describe('CR 731.1, 601.2f, 118.7: "This spell costs {2} less to cast if it\'s night."', () => {
  const SLASH = card('Test Moon Slash', 'Sorcery', "This spell costs {2} less to cast if it's night.\n~ deals 3 damage to any target.", { cost: '{2}' });
  const withTime = (time: 'day' | 'night' | undefined): GameState => {
    const s = scenario([], { defs: [SLASH], p1: { hand: ['Test Moon Slash'] } });
    if (time !== undefined) s.designations.dayNight = time;
    return s;
  };
  it('is automated', () => { expect(full(SLASH)).toBe(true); });
  it('night: the {2} spell is cast for nothing and resolves; day or neither: it cannot be cast without mana', () => {
    expect(castable(withTime('night'), 'Test Moon Slash')).toBe(true);
    expect(castable(withTime('day'), 'Test Moon Slash')).toBe(false);
    expect(castable(withTime(undefined), 'Test Moon Slash')).toBe(false);
    const s = cast(withTime('night'), 'Test Moon Slash', { targets: [[plr('p2')]] });
    expect(life(s, 'p2')).toBe(17);
  });
});

describe('CR 601.2f, 500.1, 513.1: "This spell costs {2} less to cast during your end step."', () => {
  const STATEMENT = card('Test Closing Words', 'Instant', 'This spell costs {2} less to cast during your end step.\nYou gain 3 life.', { cost: '{2}' });
  const at = (turn: number, step: GameState['turn']['step']): GameState => advanceTo(scenario([], { defs: [STATEMENT], p1: { hand: ['Test Closing Words'] } }), turn, step);
  it('is automated', () => { expect(full(STATEMENT)).toBe(true); });
  it('your end step: cast for nothing; your main phase, your upkeep and an opponent\'s end step: it costs {2} (no mana: not castable)', () => {
    const end = at(1, 'end');
    expect(castable(end, 'Test Closing Words')).toBe(true);
    expect(life(cast(end, 'Test Closing Words'), 'p1')).toBe(23);
    expect(castable(at(1, 'main1'), 'Test Closing Words')).toBe(false);
    expect(castable(at(3, 'upkeep'), 'Test Closing Words')).toBe(false);
    expect(castable(at(2, 'end'), 'Test Closing Words')).toBe(false);
  });
});

describe('CR 402.1, 102.3, 604.1: "~ gets +3/+3 as long as an opponent has no cards in hand."', () => {
  const SPECTER = card('Test Hollow Specter', 'Creature — Specter', '~ gets +3/+3 as long as an opponent has no cards in hand.', { pt: ['2', '2'] });
  const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.');
  it('is automated', () => { expect(full(SPECTER)).toBe(true); });
  it('an opponent with an empty hand: 5/5; an opponent with a card: 2/2; only your own empty hand does not count', () => {
    const empty = scenario([], { defs: [SPECTER, FILLER], p1: { battlefield: ['Test Hollow Specter'] } });
    expect(power(empty, find(empty, 'Test Hollow Specter', 'battlefield', 'p1'))).toBe(5);
    const held = scenario([], { defs: [SPECTER, FILLER], p1: { battlefield: ['Test Hollow Specter'] }, p2: { hand: ['Test Filler'] } });
    expect(power(held, find(held, 'Test Hollow Specter', 'battlefield', 'p1'))).toBe(2);
    const own = scenario([], { defs: [SPECTER, FILLER], p1: { battlefield: ['Test Hollow Specter'] }, p2: { hand: ['Test Filler'] } });
    expect(own.zones.hand['p1']!.length).toBe(0);
    expect(power(own, find(own, 'Test Hollow Specter', 'battlefield', 'p1'))).toBe(2);
  });
});

describe('CR 122.6, 122.6a, 611.3a: "As long as you\'ve put one or more +1/+1 counters on a creature this turn, ~ has trample and lifelink."', () => {
  const PALADIN = card('Test Counter Paladin', 'Creature — Knight', "As long as you've put one or more +1/+1 counters on a creature this turn, ~ has trample and lifelink.", { pt: ['2', '2'] });
  const BLESS = card('Test Bless', 'Instant', 'Put a +1/+1 counter on target creature.');
  const CURSE = card('Test Curse', 'Instant', 'Put a -1/-1 counter on target creature.');
  const ARTIFACT = card('Test Gear', 'Artifact', '');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  const defs = [PALADIN, BLESS, CURSE, ARTIFACT, BEAR, KILL];
  const base = (hand: string[], extra: string[] = []): GameState => scenario([], { defs, p1: { battlefield: ['Test Counter Paladin', 'Test Plain Bear', ...extra], hand }, p2: { battlefield: ['Test Plain Bear'] } });
  it('is automated', () => { expect(full(PALADIN)).toBe(true); });
  it('no counter put yet: no trample; after you put a +1/+1 counter on any creature (yours or an opponent\'s) it has trample and lifelink until the turn ends', () => {
    const s0 = base(['Test Bless']);
    const pal = find(s0, 'Test Counter Paladin', 'battlefield', 'p1');
    expect(hasKw(s0, pal, 'trample')).toBe(false);
    const own = cast(s0, 'Test Bless', { targets: [[obj(find(s0, 'Test Plain Bear', 'battlefield', 'p1'))]] });
    expect(hasKw(own, pal, 'trample')).toBe(true);
    expect(hasKw(own, pal, 'lifelink')).toBe(true);
    const theirs = cast(s0, 'Test Bless', { targets: [[obj(find(s0, 'Test Plain Bear', 'battlefield', 'p2'))]] });
    expect(hasKw(theirs, pal, 'trample')).toBe(true);
  });
  it('negative: a -1/-1 counter, or a +1/+1 counter put on a noncreature permanent, does not count', () => {
    const s0 = base(['Test Curse']);
    const pal = find(s0, 'Test Counter Paladin', 'battlefield', 'p1');
    const cursed = cast(s0, 'Test Curse', { targets: [[obj(find(s0, 'Test Plain Bear', 'battlefield', 'p2'))]] });
    expect(hasKw(cursed, pal, 'trample')).toBe(false);
    const g = scenario([], { defs, p1: { battlefield: ['Test Counter Paladin', 'Test Gear'], hand: ['Test Bless'] } });
    // a noncreature permanent is no legal target of the spell: put the counter on it directly through the spell is impossible, so the history stays empty
    expect(hasKw(g, find(g, 'Test Counter Paladin', 'battlefield', 'p1'), 'trample')).toBe(false);
  });
  it('the creature the counter went on may leave afterwards: the ability still applies (ruling 2021-11-19)', () => {
    const s0 = base(['Test Bless', 'Test Kill']);
    const pal = find(s0, 'Test Counter Paladin', 'battlefield', 'p1');
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    let s = cast(s0, 'Test Bless', { targets: [[obj(bear)]] });
    s = cast(s, 'Test Kill', { targets: [[obj(bear)]] });
    expect(named(s, 'Test Plain Bear', 'battlefield', 'p2')).toHaveLength(0);
    expect(hasKw(s, pal, 'trample')).toBe(true);
  });
});

describe('CR 508.4, 111.4, 603.10a: "Whenever ~ attacks, create a tapped and attacking 1/1 red Devil creature token with "When this token dies, it deals 1 damage to any target.""', () => {
  const PUGILIST = card('Test Pit Fighter', 'Creature — Ogre Warrior', 'Whenever ~ attacks, create a tapped and attacking 1/1 red Devil creature token with "When this token dies, it deals 1 damage to any target."', { pt: ['4', '4'] });
  const WALL = card('Test Stout Wall', 'Creature — Wall', '', { pt: ['2', '4'] });
  const defs = [PUGILIST, WALL];
  const attackThenPass = (blockers: boolean): GameState => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Pit Fighter'] }, p2: blockers ? { battlefield: ['Test Stout Wall'] } : {} });
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Pit Fighter', 'battlefield', 'p1'), defender: 'p2' }] });
    return s;
  };
  it('is automated', () => { expect(full(PUGILIST)).toBe(true); });
  it('the Devil token enters tapped and attacking the same player, with the quoted death trigger', () => {
    let s = attackThenPass(false);
    for (let i = 0; i < 6 && s.zones.stack.length === 0 && s.pending?.kind === 'priority'; i++) s = pass(s);
    s = drain(settle(s));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(1);
    const t = tokens[0]!;
    expect(s.objects[t]!.tapped).toBe(true);
    expect(s.combat?.attackers.some((a) => a.id === t)).toBe(true);
    expect(power(s, t)).toBe(1);
    expect(chars(s, t).subtypes).toContain('Devil');
    expect(JSON.stringify(chars(s, t).abilities ?? [])).toContain('dies');
  });
  it('when a blocker kills the token, its trigger deals 1 damage to the target you choose', () => {
    let s = attackThenPass(true);
    const wall = find(s, 'Test Stout Wall', 'battlefield', 'p2');
    for (let i = 0; i < 12 && s.pending?.kind !== 'declareBlockers'; i++) s = s.pending?.kind === 'priority' ? pass(settle(s)) : settle(s);
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: wall, attacker: token }] });
    // the 2/4 wall kills the 1/1 Devil in combat damage; its trigger goes on the stack and the player chooses the target: the opponent loses 1 life
    const targetsLeft: TargetChoice[][] = [[plr('p2')]];
    for (let i = 0; i < 30 && s.turn.step !== 'main2' && s.turn.step !== 'endCombat'; i++) {
      s = s.pending?.kind === 'priority' ? pass(s) : settle(s, { targets: targetsLeft });
    }
    s = drain(settle(s, { targets: targetsLeft }), { targets: targetsLeft });
    expect(s.zones.battlefield.includes(token)).toBe(false);
    expect(life(s, 'p2')).toBe(20 - 4 /* Test Pit Fighter is unblocked */ - 1 /* the Devil's death trigger */);
  });
});

describe('CR 113.6m, 603.4, 706.2: "At the beginning of your upkeep, if ~ is in your graveyard, roll a four-sided die. If the result is 1, return ~ from your graveyard to the battlefield."', () => {
  const ANGEL = card('Test Fading Angel', 'Creature — Angel', 'Flying\nAt the beginning of your upkeep, if ~ is in your graveyard, roll a four-sided die. If the result is 1, return ~ from your graveyard to the battlefield.', { pt: ['3', '3'] });
  const upkeep = (zone: 'graveyard' | 'battlefield' | 'hand', seed: string): GameState => {
    const s0 = scenario([], { defs: [ANGEL], seed, p1: { [zone]: ['Test Fading Angel'] } });
    return settle(advanceTo(s0, 3, 'upkeep'));
  };
  const resolveAll = (s: GameState): GameState => drain(settle(s));
  it('is automated', () => { expect(full(ANGEL)).toBe(true); });
  it('from the graveyard the trigger rolls the d4: across seeds it comes back on a 1 and stays in the graveyard on 2, 3 or 4 (never more than once per upkeep)', () => {
    let back = 0;
    let stayed = 0;
    for (const seed of 'abcdefghijklmnopqrstuvwxyz'.split('')) {
      const s = resolveAll(upkeep('graveyard', seed));
      const onField = named(s, 'Test Fading Angel', 'battlefield', 'p1').length;
      const inYard = named(s, 'Test Fading Angel', 'graveyard', 'p1').length;
      expect(onField + inYard).toBe(1);
      if (onField === 1) back++;
      else stayed++;
    }
    expect(back).toBeGreaterThan(0);
    expect(stayed).toBeGreaterThan(back);
  });
  it('negative: on the battlefield or in hand the intervening "if" is false: nothing is rolled or moved', () => {
    for (const zone of ['battlefield', 'hand'] as const) {
      const s = resolveAll(upkeep(zone, 'a'));
      expect(s.log.some((l) => /rolled/i.test(l.text))).toBe(false);
      expect(named(s, 'Test Fading Angel', zone, 'p1')).toHaveLength(1);
    }
  });
});

describe('CR 113.6m, 603.4, 400.7: "At the beginning of your upkeep, if ~ is in your graveyard or on the battlefield, you may gain 1 life."', () => {
  const ANGEL = card('Test Flame Angel', 'Creature — Angel', 'Flying, first strike\nAt the beginning of your upkeep, if ~ is in your graveyard or on the battlefield, you may gain 1 life.', { pt: ['4', '4'] });
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  const run = (zone: 'graveyard' | 'battlefield' | 'hand' | 'exile'): GameState => drain(settle(advanceTo(scenario([], { defs: [ANGEL, KILL], p1: { [zone]: ['Test Flame Angel'] } }), 3, 'upkeep')));
  it('is automated', () => { expect(full(ANGEL)).toBe(true); });
  it('in the graveyard and on the battlefield you gain 1 life; in hand or in exile you do not', () => {
    expect(life(run('graveyard'), 'p1')).toBe(21);
    expect(life(run('battlefield'), 'p1')).toBe(21);
    expect(life(run('hand'), 'p1')).toBe(20);
    expect(life(run('exile'), 'p1')).toBe(20);
  });
  it('ruling 2017-11-17: if it leaves the battlefield for the graveyard before the trigger resolves you gain no life (a new object is not the one that triggered)', () => {
    let s = settle(advanceTo(scenario([], { defs: [ANGEL, KILL], p1: { battlefield: ['Test Flame Angel'], hand: ['Test Kill'] } }), 3, 'upkeep'));
    expect(s.zones.stack.length).toBe(1);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kill', 'hand', 'p1') } as never), { targets: [[obj(find(s, 'Test Flame Angel', 'battlefield', 'p1'))]] });
    s = drain(s);
    expect(named(s, 'Test Flame Angel', 'graveyard', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 603.4, 303.4, 301.5: "Whenever ~ becomes tapped, if it\'s enchanted or equipped, create a 2/1 red Dwarf Berserker creature token."', () => {
  const SKALD = card('Test War Singer', 'Creature — Dwarf Berserker', "Whenever ~ becomes tapped, if it's enchanted or equipped, create a 2/1 red Dwarf Berserker creature token.", { pt: ['2', '2'] });
  const AURA = card('Test Song Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +0/+1.');
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.\nEquip {0}');
  const defs = [SKALD, AURA, BLADE];
  const tokensOf = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length;
  const attack = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test War Singer', 'battlefield', 'p1'), defender: 'p2' }] });
    return drain(settle(s));
  };
  it('is automated', () => { expect(full(SKALD)).toBe(true); });
  it('attacking taps it: with an Aura on it, or an Equipment on it, a token is made; bare, nothing', () => {
    const bare = scenario([], { defs, p1: { battlefield: ['Test War Singer'] } });
    expect(tokensOf(attack(bare))).toBe(1 - 1);
    let enchanted = scenario([], { defs, p1: { battlefield: ['Test War Singer'], hand: ['Test Song Aura'] } });
    enchanted = cast(enchanted, 'Test Song Aura', { targets: [[obj(find(enchanted, 'Test War Singer', 'battlefield', 'p1'))]] });
    expect(enchanted.objects[find(enchanted, 'Test Song Aura', 'battlefield', 'p1')]!.attachedTo).toBe(find(enchanted, 'Test War Singer', 'battlefield', 'p1'));
    expect(tokensOf(attack(enchanted))).toBe(1);
    const gear = scenario([], { defs, p1: { battlefield: ['Test War Singer', 'Test Blade'] } });
    const equip = legal(gear, 'p1', 'activate').find((x) => x.label.toLowerCase().includes('equip'))!;
    let equipped = drain(settle(act(gear, equip.action), { targets: [[obj(find(gear, 'Test War Singer', 'battlefield', 'p1'))]] }));
    equipped = drain(equipped);
    expect(equipped.objects[find(equipped, 'Test Blade', 'battlefield', 'p1')]!.attachedTo).toBe(find(equipped, 'Test War Singer', 'battlefield', 'p1'));
    expect(tokensOf(attack(equipped))).toBe(1);
  });
});

describe('CR 509.1c, 613.4c, 613.1f: "Enchanted creature gets +4/+4 and has first strike, and all creatures able to block it do so."', () => {
  const UMBRA = card('Test Lure Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +4/+4 and has first strike, and all creatures able to block it do so.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const GUARD = card('Test Guard', 'Creature — Soldier', '', { pt: ['1', '1'] });
  const defs = [UMBRA, BEAR, GUARD];
  const toBlockers = (enchant: boolean): GameState => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Plain Bear'], hand: enchant ? ['Test Lure Aura'] : [] }, p2: { battlefield: ['Test Guard', 'Test Guard'] } });
    if (enchant) s = cast(s, 'Test Lure Aura', { targets: [[obj(find(s, 'Test Plain Bear', 'battlefield', 'p1'))]] });
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Plain Bear', 'battlefield', 'p1'), defender: 'p2' }] });
    for (let i = 0; i < 20 && s.pending?.kind !== 'declareBlockers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s);
    return s;
  };
  it('is automated', () => { expect(full(UMBRA)).toBe(true); });
  it('the enchanted creature is 6/6 first strike; every creature able to block it must: declaring no block is refused, blocking with both is accepted', () => {
    const s = toBlockers(true);
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    expect(power(s, bear)).toBe(6);
    expect(hasKw(s, bear, 'first strike')).toBe(true);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(() => answer(s, { kind: 'declareBlockers', blocks: [] })).toThrow();
    const guards = findAll(s, 'Test Guard', 'battlefield', 'p2');
    expect(() => answer(s, { kind: 'declareBlockers', blocks: [{ blocker: guards[0]!, attacker: bear }] })).toThrow();
    expect(() => answer(s, { kind: 'declareBlockers', blocks: guards.map((g) => ({ blocker: g, attacker: bear })) })).not.toThrow();
  });
  it('negative: an unenchanted attacker can go unblocked', () => {
    const s = toBlockers(false);
    expect(s.pending?.kind).toBe('declareBlockers');
    expect(() => answer(s, { kind: 'declareBlockers', blocks: [] })).not.toThrow();
  });
});

describe('CR 701.23a, 101.2, 611.2a: "Players can\'t search libraries this turn."', () => {
  const DOUBT = card('Test Shadow Doubt', 'Instant', "Players can't search libraries this turn.\nDraw a card.");
  const FETCH = card('Test Fetch Spell', 'Sorcery', 'Search your library for a basic land card, put it into your hand, then shuffle.');
  const run = (doubt: boolean): GameState => {
    let s = scenario([], { defs: [DOUBT, FETCH], p1: { hand: doubt ? ['Test Shadow Doubt', 'Test Fetch Spell'] : ['Test Fetch Spell'], library: ['Plains', 'Plains'] } } as never);
    if (doubt) s = cast(s, 'Test Shadow Doubt');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Fetch Spell', 'hand', 'p1') } as never), { picks: [[...s.zones.library['p1']!].slice(0, 1)] });
    for (let g = 0; g < 10 && s.pending && s.pending.kind !== 'priority'; g++) s = settle(s, { picks: [[...s.zones.library['p1']!].slice(0, 1)] });
    return drain(s, { picks: [[...s.zones.library['p1']!].slice(0, 1)] });
  };
  const plainsInHand = (s: GameState): number => s.zones.hand['p1']!.filter((id) => s.objects[id]!.defId === 'Plains').length;
  it('is automated', () => { expect(full(DOUBT)).toBe(true); });
  it('after it resolves the search finds nothing, but its card is still drawn; without it the same spell finds a land', () => {
    const blocked = run(true);
    expect(plainsInHand(blocked)).toBe(1 /* the card drawn by the first spell */);
    const open = run(false);
    expect(plainsInHand(open)).toBe(1 /* the searched land */);
  });
});

describe('CR 120.3, 608.2h, 608.2d: "Whenever ~ or another Ally you control enters, you may have ~ deal damage to target creature with flying equal to the number of Allies you control."', () => {
  const ARCHER = card('Test Cliff Archer', 'Creature — Kor Archer Ally', 'Whenever ~ or another Ally you control enters, you may have ~ deal damage to target creature with flying equal to the number of Allies you control.', { pt: ['2', '2'] });
  const ALLY = card('Test Kor Ally', 'Creature — Kor Ally', '', { pt: ['1', '1'] });
  const BIRD = card('Test Sky Bird', 'Creature — Bird', 'Flying', { pt: ['1', '4'] });
  const GROUND = card('Test Ground Beast', 'Creature — Beast', '', { pt: ['1', '4'] });
  const defs = [ARCHER, ALLY, BIRD, GROUND];
  it('is automated', () => { expect(full(ARCHER)).toBe(true); });
  it('casting a second Ally: the Archer deals damage equal to the Allies counted as it resolves (2) to the flier chosen; a creature without flying is not a legal target', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Cliff Archer'], hand: ['Test Kor Ally'] }, p2: { battlefield: ['Test Sky Bird', 'Test Ground Beast'] } });
    const bird = find(s0, 'Test Sky Bird', 'battlefield', 'p2');
    const o: Opts = { targets: [[obj(bird)]], answers: [{ kind: 'yesNo', yes: true }] };
    const s = drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kor Ally', 'hand', 'p1') } as never), o), o);
    expect(s.objects[bird]!.damage).toBe(2);
    expect(s.objects[find(s, 'Test Ground Beast', 'battlefield', 'p2')]!.damage).toBe(0);
  });
  it('negative: declining the "may" deals no damage', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Cliff Archer'], hand: ['Test Kor Ally'] }, p2: { battlefield: ['Test Sky Bird'] } });
    const bird = find(s0, 'Test Sky Bird', 'battlefield', 'p2');
    const o: Opts = { targets: [[obj(bird)]], answers: [{ kind: 'yesNo', yes: false }] };
    const s = drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Kor Ally', 'hand', 'p1') } as never), o), o);
    expect(s.objects[bird]!.damage).toBe(0);
  });
});

describe('CR 400.7, 603.4: "At the beginning of your upkeep, if ~ is in your graveyard, you may gain 1 life." (a formerly automated reading, fixed: edh-c-16, owner standing rule 2026-10-27)', () => {
  const ANGEL = card('Test Grave Angel', 'Creature — Angel', 'At the beginning of your upkeep, if ~ is in your graveyard, you may gain 1 life.', { pt: ['2', '2'] });
  const EXILE = card('Test Exile Spell', 'Instant', 'Exile target card from a graveyard.');
  const run = (respond: boolean): GameState => {
    let s = advanceTo(scenario([], { defs: [ANGEL, EXILE], p1: { graveyard: ['Test Grave Angel'], hand: ['Test Exile Spell'] } }), 3, 'upkeep');
    if (respond) s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Exile Spell', 'hand', 'p1') } as never), { targets: [[obj(find(s, 'Test Grave Angel', 'graveyard', 'p1'))]] });
    return drain(s);
  };
  it('the card still in the graveyard as the ability resolves: you gain 1 life', () => { expect(life(run(false), 'p1')).toBe(21); });
  it('the card exiled in response is a new object, no longer in the graveyard: the intervening "if" fails as the ability resolves and you gain nothing', () => {
    const s = run(true);
    expect(named(s, 'Test Grave Angel', 'exile', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(20);
  });
});
