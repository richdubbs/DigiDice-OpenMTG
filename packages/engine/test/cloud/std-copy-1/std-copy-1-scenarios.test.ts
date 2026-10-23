/**
 * Lane std-copy, round std-copy-1: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by
 * the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 707.10, 101.2    "This spell can't be copied" / "This ability can't be copied": an effect that would copy it puts no copy onto the stack; another spell or
 *                       ability is copied as before
 *   CR 611.2a, 400.7a   "The copy gains haste and "At the beginning of the end step, sacrifice this token."": the copy gains the abilities with no duration, and the
 *   CR 707.10f          token it becomes keeps them; the original spell does not gain them
 *   CR 110.4b           "If the copy is a permanent spell, it gains haste": a copy of an instant gains nothing
 *   CR 603.12, 705.2    "Flip a coin. When you win the flip, X. When you lose the flip, Y.": the result's own reflexive triggered ability, put on the stack after the
 *                       flip; its target is chosen then (CR 603.12a); with "If you do, flip a coin." no flip happens when the option is declined
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
/** No ability of the card is manual, at any depth (the level may be capped at partial by an experimental template, design 10.4). */
const noManual = (d: CardDef): boolean => d.automation.level !== 'manual' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: string): TargetChoice => ({ kind: 'player', id });
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const onBf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => getChars(s, id).name === name);
const isToken = (s: GameState, id: ObjectId): boolean => s.objects[id]!.kind === 'token';
const onStack = (s: GameState, name: string): ObjectId => s.zones.stack.find((id) => s.objects[id]!.kind !== 'ability' && getChars(s, id).name === name)!;

/** Answer the decisions in order (mana paid automatically, targets from `targets`, yes/no from `answers` else yes); stops at priority. */
function drive(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets' && targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: targets.shift()! });
    else if (answers.length > 0) s = answer(s, answers.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty, answering decisions on the way. */
function resolveAll(s0: GameState, answers: DecisionAnswer[] = [], targets: TargetChoice[][] = []): GameState {
  let s = s0;
  for (let guard = 0; (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')) && guard < 80; guard++) {
    if (s.pending?.kind === 'priority') s = pass(s);
    else {
      const before = s;
      s = drive(s, answers, targets);
      if (s === before) break;
    }
  }
  return s;
}
/** Cast a card from p1's hand and stop when p1 has priority again with the spell on the stack. */
const castOnly = (s: GameState, name: string, targets: TargetChoice[][] = []): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), [], targets);
/** Activate an ability of `source` (not a mana ability) and stop when p1 has priority again. */
function activateOnly(s: GameState, source: ObjectId, targets: TargetChoice[][] = [], answers: DecisionAnswer[] = []): GameState {
  const la = legalActions(s, s.pending!.player).find((a) => a.kind === 'activate' && !a.isMana && a.object === source);
  if (!la) throw new Error('no activation');
  return drive(act(s, la.action), answers, targets);
}

describe('CR 707.10, 101.2: "This spell can\'t be copied." (abl.stdcopy1.cantBeCopied)', () => {
  const PROUD = card('Test Proud Tonic', 'Instant', "Test Proud Tonic can't be copied.\nYou gain 3 life.");
  const PLAIN = card('Test Plain Tonic', 'Instant', 'You gain 3 life.');
  const TWIN = card('Test Twin Echo', 'Instant', 'Copy target instant or sorcery spell. You may choose new targets for the copy.');
  const defs = [PROUD, PLAIN, TWIN];
  it('has no manual part', () => {
    expect(noManual(PROUD)).toBe(true);
    expect(noManual(TWIN)).toBe(true);
  });
  it('a copy effect aimed at it puts no copy onto the stack: the spell resolves once', () => {
    let s = scenario([], { p1: { hand: ['Test Proud Tonic', 'Test Twin Echo'] }, defs });
    s = castOnly(s, 'Test Proud Tonic');
    s = castOnly(s, 'Test Twin Echo', [[obj(onStack(s, 'Test Proud Tonic'))]]);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(23);
    expect(s.log.some((l) => /can't be copied/.test(l.text))).toBe(true);
  });
  it('the same copy effect copies a spell without that ability (the negative case): it resolves twice', () => {
    let s = scenario([], { p1: { hand: ['Test Plain Tonic', 'Test Twin Echo'] }, defs });
    s = castOnly(s, 'Test Plain Tonic');
    s = castOnly(s, 'Test Twin Echo', [[obj(onStack(s, 'Test Plain Tonic'))]]);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(26);
  });
});

describe('CR 707.10, 101.2: "This ability can\'t be copied." (ActivatedAbilityDef.uncopiable)', () => {
  const SPRING = card('Test Shy Spring', 'Artifact', "{T}: You gain 2 life. This ability can't be copied.");
  const WELL = card('Test Open Well', 'Artifact', '{T}: You gain 2 life.');
  const ECHO = card('Test Echo Rod', 'Artifact', '{0}: Copy target activated or triggered ability you control. You may choose new targets for the copy.');
  const defs = [SPRING, WELL, ECHO];
  it('has no manual part, and "X can\'t be 0" beside it is read too', () => {
    expect(noManual(SPRING)).toBe(true);
    expect(JSON.stringify(SPRING.faces[0]!.abilities)).toContain('"uncopiable":true');
    const both = card('Test Wide Spring', 'Artifact', "{X}, {T}: You gain X life. This ability can't be copied and X can't be 0.");
    expect(noManual(both)).toBe(true);
    expect(both.faces[0]!.abilities[0]).toMatchObject({ uncopiable: true, xMin: 1 });
  });
  for (const [name, gained] of [['Test Shy Spring', 2], ['Test Open Well', 4]] as const) {
    it(`a copy of the ${name} ability is ${gained === 2 ? 'not' : ''} put onto the stack (${gained === 2 ? 'it can\'t be copied' : 'the negative case'}): p1 gains ${gained} life`, () => {
      let s = scenario([], { p1: { battlefield: [name, 'Test Echo Rod'] }, defs });
      s = activateOnly(s, find(s, name, 'battlefield', 'p1'));
      const ability = s.zones.stack.find((id) => s.objects[id]!.kind === 'ability')!;
      s = activateOnly(s, find(s, 'Test Echo Rod', 'battlefield', 'p1'), [[obj(ability)]]);
      s = resolveAll(s);
      expect(life(s, 'p1')).toBe(20 + gained);
    });
  }
});

describe('CR 611.2a, 707.10f, 400.7a: "The copy gains haste and "At the beginning of the end step, sacrifice this token."" (rid.stdcopy1.copy.gains)', () => {
  const BEAR = card('Test Pip Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const SPARK = card('Test Step Spark', 'Instant', 'Copy target creature spell you control. The copy gains haste and "At the beginning of the end step, sacrifice this token."');
  const defs = [BEAR, SPARK];
  it('has no manual part', () => expect(noManual(SPARK)).toBe(true));
  it('the token the copy becomes has haste and is sacrificed at the beginning of the end step; the original creature has neither', () => {
    let s = scenario([], { p1: { hand: ['Test Pip Bear', 'Test Step Spark'] }, defs });
    s = castOnly(s, 'Test Pip Bear');
    s = castOnly(s, 'Test Step Spark', [[obj(onStack(s, 'Test Pip Bear'))]]);
    s = resolveAll(s);
    const bears = onBf(s, 'Test Pip Bear');
    expect(bears.length).toBe(2);
    const token = bears.find((id) => isToken(s, id))!;
    const original = bears.find((id) => !isToken(s, id))!;
    expect(hasKeyword(getChars(s, token), 'haste')).toBe(true);
    expect(hasKeyword(getChars(s, original), 'haste')).toBe(false);
    s = resolveAll(advanceTo(s, 1, 'end'));
    expect(onBf(s, 'Test Pip Bear')).toEqual([original]);
  });
});

describe('CR 110.4b, 611.2a: "If the copy is a permanent spell, it gains haste." (rid.stdcopy1.copy.gains.ifPermanent)', () => {
  const BEAR = card('Test Pip Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const TONIC = card('Test Plain Tonic', 'Instant', 'You gain 3 life.');
  const VERSE = card('Test Mirror Verse', 'Instant', 'Copy target spell you control. If the copy is a permanent spell, it gains haste.');
  const defs = [BEAR, TONIC, VERSE];
  it('has no manual part', () => expect(noManual(VERSE)).toBe(true));
  it('a copy of a creature spell becomes a token with haste', () => {
    let s = scenario([], { p1: { hand: ['Test Pip Bear', 'Test Mirror Verse'] }, defs });
    s = castOnly(s, 'Test Pip Bear');
    s = castOnly(s, 'Test Mirror Verse', [[obj(onStack(s, 'Test Pip Bear'))]]);
    s = resolveAll(s);
    const token = onBf(s, 'Test Pip Bear').find((id) => isToken(s, id))!;
    expect(hasKeyword(getChars(s, token), 'haste')).toBe(true);
  });
  it('a copy of an instant gains nothing (the negative case): no effect is created, the copy resolves', () => {
    let s = scenario([], { p1: { hand: ['Test Plain Tonic', 'Test Mirror Verse'] }, defs });
    s = castOnly(s, 'Test Plain Tonic');
    s = castOnly(s, 'Test Mirror Verse', [[obj(onStack(s, 'Test Plain Tonic'))]]);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(26);
    expect(s.continuousEffects.length).toBe(0);
  });
});

describe('CR 603.12, 603.12a, 705.2: "Flip a coin. When you win the flip, X. When you lose the flip, Y." (rf.stdcopy1.flip.win / .lose)', () => {
  const COIN = card('Test Toss Charm', 'Artifact', '{T}: Flip a coin. When you win the flip, you gain 3 life. When you lose the flip, Test Toss Charm deals 2 damage to any target.');
  const RISK = card('Test Risk Charm', 'Artifact', '{T}: You may sacrifice an artifact. If you do, flip a coin. When you win the flip, you gain 3 life.');
  const TRINKET = card('Test Trinket', 'Artifact', '');
  const defs = [COIN, RISK, TRINKET];
  it('has no manual part', () => {
    expect(noManual(COIN)).toBe(true);
    expect(noManual(RISK)).toBe(true);
  });
  it('the call that wins puts the win trigger on the stack after the flip (p1 gains 3); the call that loses puts the lose trigger there, its target chosen then', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Toss Charm'] }, defs });
    const coin = find(s0, 'Test Toss Charm', 'battlefield', 'p1');
    const outcomes = (['heads', 'tails'] as const).map((call) => {
      let s = activateOnly(s0, coin);
      // the activated ability is on the stack; both pass: it resolves, the coin is called and flipped
      s = pass(s);
      s = pass(s);
      s = drive(s, [{ kind: 'chooseOption', ids: [call] }]);
      const won = s.log.some((l) => /reflexive triggered ability triggers/.test(l.text)) && s.pending?.kind !== 'chooseTargets' && s.zones.stack.length === 1;
      const reflexiveOnStack = s.zones.stack.length === 1 || s.pending?.kind === 'chooseTargets';
      s = resolveAll(s, [], [[player('p2')]]);
      return { won, reflexiveOnStack, p1: life(s, 'p1'), p2: life(s, 'p2') };
    });
    // one call wins and the other loses: the same state flips the same side (the state's RNG, design 8.8)
    expect(outcomes.map((o) => o.won).sort()).toEqual([false, true]);
    for (const o of outcomes) {
      expect(o.reflexiveOnStack).toBe(true);
      expect([o.p1, o.p2]).toEqual(o.won ? [23, 20] : [20, 18]);
    }
  });
  it('with "If you do, flip a coin." a declined option flips no coin and nothing triggers (the negative case)', () => {
    let s = scenario([], { p1: { battlefield: ['Test Risk Charm', 'Test Trinket'] }, defs });
    s = activateOnly(s, find(s, 'Test Risk Charm', 'battlefield', 'p1'));
    s = resolveAll(s, [{ kind: 'yesNo', yes: false }]);
    expect(s.log.some((l) => /flips? a coin|coin flip/i.test(l.text) && !/may/.test(l.text))).toBe(false);
    expect(life(s, 'p1')).toBe(20);
    expect(onBf(s, 'Test Trinket').length).toBe(1);
  });
});
