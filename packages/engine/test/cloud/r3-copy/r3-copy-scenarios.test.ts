/**
 * Standard round 3, slice r3-copy (copies and control), played through the engine with synthetic cards compiled by the game's default compiler (wordings are
 * invented, design 6.10). One block per template of parser/templates/zz-cloud/r3-copy.json, then the grammar the slice added.
 *
 *   CR 707.2, 707.4     a copy takes the copiable values of the object it copies; "becomes a copy" is a copy effect of layer 1a (CR 613.1a)
 *   CR 707.9a-b         a copy effect's exceptions are part of the copiable values ("except it isn't legendary", "is a Mutant in addition", "has haste")
 *   CR 707.10c          the controller of a copy of a spell may choose new targets for it
 *   CR 111.2            the player who creates a token is its owner and controller
 *   CR 611.2a, 611.2c   a resolved continuous effect lasts for its stated duration; the objects it affects are locked in as it begins
 *   CR 607.2a           "exiled with ~" names the cards the linked exile instruction exiled
 *   CR 110.1            a permanent is on the battlefield, never a spell ("that spell" is not a target permanent)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { mpScenario, resolveStack } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}),
  } as OracleCard);
}
/** No ability of the card is manual, at any depth (the level may be capped at partial by an experimental template, design 10.4). */
const noManual = (d: CardDef): boolean => d.automation.level !== 'manual' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id).name;
const pt = (s: GameState, id: ObjectId): [number, number] => [Number(getChars(s, id).power), Number(getChars(s, id).toughness)];
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => getChars(s, id).name === name);
const isToken = (s: GameState, id: ObjectId): boolean => s.objects[id]!.kind === 'token';

/** Answer the decisions in order (mana is paid automatically, targets from `targets`); stops at priority or at a decision with no answer left. */
function drive(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const queue = [...answers];
  const tq = [...targets];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'order' && queue[0]?.kind !== 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else if (s.pending.kind === 'chooseTargets' && tq.length > 0) s = answer(s, { kind: 'chooseTargets', targets: tq.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty, answering decisions on the way. */
function resolveAll(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const queue = [...answers];
  const tq = [...targets];
  for (let guard = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && guard < 60; guard++) {
    if (s.pending?.kind === 'priority') s = pass(s);
    else {
      const before = s;
      s = drive(s, queue.splice(0, 1), tq.length > 0 && s.pending?.kind === 'chooseTargets' ? [tq.shift()!] : []);
      if (s === before) break;
    }
  }
  return s;
}
function castAt(s0: GameState, name: string, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = [], who = 'p1'): GameState {
  const s = drive(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), [], targets);
  return resolveAll(s, answers);
}
function activate(s0: GameState, source: ObjectId, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = [], nth = 0): GameState {
  const las = legalActions(s0, s0.pending!.player).filter((a) => a.kind === 'activate' && !a.isMana && a.object === source);
  const la = las[nth];
  if (!la) throw new Error(`no activation of ${nameOf(s0, source)}`);
  return resolveAll(drive(act(s0, la.action), [], targets), answers);
}
const byHandLog = (s: GameState): boolean => s.log.some((l) => /by hand/.test(l.text));

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GIANT = card('Test Giant', 'Creature — Giant', 'Trample', { pt: ['4', '6'] });
const HERO = card('Test Hero', 'Legendary Creature — Human Knight', 'Vigilance', { pt: ['3', '3'] });
const TRINKET = card('Test Trinket', 'Artifact', '');
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.');
const COMMON = [BEAR, GIANT, HERO, TRINKET, SHOCK];

describe('CR 707.2, 111.2: "Target player creates a token that\'s a copy of target creature you control." (eff.r3copy.player.creates.copyToken)', () => {
  const GIFT = card('Test Gift', 'Sorcery', "Target player creates a token that's a copy of target creature you control.");
  const defs = [...COMMON, GIFT];
  it('has no manual part', () => expect(noManual(GIFT)).toBe(true));
  it('the opponent creates the token: it is theirs, a copy of your Giant', () => {
    const s0 = scenario([], { p1: { hand: ['Test Gift'], battlefield: ['Test Giant'] }, defs });
    const s = castAt(s0, 'Test Gift', [[player('p2')], [obj(find(s0, 'Test Giant', 'battlefield', 'p1'))]]);
    const giants = onBf(s, 'Test Giant');
    expect(giants.length).toBe(2);
    const token = giants.find((id) => isToken(s, id))!;
    expect(s.objects[token]!.controller).toBe('p2');
    expect(s.objects[token]!.owner).toBe('p2');
    expect(pt(s, token)).toEqual([4, 6]);
    expect(byHandLog(s)).toBe(false);
  });
});

describe('CR 707.4, 611.2a, 115.3: "Untap that creature. Until end of turn, it becomes a copy of up to one other target creature." (eff.r3copy.dur.becomeCopy)', () => {
  const GLASS = card('Test Glass', 'Instant', 'Target creature you control gains hexproof until end of turn. Untap that creature. Until end of turn, it becomes a copy of up to one other target creature.');
  const defs = [...COMMON, GLASS];
  it('has no manual part', () => expect(noManual(GLASS)).toBe(true));
  it('the Bear is untapped, has hexproof and is a Test Giant until end of turn, then a Bear again', () => {
    let s0 = scenario([], { p1: { hand: ['Test Glass'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Giant'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    s0.objects[bear]!.tapped = true;
    let s = castAt(s0, 'Test Glass', [[obj(bear)], [obj(find(s0, 'Test Giant', 'battlefield', 'p2'))]]);
    expect(s.objects[bear]!.tapped).toBe(false);
    expect(nameOf(s, bear)).toBe('Test Giant');
    expect(pt(s, bear)).toEqual([4, 6]);
    expect(hasKeyword(getChars(s, bear), 'hexproof')).toBe(true);
    expect(byHandLog(s)).toBe(false);
    s = advanceTo(s, 2, 'upkeep');
    expect(nameOf(s, bear)).toBe('Test Bear');
    expect(pt(s, bear)).toEqual([2, 2]);
  });
  it('with no second target, the creature copies nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Glass'], battlefield: ['Test Bear'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castAt(s0, 'Test Glass', [[obj(bear)], []]);
    expect(nameOf(s, bear)).toBe('Test Bear');
    expect(hasKeyword(getChars(s, bear), 'hexproof')).toBe(true);
  });
});

describe('CR 707.9a, 611.2a: "~ becomes a copy of up to one target creature you control until end of turn, except ~ has hexproof." (eff.r3copy.becomeCopy.dur.exceptHas)', () => {
  const SHIFTER = card('Test Shifter', 'Creature — Shapeshifter', '{1}: ~ becomes a copy of up to one target creature you control until end of turn, except ~ has hexproof.', { pt: ['1', '1'] });
  const defs = [...COMMON, SHIFTER];
  it('has no manual part', () => expect(noManual(SHIFTER)).toBe(true));
  it('it is a Test Giant with trample and hexproof until end of turn, then itself again', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shifter', 'Test Giant', 'Plains'] }, defs });
    const shifter = find(s0, 'Test Shifter', 'battlefield', 'p1');
    let s = activate(s0, shifter, [[obj(find(s0, 'Test Giant', 'battlefield', 'p1'))]]);
    expect(nameOf(s, shifter)).toBe('Test Giant');
    expect(pt(s, shifter)).toEqual([4, 6]);
    expect(hasKeyword(getChars(s, shifter), 'trample')).toBe(true);
    expect(hasKeyword(getChars(s, shifter), 'hexproof')).toBe(true);
    expect(byHandLog(s)).toBe(false);
    s = advanceTo(s, 2, 'upkeep');
    expect(nameOf(s, shifter)).toBe('Test Shifter');
    expect(hasKeyword(getChars(s, shifter), 'hexproof')).toBe(false);
  });
  it('copying a legendary creature you control puts two legendary permanents with one name under your control: the legend rule applies (CR 704.5j)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shifter', 'Test Hero', 'Plains'] }, defs });
    const shifter = find(s0, 'Test Shifter', 'battlefield', 'p1');
    const s = drive(act(s0, legalActions(s0, 'p1').find((a) => a.kind === 'activate' && !a.isMana && a.object === shifter)!.action), [], [[obj(find(s0, 'Test Hero', 'battlefield', 'p1'))]]);
    let t = s;
    for (let i = 0; i < 10 && t.zones.stack.length > 0 && t.pending?.kind === 'priority'; i++) t = pass(t);
    expect(t.pending?.prompt ?? '').toMatch(/Legend rule/);
  });
});

describe('CR 608.2f, 707.2, 109.2: "For each other nonland permanent you control, create a token that\'s a copy of that permanent." (eff.stdmsh.forEach.filter.copy, which reads "each other" since Standard merge wave 5; r3-copy\'s eff.r3copy.forEachOther.copyToken was the same build)', () => {
  const PRESS = card('Test Press', 'Artifact', '{4}: For each other nonland permanent you control, create a token that\'s a copy of that permanent.');
  const defs = [...COMMON, PRESS];
  it('has no manual part', () => expect(noManual(PRESS)).toBe(true));
  it('copies each other nonland permanent you control once (not itself, not lands, not the opponent\'s)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Press', 'Test Bear', 'Test Trinket', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Giant'] }, defs });
    const s = activate(s0, find(s0, 'Test Press', 'battlefield', 'p1'));
    expect(onBf(s, 'Test Bear').length).toBe(2);
    expect(onBf(s, 'Test Trinket').length).toBe(2);
    expect(onBf(s, 'Test Press').length).toBe(1);
    expect(onBf(s, 'Test Giant').length).toBe(1);
    expect(onBf(s, 'Plains').filter((id) => s.objects[id]!.controller === 'p1').length).toBe(4);
  });
});

describe('CR 707.2, 611.2c, 611.2a: "Clues you control become copies of it until the next end step." (eff.r3copy.filter.becomeCopies.dur)', () => {
  const ECHO = card('Test Echo', 'Creature — Wizard', "{2}, {T}: Exile target nonlegendary creature you control. Artifacts you control become copies of it until the next end step. Return it to the battlefield under its owner's control at the beginning of the next end step.", { pt: ['1', '2'] });
  const defs = [...COMMON, ECHO];
  it('has no manual part', () => expect(noManual(ECHO)).toBe(true));
  it('the artifacts are Test Giants until the next end step begins; the exiled Giant comes back then', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Echo', 'Test Giant', 'Test Trinket', 'Test Trinket', 'Plains', 'Plains'] }, defs });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p1');
    const trinkets = onBf(s0, 'Test Trinket');
    let s = activate(s0, find(s0, 'Test Echo', 'battlefield', 'p1'), [[obj(giant)]]);
    expect(s.zones.exile.length).toBe(1);
    for (const t of trinkets) {
      expect(nameOf(s, t)).toBe('Test Giant');
      expect(pt(s, t)).toEqual([4, 6]);
    }
    expect(byHandLog(s)).toBe(false);
    s = advanceTo(s, 1, 'end');
    s = resolveAll(s);
    for (const t of trinkets) expect(nameOf(s, t)).toBe('Test Trinket');
    expect(onBf(s, 'Test Giant').length).toBe(1);
  });
});

describe('CR 707.2, 110.1: "up to one other target permanent you control becomes a copy of that spell until end of turn" (grammar: a target permanent is never "that spell")', () => {
  const POOL = card('Test Pool', 'Land', '{T}: Add {C}.\nWhenever you cast a creature spell, up to one other target permanent you control becomes a copy of that spell until end of turn.');
  const GIANT_SPELL = card('Test Colossus', 'Creature — Giant', 'Reach', { pt: ['5', '5'] });
  const defs = [...COMMON, POOL, GIANT_SPELL];
  it('has no manual part', () => expect(noManual(POOL)).toBe(true));
  it('the Trinket becomes a copy of the creature spell on the stack until end of turn; the spell then resolves as itself', () => {
    const s0 = scenario([], { p1: { hand: ['Test Colossus'], battlefield: ['Test Pool', 'Test Trinket'] }, defs });
    const trinket = find(s0, 'Test Trinket', 'battlefield', 'p1');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Colossus', 'hand') }));
    s = resolveAll(s, [], [[obj(trinket)]]);
    expect(nameOf(s, trinket)).toBe('Test Colossus');
    expect(pt(s, trinket)).toEqual([5, 5]);
    expect(hasKeyword(getChars(s, trinket), 'reach')).toBe(true);
    expect(onBf(s, 'Test Colossus').length).toBe(2);
    expect(byHandLog(s)).toBe(false);
    s = advanceTo(s, 2, 'upkeep');
    expect(nameOf(s, trinket)).toBe('Test Trinket');
  });
  it('the land itself is not offered as the target ("other")', () => {
    const s0 = scenario([], { p1: { hand: ['Test Colossus'], battlefield: ['Test Pool', 'Test Trinket'] }, defs });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Colossus', 'hand') }));
    for (let i = 0; i < 10 && s.pending?.kind !== 'chooseTargets'; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    const offered = (s.pending as unknown as { objects: ObjectId[] }).objects;
    expect(offered.map((id) => nameOf(s, id))).toEqual(['Test Trinket']);
  });
});

describe('CR 707.9b, 205.4a, 205.1b: "Create a token that\'s a copy of it, except it isn\'t legendary and is a Mutant in addition to its other types." (eff.r3copy.copyToken.notLegendary.subtype)', () => {
  const VAT = card('Test Vat', 'Sorcery', "Exile target creature card from your graveyard. Create a token that's a copy of it, except it isn't legendary and is a Mutant in addition to its other types.");
  const defs = [...COMMON, VAT];
  it('has no manual part', () => expect(noManual(VAT)).toBe(true));
  it('the card is exiled; the token is a nonlegendary Human Knight Mutant with its abilities', () => {
    const s0 = scenario([], { p1: { hand: ['Test Vat'], graveyard: ['Test Hero'] }, defs });
    const s = castAt(s0, 'Test Vat', [[obj(find(s0, 'Test Hero', 'graveyard', 'p1'))]]);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Hero']);
    const [token] = onBf(s, 'Test Hero');
    const c = getChars(s, token!);
    expect(c.supertypes).not.toContain('Legendary');
    expect([...c.subtypes].sort()).toEqual(['Human', 'Knight', 'Mutant']);
    expect(hasKeyword(c, 'vigilance')).toBe(true);
    expect(byHandLog(s)).toBe(false);
  });
});

describe('CR 607.2a, 608.2d, 707.9b: "Create a token that\'s a copy of a card exiled with ~, except ..." (eff.r3copy.linked.copyToken.notLegendary.subtype)', () => {
  const LAB = card('Test Lab', 'Artifact', "When this artifact enters, exile up to two target creature cards from your graveyard.\n{1}: Create a token that's a copy of a card exiled with this artifact, except it isn't legendary and is a Mutant in addition to its other types.");
  const defs = [...COMMON, LAB];
  it('has no manual part', () => expect(noManual(LAB)).toBe(true));
  it('you choose one of the cards it exiled; the token is a nonlegendary Mutant copy of that card', () => {
    let s = scenario([], { p1: { hand: ['Test Lab'], graveyard: ['Test Hero', 'Test Bear'], battlefield: ['Plains'] }, defs });
    const hero = find(s, 'Test Hero', 'graveyard', 'p1');
    const bear = find(s, 'Test Bear', 'graveyard', 'p1');
    s = castAt(s, 'Test Lab', [], [], 'p1');
    s = resolveAll(s, [], [[obj(hero), obj(bear)]]);
    expect(s.zones.exile.length).toBe(2);
    const heroInExile = s.zones.exile.find((id) => nameOf(s, id) === 'Test Hero')!;
    s = activate(s, find(s, 'Test Lab', 'battlefield', 'p1'), [], [{ kind: 'chooseObjects', ids: [heroInExile] }]);
    const [token] = onBf(s, 'Test Hero');
    expect(token).toBeDefined();
    const c = getChars(s, token!);
    expect(c.supertypes).not.toContain('Legendary');
    expect(c.subtypes).toContain('Mutant');
    expect(onBf(s, 'Test Bear').length).toBe(0);
    expect(byHandLog(s)).toBe(false);
  });
  it('with nothing exiled with it, nothing is created', () => {
    let s = scenario([], { p1: { hand: ['Test Lab'], battlefield: ['Plains'] }, defs });
    s = castAt(s, 'Test Lab');
    s = resolveAll(s, [], [[]]);
    const before = s.zones.battlefield.length;
    s = activate(s, find(s, 'Test Lab', 'battlefield', 'p1'));
    expect(s.zones.battlefield.length).toBe(before);
  });
});

describe('CR 707.9b, 205.4a, 702.10: "except it isn\'t legendary, is a Reflection in addition to its other types, and has haste" (eff.r3copy.copyToken.notLegendary.subtype.has)', () => {
  const MIRROR = card('Test Mirror', 'Sorcery', "Create a token that's a copy of target creature you control, except it isn't legendary, is a Reflection in addition to its other types, and has haste.");
  const defs = [...COMMON, MIRROR];
  it('has no manual part', () => expect(noManual(MIRROR)).toBe(true));
  it('the token is a nonlegendary Reflection with haste beside the copied abilities', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mirror'], battlefield: ['Test Hero'] }, defs });
    const s = castAt(s0, 'Test Mirror', [[obj(find(s0, 'Test Hero', 'battlefield', 'p1'))]]);
    const heroes = onBf(s, 'Test Hero');
    expect(heroes.length).toBe(2); // not legendary: the legend rule does not apply (CR 704.5j)
    const token = heroes.find((id) => isToken(s, id))!;
    const c = getChars(s, token);
    expect(c.supertypes).not.toContain('Legendary');
    expect(c.subtypes).toContain('Reflection');
    expect(hasKeyword(c, 'haste')).toBe(true);
    expect(hasKeyword(c, 'vigilance')).toBe(true);
  });
});

describe('CR 707.9b, 205.1b: "Create a token that\'s a copy of it, except it\'s a Nightmare in addition to its other types." (eff.r3copy.copyToken.subtype)', () => {
  const DREAM = card('Test Dream', 'Sorcery', "Exile target creature card from a graveyard. Create a token that's a copy of it, except it's a Nightmare in addition to its other types.");
  const defs = [...COMMON, DREAM];
  it('has no manual part', () => expect(noManual(DREAM)).toBe(true));
  it('the token copies the exiled card and is a Nightmare too', () => {
    const s0 = scenario([], { p1: { hand: ['Test Dream'] }, p2: { graveyard: ['Test Giant'] }, defs });
    const s = castAt(s0, 'Test Dream', [[obj(find(s0, 'Test Giant', 'graveyard', 'p2'))]]);
    const [token] = onBf(s, 'Test Giant');
    expect(s.objects[token!]!.controller).toBe('p1');
    expect([...getChars(s, token!).subtypes].sort()).toEqual(['Giant', 'Nightmare']);
  });
});

describe('CR 707.10c, 608.2c: "you may copy it. If you do, you may choose new targets for the copy." (rid.r3copy.ifYouDo.copy.newTargets)', () => {
  const ECHOES = card('Test Echoes', 'Enchantment', 'Whenever you cast an instant spell, you may copy it. If you do, you may choose new targets for the copy.');
  const defs = [...COMMON, ECHOES];
  it('has no manual part', () => expect(noManual(ECHOES)).toBe(true));
  it('the copy may be aimed elsewhere: Shock and its copy each deal 2 damage', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shock'], battlefield: ['Test Echoes'] }, p2: { battlefield: ['Test Bear', 'Test Giant'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shock', 'hand') }), [], [[obj(giant)]]);
    // the trigger: yes, copy; yes, new targets; the Bear
    s = resolveAll(s, [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: true }], [[obj(bear)]]);
    expect(s.zones.graveyard['p2']!.map((id) => nameOf(s, id))).toContain('Test Bear');
    expect(s.objects[giant]!.damage).toBe(2);
  });
  it('declining the copy makes no copy and asks nothing more', () => {
    const s0 = scenario([], { p1: { hand: ['Test Shock'], battlefield: ['Test Echoes'] }, p2: { battlefield: ['Test Giant'] }, defs });
    const giant = find(s0, 'Test Giant', 'battlefield', 'p2');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Shock', 'hand') }), [], [[obj(giant)]]);
    s = resolveAll(s, [{ kind: 'yesNo', yes: false }]);
    expect(s.objects[giant]!.damage).toBe(2);
  });
});

describe('grammar: "until the next end step" (Dur, CR 611.2a, 513.1)', () => {
  const FADE = card('Test Fade', 'Instant', 'Target creature gets +3/+3 until the next end step.');
  const defs = [...COMMON, FADE];
  it('has no manual part', () => expect(noManual(FADE)).toBe(true));
  it('the bonus lasts until the end step begins', () => {
    const s0 = scenario([], { p1: { hand: ['Test Fade'], battlefield: ['Test Bear'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = castAt(s0, 'Test Fade', [[obj(bear)]]);
    expect(pt(s, bear)).toEqual([5, 5]);
    s = advanceTo(s, 1, 'end');
    expect(pt(s, bear)).toEqual([2, 2]);
  });
});

describe('CR 714.2b, 607.2a: a Saga whose chapter I exiles a card and whose chapter II copies "a card exiled with this Saga" (the two chapters are linked)', () => {
  const VATS = card('Test Vats', 'Enchantment — Saga', "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after II.)\nI — Exile target creature card from your graveyard. Create a token that's a copy of it, except it isn't legendary and is a Mutant in addition to its other types.\nII — Create a token that's a copy of a card exiled with this Saga, except it isn't legendary and is a Mutant in addition to its other types.");
  const defs = [...COMMON, VATS];
  it('has no manual part', () => expect(noManual(VATS)).toBe(true));
  it('chapter I exiles the Hero and makes a Mutant copy; chapter II makes a second one from the card it exiled', () => {
    let s = scenario([], { p1: { hand: ['Test Vats'], graveyard: ['Test Hero'] }, defs });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Vats', 'hand') }));
    s = resolveAll(s, [], [[obj(find(s, 'Test Hero', 'graveyard', 'p1'))]]);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Hero']);
    expect(onBf(s, 'Test Hero').length).toBe(1);
    s = advanceTo(s, 3, 'main1');
    s = resolveAll(s, [{ kind: 'chooseObjects', ids: [s.zones.exile[0]!] }]);
    const heroes = onBf(s, 'Test Hero');
    expect(heroes.length).toBe(2);
    for (const h of heroes) expect(getChars(s, h).subtypes).toContain('Mutant');
    expect(byHandLog(s)).toBe(false);
  });
});

describe('CR 111.2, 101.4: "Each opponent creates a token that\'s a copy of ..." (the player phrase of eff.r3copy.player.creates.copyToken is plural)', () => {
  const PARTY = card('Test Party', 'Sorcery', "Each opponent creates a token that's a copy of target creature you control.");
  it('has no manual part', () => expect(noManual(PARTY)).toBe(true));
  it('in a three-player game each of the two opponents creates its own copy', () => {
    let s = mpScenario({ players: 3, defs: [...COMMON, PARTY], zones: { p1: { hand: ['Test Party'], battlefield: ['Test Bear'] } } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Party', 'hand') }), [], [[obj(bear)]]);
    s = resolveStack(s);
    const copies = onBf(s, 'Test Bear').filter((id) => isToken(s, id));
    expect(copies.map((id) => s.objects[id]!.controller).sort()).toEqual(['p2', 'p3']);
    expect(copies.map((id) => s.objects[id]!.owner).sort()).toEqual(['p2', 'p3']);
  });
});

describe('CR 122.2: "exile ... card from a graveyard with a memory counter on it" puts the counter; it is no filter of the card in the graveyard (The Animus)', () => {
  const ANIMUS = card('Test Animus', 'Legendary Artifact', 'At the beginning of your end step, exile up to one target legendary creature card from a graveyard with a memory counter on it.\n{T}: Until your next turn, target legendary creature you control becomes a copy of target creature card in exile with a memory counter on it. Activate only as a sorcery.');
  it('the exile with a counter is not automated (no move puts a counter yet), so the card is not full', () => {
    const [trigger, copy] = ANIMUS.faces[0]!.abilities;
    expect(JSON.stringify(trigger)).toContain('"op":"manual"');
    expect(JSON.stringify(trigger)).not.toContain('"counters":{"kind":"memory"}');
    expect(copy!.kind).toBe('activated');
    expect(JSON.stringify(copy)).toContain('"zone":"exile","counters":{"kind":"memory"}');
    expect(ANIMUS.automation.level).not.toBe('full');
  });
});

describe('CR 608.2h, 400.7: a copy of a creature this resolution returned to its owner\'s hand (Supplant Form)', () => {
  const FORM = card('Test Form', 'Instant', "Return target creature to its owner's hand. You create a token that's a copy of that creature.");
  it('is not automated: the bounce keeps no last known information for the copy, which would silently copy nothing', () => {
    expect(JSON.stringify(FORM.faces)).toContain('its last known information is not kept');
    expect(FORM.automation.level).not.toBe('full');
  });
});
