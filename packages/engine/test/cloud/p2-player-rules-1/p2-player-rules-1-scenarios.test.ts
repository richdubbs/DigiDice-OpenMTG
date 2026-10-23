/**
 * p2-player-rules-1 (Phase 2 lane p2-player-rules): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 502.3                 "Players can't untap more than one creature during their untap steps" (`untapLimit`): the active player chooses which; other
 *                            permanents untap; "as long as ~ is untapped"; "You can't untap more than one land during your untap step" (your step only)
 *   CR 121.1, 614.17         "Each player can't draw more than one card each turn": the second card of a draw is refused; "each opponent" spares you
 *   CR 601.2i, 101.2         "Each player can't cast more than one noncreature spell each turn": counted from the turn's casts of that kind
 *   CR 613.1f                "Creatures your opponents control lose flying and can't have or gain flying": a later grant is refused too
 *   CR 701.35a               detain: until your next turn the permanent can't attack or block and its activated abilities can't be activated
 *   CR 119.7, 119.8, 119.4   "Your life total can't change": no gain, no loss (damage included), no life payment
 *   CR 601.2f, 611.2a        "Until your next turn, creature spells your opponents cast cost {2} more to cast."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, isTapped, labels, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { castCard } from '../../m5/announce/support';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));

/** Answer the decisions of what is being done (payment automatic, objects: the first ones offered, yes/no: no); stop at the next priority. */
function settle(s0: GameState, pick?: (options: string[]) => string[], targets: { kind: 'object' | 'player'; id: string }[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 30; guard++) {
    const p = s.pending as unknown as { kind: string; options: string[]; min: number; max: number };
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(p.options) : p.options.slice(0, Math.max(p.min, 0)) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets } as never);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else break;
  }
  return s;
}
/** Pass until the given turn and step begins, answering the decisions on the way (`pick` answers an untap-step choice); counts the choices asked. */
function toStep(s0: GameState, turn: number, step: GameState['turn']['step'], pick?: (options: string[]) => string[]): { s: GameState; asked: string[][] } {
  let s = s0;
  const asked: string[][] = [];
  for (let guard = 0; !(s.turn.number === turn && s.turn.step === step); guard++) {
    if (s.result || guard > 500) throw new Error(`could not reach turn ${turn} ${step}`);
    const p = s.pending as unknown as { kind: string; options: string[] } | undefined;
    if (p?.kind === 'chooseObjects') asked.push(p.options.slice());
    s = p?.kind === 'priority' ? pass(s) : settle(s, pick);
  }
  return { s, asked };
}
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
  return s;
}
const flies = (s: GameState, id: ObjectId): boolean => hasKeyword(getChars(s, id)!, 'flying');
const tapped = (name: string): { name: string; tapped: true } => ({ name, tapped: true });

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const FIELD = card('Test Field', 'Land', '{T}: Add {C}.');

describe('CR 502.3: "Players can\'t untap more than one creature during their untap steps."', () => {
  const HAZE = card('Test Haze', 'Enchantment', "Players can't untap more than one creature during their untap steps.");
  const defs = [HAZE, BEAR, FIELD];
  it('is automated; the active player chooses the one creature that untaps, their other permanents untap as usual', () => {
    expect(automated(HAZE)).toBe(true);
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Haze'] }, p2: { battlefield: [tapped('Test Bear'), tapped('Test Bear'), tapped('Test Bear'), tapped('Test Field')] } });
    const bears = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Bear');
    const { s, asked } = toStep(s0, 2, 'upkeep', (o) => [o.includes(bears[1]!) ? bears[1]! : o[0]!]);
    expect(asked).toEqual([bears]);
    expect(bears.map((id) => isTapped(s, id))).toEqual([true, false, true]);
    expect(isTapped(s, find(s, 'Test Field', 'battlefield', 'p2'))).toBe(false);
  });
  it('with one tapped creature nothing is asked and it untaps; the non-active player\'s permanents are not untapped by this step', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Haze', tapped('Test Bear')] }, p2: { battlefield: [tapped('Test Bear')] } });
    const { s, asked } = toStep(s0, 2, 'upkeep');
    expect(asked).toEqual([]);
    expect(isTapped(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe(false);
    expect(isTapped(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(true);
  });
});

describe('CR 502.3, 611.3a: "As long as ~ is untapped, players can\'t untap more than two permanents during their untap steps."', () => {
  const ORB = card('Test Orb', 'Artifact', "As long as ~ is untapped, players can't untap more than two permanents during their untap steps.");
  const defs = [ORB, BEAR, FIELD];
  const p2 = { battlefield: [tapped('Test Bear'), tapped('Test Field'), tapped('Test Field')] };
  it('untapped, it limits the untap step to two permanents of the active player\'s choice', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Orb'] }, p2 });
    const { s, asked } = toStep(s0, 2, 'upkeep');
    expect(asked[0]).toHaveLength(3);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && isTapped(s, id))).toHaveLength(1);
  });
  it('tapped, it limits nothing', () => {
    const s0 = scenario([], { defs, p1: { battlefield: [tapped('Test Orb')] }, p2 });
    const { s, asked } = toStep(s0, 2, 'upkeep');
    expect(asked).toEqual([]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && isTapped(s, id))).toHaveLength(0);
  });
});

describe('CR 502.3: "You can\'t untap more than one land during your untap step." limits only its controller\'s untap step', () => {
  const WORM = card('Test Sloth Worm', 'Creature — Wurm', "You can't untap more than one land during your untap step.", ['6', '5']);
  const defs = [WORM, FIELD];
  it('its controller untaps one land of two; the opponent untaps both', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Sloth Worm', tapped('Test Field'), tapped('Test Field')] }, p2: { battlefield: [tapped('Test Field'), tapped('Test Field')] } });
    const mid = toStep(s0, 2, 'upkeep');
    expect(mid.asked).toEqual([]);
    expect(mid.s.zones.battlefield.filter((id) => s0.objects[id]?.controller === 'p2' && isTapped(mid.s, id))).toHaveLength(0);
    const end = toStep(mid.s, 3, 'upkeep');
    expect(end.asked).toHaveLength(1);
    expect(end.s.zones.battlefield.filter((id) => end.s.objects[id]!.controller === 'p1' && end.s.objects[id]!.defId === 'Test Field' && isTapped(end.s, id))).toHaveLength(1);
  });
});

describe('CR 121.1, 614.17: "Each player can\'t draw more than one card each turn."', () => {
  const MAZE = card('Test Maze Spirit', 'Creature — Spirit', "Each player can't draw more than one card each turn.", ['3', '1']);
  const MUSE = card('Test Muse', 'Artifact', '{0}: Draw two cards.');
  const QUIET = card('Test Quiet Sage', 'Creature — Human', "Each opponent can't draw more than one card each turn.", ['1', '1']);
  const defs = [MAZE, MUSE, QUIET];
  const drawTwo = (s: GameState): GameState => {
    const a = legal(s, 'p1', 'activate').find((x) => /Draw two/i.test(x.label));
    expect(a, labels(s, 'p1').join(' | ')).toBeDefined();
    return resolveAll(settle(act(s, a!.action)));
  };
  it('is automated; a player who drew no card this turn draws one of two, and none after the first', () => {
    expect(automated(MAZE)).toBe(true);
    let s = scenario([], { defs, p1: { battlefield: ['Test Maze Spirit', 'Test Muse'] } });
    const hand0 = zoneNames(s, 'hand', 'p1').length;
    s = drawTwo(s);
    expect(zoneNames(s, 'hand', 'p1').length).toBe(hand0 + 1);
    s = drawTwo(s);
    expect(zoneNames(s, 'hand', 'p1').length).toBe(hand0 + 1);
  });
  it('a card drawn before it was on the battlefield counts (cards drawn this turn)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Maze Spirit', 'Test Muse'] } });
    s = tweak(s, (x) => { x.players.find((p) => p.id === 'p1')!.turnStats.cardsDrawn = 1; });
    const hand0 = zoneNames(s, 'hand', 'p1').length;
    expect(zoneNames(drawTwo(s), 'hand', 'p1').length).toBe(hand0);
  });
  it('"each opponent": its controller still draws both', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Quiet Sage', 'Test Muse'] } });
    const hand0 = zoneNames(s, 'hand', 'p1').length;
    s = drawTwo(s);
    expect(zoneNames(s, 'hand', 'p1').length).toBe(hand0 + 2);
  });
});

describe('CR 601.2i, 101.2: "Each player can\'t cast more than one noncreature spell each turn."', () => {
  const HUSH = card('Test Hush', 'Enchantment', "Each player can't cast more than one noncreature spell each turn.");
  const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.');
  const defs = [HUSH, TONIC, BEAR];
  it('is automated; after one noncreature spell the player can\'t cast another, but can still cast a creature spell; the other player is not limited by it', () => {
    expect(automated(HUSH)).toBe(true);
    let s = scenario([], { defs, p1: { battlefield: ['Test Hush'], hand: ['Test Tonic', 'Test Tonic', 'Test Bear'] }, p2: { hand: ['Test Tonic'] } });
    expect(labels(s, 'p1')).toContain('Cast Test Tonic');
    s = resolveAll(settle(castCard(s, 'Test Tonic')));
    expect(labels(s, 'p1')).not.toContain('Cast Test Tonic');
    expect(labels(s, 'p1')).toContain('Cast Test Bear');
    s = settle(castCard(s, 'Test Bear'));
    s = pass(s);
    expect(labels(s, 'p2')).toContain('Cast Test Tonic');
  });
  it('a creature spell cast first does not count', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Hush'], hand: ['Test Tonic', 'Test Bear'] } });
    s = resolveAll(settle(castCard(s, 'Test Bear')));
    expect(labels(s, 'p1')).toContain('Cast Test Tonic');
  });
});

describe('CR 613.1f: "Creatures your opponents control lose flying and can\'t have or gain flying."', () => {
  const GALE = card('Test Gale Warden', 'Enchantment', "Creatures your opponents control lose flying and can't have or gain flying.");
  const KITE = card('Test Kite', 'Creature — Bird', 'Flying', ['1', '1']);
  const WINGS = card('Test Wings', 'Instant', 'Target creature gains flying until end of turn.');
  const defs = [GALE, KITE, WINGS, BEAR];
  it('is automated; the opponent\'s flier loses flying and a later grant does not give it back; its controller\'s flier keeps it', () => {
    expect(automated(GALE)).toBe(true);
    let s = scenario([], { defs, p1: { battlefield: ['Test Gale Warden', 'Test Kite'] }, p2: { battlefield: ['Test Kite', 'Test Bear'], hand: ['Test Wings'] } });
    const theirs = find(s, 'Test Kite', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(flies(s, theirs)).toBe(false);
    expect(flies(s, find(s, 'Test Kite', 'battlefield', 'p1'))).toBe(true);
    s = pass(s);
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Wings', 'hand', 'p2') }), undefined, [{ kind: 'object', id: bear }]);
    s = resolveAll(s);
    expect(flies(s, bear)).toBe(false);
  });
});

describe('CR 701.35a: detain', () => {
  const WARRANT = card('Test Warrant', 'Sorcery', 'Detain target creature an opponent controls.');
  const PINGER = card('Test Pinger', 'Creature — Human', '{0}: You gain 1 life.', ['2', '2']);
  const defs = [WARRANT, PINGER];
  it('until its controller\'s next turn the creature can\'t attack and its activated abilities can\'t be activated; then it can again', () => {
    expect(automated(WARRANT)).toBe(true);
    let s = scenario([], { defs, p1: { hand: ['Test Warrant'] }, p2: { battlefield: ['Test Pinger'] } });
    const pinger = find(s, 'Test Pinger', 'battlefield', 'p2');
    s = resolveAll(settle(castCard(s, 'Test Warrant'), undefined, [{ kind: 'object', id: pinger }]));
    s = toStep(s, 2, 'main1').s;
    expect(labels(s, 'p2').some((l) => /1 life/.test(l))).toBe(false);
    s = toStep(s, 2, 'beginCombat').s;
    const t = toStep(s, 2, 'declareAttackers');
    expect(t.s.pending?.kind === 'declareAttackers' && (t.s.pending as unknown as { candidates: { id: string }[] }).candidates.some((c) => c.id === pinger)).toBe(false);
    s = toStep(t.s, 3, 'main1').s;
    s = pass(s);
    expect(labels(s, 'p2').some((l) => /1 life/.test(l))).toBe(true);
  });
});

describe('CR 119.7, 119.8, 119.4: "Your life total can\'t change."', () => {
  const STATUE = card('Test Steady Statue', 'Artifact', "Your life total can't change.");
  const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.');
  const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to any target.');
  const ALTAR = card('Test Blood Altar', 'Artifact', 'Pay 2 life: You gain 1 life.');
  const defs = [STATUE, TONIC, SHOCK, ALTAR];
  it('is automated; its controller gains no life, loses none to damage and can\'t pay life; the opponent\'s life changes', () => {
    expect(automated(STATUE)).toBe(true);
    let s = scenario([], { defs, p1: { battlefield: ['Test Steady Statue', 'Test Blood Altar'], hand: ['Test Tonic', 'Test Shock', 'Test Shock'] } });
    const p1 = life(s, 'p1');
    const p2 = life(s, 'p2');
    s = resolveAll(settle(castCard(s, 'Test Tonic')));
    expect(life(s, 'p1')).toBe(p1);
    s = resolveAll(settle(castCard(s, 'Test Shock'), undefined, [{ kind: 'player', id: 'p1' }]));
    expect(life(s, 'p1')).toBe(p1);
    s = resolveAll(settle(castCard(s, 'Test Shock'), undefined, [{ kind: 'player', id: 'p2' }]));
    expect(life(s, 'p2')).toBe(p2 - 2);
    expect(labels(s, 'p1').some((l) => /Pay 2 life/.test(l))).toBe(false);
  });
});

describe('CR 601.2f, 611.2a: "Until your next turn, creature spells your opponents cast cost {2} more to cast."', () => {
  const TOLL = card('Test Toll', 'Sorcery', 'Until your next turn, creature spells your opponents cast cost {2} more to cast.');
  const CUB = card('Test Cub', 'Creature — Cat', '', ['1', '1'], '{1}');
  const defs = [TOLL, CUB, FIELD];
  it('is automated; the opponent can\'t cast a {1} creature with two lands until the caster\'s next turn; the caster still can', () => {
    expect(automated(TOLL)).toBe(true);
    let s = scenario([], { defs, p1: { hand: ['Test Toll', 'Test Cub'], battlefield: ['Test Field'] }, p2: { hand: ['Test Cub'], battlefield: ['Test Field', 'Test Field'] } });
    s = resolveAll(settle(castCard(s, 'Test Toll')));
    expect(labels(s, 'p1')).toContain('Cast Test Cub');
    s = toStep(s, 2, 'main1').s;
    expect(labels(s, 'p2')).not.toContain('Cast Test Cub');
    s = toStep(s, 4, 'main1').s;
    expect(labels(s, 'p2')).toContain('Cast Test Cub');
  });
});
