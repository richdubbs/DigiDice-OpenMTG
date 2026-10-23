/**
 * std-rx31 (wave 2, Standard lane rx31: exile, copies and returns): the round's readings played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** How to answer a decision: by its kind, in order; anything not listed gets the first legal answer. */
type Script = Partial<Record<string, ((s: GameState) => DecisionAnswer)[]>>;
const seen: string[] = [];
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as Record<string, unknown> & { kind: string };
    seen.push(p.kind);
    const next = script[p.kind]?.shift();
    if (next) { s = answer(s, next(s)); continue; }
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'chooseTargets') {
      const objs = p['objects'] as ObjectId[]; const pls = p['players'] as string[];
      s = answer(s, { kind: 'chooseTargets', targets: objs.length > 0 ? [{ kind: 'object', id: objs[0]! }] : [{ kind: 'player', id: pls[0]! }] } as DecisionAnswer);
    } else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p['options'] as ObjectId[]).slice(0, p['min'] as number) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(p['options'] as { id: string }[])[0]!.id] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p['items'] as { id: string }[]).map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let i = 0; i < 20 && s.zones.stack.length > 0; i++) s = drive(pass(s), script);
  return s;
}
const castIt = (s: GameState, name: string, script: Script = {}, player = 'p1'): GameState => resolveAll(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
const yes = (v: boolean) => (): DecisionAnswer => ({ kind: 'yesNo', yes: v });
const pick = (f: (s: GameState) => ObjectId[]) => (s: GameState): DecisionAnswer => ({ kind: 'chooseObjects', ids: f(s) });
const named = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: string): string[] => zoneNames(s, zone, p);
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
const inExile = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === name);

describe('CR 608.2g, 601.2, 608.2h: "You may cast that card without paying its mana cost if the spell\'s mana value is less than or equal to the amount of life you gained this turn. Otherwise, put it into your hand."', () => {
  const SEER = card('Test Dawn Seer', 'Creature — Giant',
    "At the beginning of your end step, if you gained life this turn, exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the spell's mana value is less than or equal to the amount of life you gained this turn. Otherwise, put it into your hand.", { pt: ['3', '3'] });
  const SALVE = card('Test Salve', 'Instant', 'You gain 2 life.');
  const MEND = card('Test Mend', 'Instant', 'You gain 1 life.');
  const DRAW2 = card('Test Insight', 'Sorcery', 'Draw two cards.', { cost: '{1}{U}' });
  const DEFS = [SEER, SALVE, MEND, DRAW2];
  it('is understood', () => expect(full(SEER)).toBe(true));
  const atEnd = (gain: string, cast: boolean): GameState => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Dawn Seer'], hand: [gain], library: ['Plains', 'Test Insight'] } });
    s = castIt(s, gain);
    s = advanceTo(s, 1, 'end');
    return resolveAll(s, { yesNo: [yes(cast)] });
  };
  it('two life gained and a spell of mana value 2: it is cast for free (two cards drawn, it is in the graveyard)', () => {
    const s = atEnd('Test Salve', true);
    expect(named(s, 'graveyard', 'p1')).toContain('Test Insight');
    expect(named(s, 'hand', 'p1')).not.toContain('Test Insight');
    expect(s.zones.hand.p1!.length).toBe(2);
    expect(inExile(s, 'Plains').length).toBe(1); // the land exiled before it stays in exile
  });
  it('declined: "Otherwise" puts it into your hand', () => {
    const s = atEnd('Test Salve', false);
    expect(named(s, 'hand', 'p1')).toEqual(['Test Insight']);
  });
  it('one life gained: mana value 2 is too much, it is not cast and goes to your hand', () => {
    const s = atEnd('Test Mend', true);
    expect(named(s, 'hand', 'p1')).toEqual(['Test Insight']);
    expect(named(s, 'graveyard', 'p1')).not.toContain('Test Insight');
  });
});

describe('CR 608.2c, 601.2, 702.166b: "If this spell was bargained, you may cast the exiled card ... Put the exiled card into your hand if it wasn\'t cast this way."', () => {
  const MIRROR = card('Test Glass Wish', 'Sorcery',
    "Bargain\nSearch your library for a card, exile it face down, then shuffle. If this spell was bargained, you may cast the exiled card without paying its mana cost if that spell's mana value is 3 or less. Put the exiled card into your hand if it wasn't cast this way.");
  const DRAW2 = card('Test Insight', 'Sorcery', 'Draw two cards.', { cost: '{1}{U}' });
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const DEFS = [MIRROR, DRAW2, TRINKET];
  it('is understood', () => expect(full(MIRROR)).toBe(true));
  const found = (s: GameState): ObjectId[] => s.zones.library.p1!.filter((id) => s.objects[id]!.defId === 'Test Insight');
  it('not bargained: the card found goes to your hand (the cast never happened)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Glass Wish'], library: ['Test Insight'] } });
    s = castIt(s, 'Test Glass Wish', { yesNo: [yes(false)], chooseObjects: [pick(found)] });
    expect(named(s, 'hand', 'p1')).toEqual(['Test Insight']);
    expect(inExile(s, 'Test Insight')).toEqual([]);
  });
  it('bargained and cast: the spell resolves (two cards drawn) and the card is not put into your hand', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Glass Wish'], library: ['Test Insight'], battlefield: ['Test Trinket'] } });
    s = castIt(s, 'Test Glass Wish', { chooseObjects: [pick(found)] });
    expect(onField(s, 'Test Trinket')).toEqual([]); // sacrificed for bargain
    expect(named(s, 'graveyard', 'p1')).toContain('Test Insight');
    expect(named(s, 'hand', 'p1')).not.toContain('Test Insight');
    expect(s.zones.hand.p1!.length).toBe(2);
  });
  it('bargained but declined: the card goes to your hand', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Glass Wish'], library: ['Test Insight'], battlefield: ['Test Trinket'] } });
    s = castIt(s, 'Test Glass Wish', { yesNo: [yes(true), yes(false)], chooseObjects: [pick(found)] });
    expect(onField(s, 'Test Trinket')).toEqual([]);
    expect(named(s, 'hand', 'p1')).toEqual(['Test Insight']);
  });
});

describe('CR 614.15, 608.2c, 400.7: "If this spell was bargained, you may put one of those cards with mana value 3 or less onto the battlefield instead of putting it into your hand."', () => {
  const SECONDS = card('Test Second Helping', 'Sorcery',
    'Bargain\nReturn up to two target creature cards from your graveyard to your hand. If this spell was bargained, you may put one of those cards with mana value 3 or less onto the battlefield instead of putting it into your hand.');
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'], cost: '{1}' });
  const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['6', '6'], cost: '{5}{G}' });
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const DEFS = [SECONDS, PUP, GIANT, TRINKET];
  it('is understood', () => expect(full(SECONDS)).toBe(true));
  const targets = (s: GameState): DecisionAnswer => ({ kind: 'chooseTargets', targets: s.zones.graveyard.p1!.filter((id) => s.objects[id]!.defId !== 'Test Second Helping').map((id) => ({ kind: 'object' as const, id })) });
  it('bargained: the Pup (mana value 1) enters the battlefield, the Giant (mana value 6) is returned to your hand', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Second Helping'], graveyard: ['Test Pup', 'Test Giant'], battlefield: ['Test Trinket'] } });
    s = castIt(s, 'Test Second Helping', { chooseTargets: [targets], chooseObjects: [pick((x) => x.zones.graveyard.p1!.filter((id) => x.objects[id]!.defId === 'Test Pup'))] });
    expect(onField(s, 'Test Pup').length).toBe(1);
    expect(named(s, 'hand', 'p1')).toEqual(['Test Giant']);
  });
  it('the Giant is never offered (mana value 6), and choosing none returns both', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Second Helping'], graveyard: ['Test Pup', 'Test Giant'], battlefield: ['Test Trinket'] } });
    let offered: string[] = [];
    s = castIt(s, 'Test Second Helping', { chooseTargets: [targets], chooseObjects: [(x) => { offered = (x.pending as unknown as { options: ObjectId[] }).options.map((id) => x.objects[id]!.defId); return { kind: 'chooseObjects', ids: [] }; }] });
    expect(offered).toEqual(['Test Pup']);
    expect(named(s, 'hand', 'p1').sort()).toEqual(['Test Giant', 'Test Pup']);
  });
  it('not bargained: both cards are returned to your hand, nothing is offered', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Second Helping'], graveyard: ['Test Pup', 'Test Giant'], battlefield: ['Test Trinket'] } });
    s = castIt(s, 'Test Second Helping', { yesNo: [yes(false)], chooseTargets: [targets] });
    expect(named(s, 'hand', 'p1').sort()).toEqual(['Test Giant', 'Test Pup']);
    expect(onField(s, 'Test Trinket').length).toBe(1);
  });
});

describe('CR 701.20a, 608.2c, 608.2d: "You may reveal a creature card from among them. If that card has mana value 2 or less, you may put it onto the battlefield and it gains haste until end of turn. If you didn\'t put the revealed card onto the battlefield this way, put it into your hand."', () => {
  const BREAK = card('Test Breakaway', 'Sorcery',
    "Look at the top five cards of your library. You may reveal a creature card from among them. If that card has mana value 2 or less, you may put it onto the battlefield and it gains haste until end of turn. If you didn't put the revealed card onto the battlefield this way, put it into your hand. Put the rest on the bottom of your library in a random order.");
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'], cost: '{1}' });
  const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['6', '6'], cost: '{5}{G}' });
  const DEFS = [BREAK, PUP, GIANT];
  it('is understood', () => expect(full(BREAK)).toBe(true));
  const revealed = (name: string) => pick((s) => s.zones.library.p1!.filter((id) => s.objects[id]!.defId === name));
  it('a mana value 1 creature put onto the battlefield has haste; the rest go to the bottom', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Breakaway'], library: ['Plains', 'Test Pup', 'Plains', 'Plains', 'Plains'] } });
    s = castIt(s, 'Test Breakaway', { chooseObjects: [revealed('Test Pup')] });
    const [pup] = onField(s, 'Test Pup');
    expect(pup).toBeDefined();
    expect(getChars(s, pup!)!.keywords.map((k) => k.keyword)).toContain('haste');
    expect(named(s, 'hand', 'p1')).toEqual([]);
    expect(named(s, 'library', 'p1').slice(-4)).toEqual(['Plains', 'Plains', 'Plains', 'Plains']);
  });
  it('declining to put it onto the battlefield puts the revealed card into your hand', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Breakaway'], library: ['Test Pup', 'Plains'] } });
    s = castIt(s, 'Test Breakaway', { chooseObjects: [revealed('Test Pup')], yesNo: [yes(false)] });
    expect(onField(s, 'Test Pup')).toEqual([]);
    expect(named(s, 'hand', 'p1')).toEqual(['Test Pup']);
  });
  it('a mana value 6 creature is never put onto the battlefield: it goes to your hand', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Breakaway'], library: ['Test Giant', 'Plains'] } });
    s = castIt(s, 'Test Breakaway', { chooseObjects: [revealed('Test Giant')] });
    expect(onField(s, 'Test Giant')).toEqual([]);
    expect(named(s, 'hand', 'p1')).toEqual(['Test Giant']);
  });
  it('nothing revealed: nothing goes to your hand, all five go to the bottom', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Breakaway'], library: ['Test Pup', 'Plains'] } });
    s = castIt(s, 'Test Breakaway', { chooseObjects: [pick(() => [])] });
    expect(named(s, 'hand', 'p1')).toEqual([]);
    expect(onField(s, 'Test Pup')).toEqual([]);
  });
});

describe('CR 614.15, 608.2d, 701.20a: "If you gained life this turn, you may instead reveal two creature and/or land cards from among them and put them into your hand."', () => {
  const PATH = card('Test Lantern Path', 'Sorcery',
    'Look at the top four cards of your library. You may reveal a creature or land card from among them and put it into your hand. If you gained life this turn, you may instead reveal two creature and/or land cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.');
  const SALVE = card('Test Salve', 'Instant', 'You gain 2 life.');
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'], cost: '{1}' });
  const BOLT = card('Test Spark', 'Instant', 'You gain 1 life.');
  const DEFS = [PATH, SALVE, PUP, BOLT];
  it('is understood', () => expect(full(PATH)).toBe(true));
  const both = pick((s) => s.zones.library.p1!.filter((id) => ['Test Pup', 'Plains'].includes(s.objects[id]!.defId)).slice(0, 2));
  it('no life gained: at most one card', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Lantern Path'], library: ['Test Pup', 'Plains', 'Test Spark', 'Test Spark'] } });
    let max = -1;
    s = castIt(s, 'Test Lantern Path', { chooseObjects: [(x) => { max = (x.pending as unknown as { max: number }).max; return { kind: 'chooseObjects', ids: (both(x) as { ids: ObjectId[] }).ids.slice(0, 1) }; }] });
    expect(max).toBe(1);
    expect(named(s, 'hand', 'p1')).toEqual(['Test Pup']);
  });
  it('life gained this turn: two creature and/or land cards', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Lantern Path', 'Test Salve'], library: ['Test Pup', 'Plains', 'Test Spark', 'Test Spark'] } });
    s = castIt(s, 'Test Salve');
    s = castIt(s, 'Test Lantern Path', { chooseObjects: [both] });
    expect(named(s, 'hand', 'p1').sort()).toEqual(['Plains', 'Test Pup']);
    expect(named(s, 'library', 'p1').slice(-2)).toEqual(['Test Spark', 'Test Spark']);
  });
});

/** Activate the one non-mana ability of a permanent (paid automatically, targets as given), then let everything resolve. */
function activate(s0: GameState, source: ObjectId, targets: ObjectId[], script: Script = {}): GameState {
  const a = legal(s0, 'p1', 'activate').find((x) => x.object === source && !x.isMana);
  if (!a) throw new Error(`no ability of ${source} to activate`);
  return resolveAll(act(s0, a.action), { ...script, chooseTargets: [() => ({ kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) }), ...(script.chooseTargets ?? [])] });
}
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]?.counters[kind] ?? 0;
const SLAY = card('Test Slay', 'Instant', 'Destroy target creature.');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'], cost: '{2}{R}' });
const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'], cost: '{1}' });
const kill = (s: GameState, victim: ObjectId, script: Script = {}): GameState =>
  resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Slay', 'hand', 'p1') }), { ...script, chooseTargets: [() => ({ kind: 'chooseTargets', targets: [{ kind: 'object', id: victim }] })] });

describe('CR 406.1, 202.3, 608.2c: "Exile cards from the top of your library until you exile cards with total mana value 4 or greater. You may cast any number of spells from among them without paying their mana costs."', () => {
  const CAPSTONE = card('Test Encore Lesson', 'Sorcery',
    'Exile cards from the top of your library until you exile cards with total mana value 4 or greater. You may cast any number of spells from among them without paying their mana costs.');
  const INSIGHT = card('Test Insight', 'Sorcery', 'Draw two cards.', { cost: '{1}{U}' });
  const SALVE = card('Test Salve', 'Instant', 'You gain 2 life.', { cost: '{1}{W}' });
  const DEFS = [CAPSTONE, INSIGHT, SALVE, OGRE];
  it('is understood', () => expect(full(CAPSTONE)).toBe(true));
  it('stops at a total of 4 (a land counts 0): the Ogre under them is not exiled; both spells may be cast', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Encore Lesson'], library: ['Plains', 'Test Insight', 'Test Salve', 'Test Ogre'] } });
    const l0 = life(s, 'p1');
    s = castIt(s, 'Test Encore Lesson', { chooseObjects: [pick((x) => (x.pending as unknown as { options: ObjectId[] }).options)] });
    expect(inExile(s, 'Plains').length).toBe(1);
    expect(inExile(s, 'Test Ogre')).toEqual([]);
    expect(named(s, 'hand', 'p1')).toContain('Test Ogre'); // drawn by the free Test Insight
    expect(named(s, 'graveyard', 'p1')).toEqual(expect.arrayContaining(['Test Insight', 'Test Salve']));
    expect(life(s, 'p1')).toBe(l0 + 2);
  });
  it('a land is never cast: only the spells are offered', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Encore Lesson'], library: ['Plains', 'Test Insight', 'Test Salve'] } });
    let offered: string[] = [];
    s = castIt(s, 'Test Encore Lesson', { chooseObjects: [(x) => { offered = (x.pending as unknown as { options: ObjectId[] }).options.map((id) => x.objects[id]!.defId); return { kind: 'chooseObjects', ids: [] }; }] });
    expect(offered.sort()).toEqual(['Test Insight', 'Test Salve']);
    expect(inExile(s, 'Test Insight').length).toBe(1);
  });
});

describe('CR 205.1a, 611.2a, 613.1d: "Return it to the battlefield if it\'s an artifact creature card. Otherwise, return it to the battlefield and it\'s a 2/2 Thopter artifact creature with flying."', () => {
  const REVIVE = card('Test Reboot', 'Sorcery',
    "Choose target artifact card in your graveyard. Return it to the battlefield if it's an artifact creature card. Otherwise, return it to the battlefield and it's a 2/2 Thopter artifact creature with flying.");
  const TRINKET = card('Test Trinket', 'Artifact', '', { cost: '{3}' });
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['3', '3'], cost: '{3}' });
  const DEFS = [REVIVE, TRINKET, GOLEM];
  it('is understood', () => expect(full(REVIVE)).toBe(true));
  it('a noncreature artifact comes back as a 2/2 Thopter artifact creature with flying, and stays one', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Reboot'], graveyard: ['Test Trinket'] } });
    s = castIt(s, 'Test Reboot');
    const [t] = onField(s, 'Test Trinket');
    const c = getChars(s, t!)!;
    expect([c.types, c.subtypes, `${c.power}/${c.toughness}`, c.keywords.map((k) => k.keyword)]).toEqual([['Artifact', 'Creature'], ['Thopter'], '2/2', ['flying']]);
    s = advanceTo(s, 2, 'main1');
    expect(getChars(s, t!)!.types).toContain('Creature');
  });
  it('an artifact creature comes back unchanged', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Reboot'], graveyard: ['Test Golem'] } });
    s = castIt(s, 'Test Reboot');
    const [g] = onField(s, 'Test Golem');
    const c = getChars(s, g!)!;
    expect([c.subtypes, `${c.power}/${c.toughness}`, c.keywords.length]).toEqual([['Golem'], '3/3', 0]);
  });
});

describe('CR 117.3, 118.12, 400.7: "Whenever a creature you control dies, you may pay 2 life. If you do, return that card under your control with a finality counter on it." / "they may pay 2 life. If they don\'t, ..."', () => {
  const HOOK = card('Test Hook Feast', 'Legendary Enchantment',
    "Whenever a creature you control dies, you may pay 2 life. If you do, return that card under your control with a finality counter on it.\nWhenever a creature an opponent controls dies, they may pay 2 life. If they don't, return that card under your control with a finality counter on it.");
  const DEFS = [HOOK, SLAY, OGRE, PUP];
  it('is understood', () => expect(full(HOOK)).toBe(true));
  it('your creature: you pay 2 life and it returns to the battlefield with a finality counter', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hook Feast', 'Test Pup'], hand: ['Test Slay'] } });
    const l0 = life(s, 'p1');
    s = kill(s, find(s, 'Test Pup', 'battlefield', 'p1'));
    const [pup] = onField(s, 'Test Pup');
    expect(pup).toBeDefined();
    expect([s.objects[pup!]!.controller, counters(s, pup!, 'finality'), life(s, 'p1')]).toEqual(['p1', 1, l0 - 2]);
  });
  it('an opponent\'s creature: they decline to pay, it returns under YOUR control with a finality counter', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hook Feast'], hand: ['Test Slay'] }, p2: { battlefield: ['Test Ogre'] } });
    const l2 = life(s, 'p2');
    s = kill(s, find(s, 'Test Ogre', 'battlefield', 'p2'), { yesNo: [yes(false)] });
    const [ogre] = onField(s, 'Test Ogre');
    expect([s.objects[ogre!]!.controller, s.objects[ogre!]!.owner, counters(s, ogre!, 'finality'), life(s, 'p2')]).toEqual(['p1', 'p2', 1, l2]);
  });
  it('an opponent\'s creature: they pay 2 life and it stays in their graveyard', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hook Feast'], hand: ['Test Slay'] }, p2: { battlefield: ['Test Ogre'] } });
    const l2 = life(s, 'p2');
    s = kill(s, find(s, 'Test Ogre', 'battlefield', 'p2'), { yesNo: [yes(true)] });
    expect(onField(s, 'Test Ogre')).toEqual([]);
    expect(named(s, 'graveyard', 'p2')).toContain('Test Ogre');
    expect(life(s, 'p2')).toBe(l2 - 2);
  });
});

describe('CR 700.4, 603.10a, 603.4, 205.1a: "When Test Ann and Bo die, if they were a creature, return them to the battlefield. They\'re an artifact."', () => {
  const PAIR = card('Test Ann and Bo', 'Legendary Creature — Troll',
    "{1}: Draw a card.\nWhen Test Ann and Bo die, if they were a creature, return them to the battlefield. They're an artifact.", { pt: ['4', '4'] });
  const SHATTER = card('Test Shatter', 'Instant', 'Destroy target artifact.');
  const DEFS = [PAIR, SLAY, SHATTER];
  it('is understood', () => expect(full(PAIR)).toBe(true));
  it('destroyed as a creature: it returns as a noncreature artifact; destroyed again as an artifact, it stays in the graveyard', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ann and Bo'], hand: ['Test Slay', 'Test Shatter'] } });
    s = kill(s, find(s, 'Test Ann and Bo', 'battlefield', 'p1'));
    const [back] = onField(s, 'Test Ann and Bo');
    expect(back).toBeDefined();
    const c = getChars(s, back!)!;
    expect([c.types, c.subtypes, c.supertypes]).toEqual([['Artifact'], [], ['Legendary']]);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shatter', 'hand', 'p1') }), { chooseTargets: [() => ({ kind: 'chooseTargets', targets: [{ kind: 'object', id: back! }] })] });
    expect(onField(s, 'Test Ann and Bo')).toEqual([]);
    expect(named(s, 'graveyard', 'p1')).toContain('Test Ann and Bo');
  });
});

describe('CR 102.1, 603.4: "At the beginning of your end step, if a player controls no creatures, draw a card"', () => {
  const EMPTY = card('Test Empty Throne', 'Enchantment', 'At the beginning of your end step, if a player controls no creatures, draw a card.');
  const DEFS = [EMPTY, OGRE, PUP];
  it('is understood', () => expect(full(EMPTY)).toBe(true));
  it('the opponent controls no creature: you draw at your end step', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Empty Throne', 'Test Pup'] } });
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(s.zones.hand.p1!.length).toBe(1);
  });
  it('every player controls a creature: nothing is drawn', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Empty Throne', 'Test Pup'] }, p2: { battlefield: ['Test Ogre'] } });
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(s.zones.hand.p1!.length).toBe(0);
  });
});

describe('CR 701.3a, 603.2: "Whenever this Equipment becomes attached to a creature, tap that creature"', () => {
  const YOKE = card('Test Heavy Yoke', 'Artifact — Equipment', 'Whenever this Equipment becomes attached to a creature, tap that creature.\nEquip {0}');
  const DEFS = [YOKE, PUP];
  it('is understood', () => expect(full(YOKE)).toBe(true));
  it('equipped to the Pup: the Pup is tapped, the other Pup is not', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Heavy Yoke', 'Test Pup', 'Test Pup'] } });
    const [a, b] = onField(s, 'Test Pup');
    s = activate(s, find(s, 'Test Heavy Yoke', 'battlefield', 'p1'), [a!]);
    expect([s.objects[a!]!.tapped, s.objects[b!]!.tapped]).toEqual([true, false]);
  });
});

describe('CR 707.2, 608.2d: a chosen copy of a card in a graveyard ("you may have ~ become a copy of a creature card in a graveyard until end of turn")', () => {
  const ECHO = card('Test Grave Echo', 'Creature — Shapeshifter', 'When ~ enters, you may have ~ become a copy of a creature card in a graveyard until end of turn.', { pt: ['1', '1'] });
  const DEFS = [ECHO, OGRE];
  it('is understood', () => expect(full(ECHO)).toBe(true));
  it("it becomes a copy of the Ogre card in the opponent's graveyard (no longer asked by hand), until end of turn", () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Grave Echo'] }, p2: { graveyard: ['Test Ogre'] } });
    s = castIt(s, 'Test Grave Echo');
    const echo = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Grave Echo')!;
    expect([getChars(s, echo)!.name, `${getChars(s, echo)!.power}/${getChars(s, echo)!.toughness}`]).toEqual(['Test Ogre', '3/3']);
    s = advanceTo(s, 2, 'main1');
    expect(getChars(s, echo)!.name).toBe('Test Grave Echo');
  });
});

describe('CR 707.2, 608.2c, 611.2a (Lazav, Familiar Stranger): "If a creature card was exiled this way, you may have ~ become a copy of that card until end of turn."', () => {
  const SHIFTER = card('Test Thief of Faces', 'Creature — Shapeshifter',
    '{0}: You may exile a card from a graveyard. If a creature card was exiled this way, you may have this creature become a copy of that card until end of turn.', { pt: ['1', '4'] });
  const DEFS = [SHIFTER, OGRE];
  it('is understood', () => expect(full(SHIFTER)).toBe(true));
  const go = (copy: boolean, exile: string): GameState => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Thief of Faces'] }, p2: { graveyard: [exile] } });
    const me = find(s, 'Test Thief of Faces', 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === me && !x.isMana)!;
    return resolveAll(act(s, a.action), { yesNo: [yes(true), yes(copy)], chooseObjects: [pick((x) => (x.pending as unknown as { options: ObjectId[] }).options.slice(0, 1))] });
  };
  it('a creature card exiled: it may become a copy of it until end of turn', () => {
    let s = go(true, 'Test Ogre');
    const me = s.zones.battlefield[0]!;
    expect(getChars(s, me)!.name).toBe('Test Ogre');
    s = advanceTo(s, 2, 'main1');
    expect(getChars(s, me)!.name).toBe('Test Thief of Faces');
  });
  it('a land card exiled: nothing is offered', () => {
    const s = go(true, 'Plains');
    expect(getChars(s, s.zones.battlefield[0]!)!.name).toBe('Test Thief of Faces');
  });
});

describe('CR 712.1, 701.27a, 608.2c (Nick Fury, Agent of S.H.I.E.L.D.): "You may put a Hero, Equipment, or Vehicle card from among them onto the battlefield. If it\'s a double-faced card, you may transform it."', () => {
  const NICK = 'Nick Fury, Agent of S.H.I.E.L.D.';
  const PETER = 'Peter Parker // Amazing Spider-Man';
  const OGRE2 = card('Test Hero Ogre', 'Creature — Ogre Hero', '', { pt: ['3', '3'] });
  const mana = (s: GameState): void => { s.players.find((x) => x.id === 'p1')!.manaPool.push(...['W', 'U', 'B', 'R', 'G'].map((type) => ({ type }) as never)); };
  const powerUp = (put: string, transform: boolean): GameState => {
    let s = scenario([NICK, PETER], { defs: [OGRE2], p1: { battlefield: [{ name: NICK, since: 0 }], library: [put, 'Plains', 'Plains'] } });
    mana(s);
    const nick = find(s, NICK, 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === nick && !x.isMana)!;
    return resolveAll(act(s, a.action), { chooseObjects: [pick((x) => x.zones.library.p1!.filter((id) => x.objects[id]!.defId === put))], yesNo: [yes(transform)] });
  };
  it('a double-faced Hero put onto the battlefield may be transformed', () => {
    const s = powerUp(PETER, true);
    const [p] = onField(s, PETER);
    expect(getChars(s, p!)!.name).toBe('Amazing Spider-Man');
    expect(counters(s, find(s, NICK, 'battlefield', 'p1'), '+1/+1')).toBe(2);
  });
  it('declined, it stays on its front face', () => {
    const s = powerUp(PETER, false);
    expect(getChars(s, onField(s, PETER)[0]!)!.name).toBe('Peter Parker');
  });
  it('a single-faced Hero is never offered the transformation', () => {
    let asked = 0;
    let s = scenario([NICK, PETER], { defs: [OGRE2], p1: { battlefield: [{ name: NICK, since: 0 }], library: ['Test Hero Ogre', 'Plains'] } });
    mana(s);
    const nick = find(s, NICK, 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === nick && !x.isMana)!;
    s = resolveAll(act(s, a.action), { chooseObjects: [pick((x) => x.zones.library.p1!.filter((id) => x.objects[id]!.defId === 'Test Hero Ogre'))], yesNo: [() => { asked++; return { kind: 'yesNo', yes: true }; }] });
    expect(onField(s, 'Test Hero Ogre').length).toBe(1);
    expect(asked).toBe(0);
  });
});
