/**
 * Cloud batch 2, slice std-blb (the Standard backlog of Bloomburrow, tuning half): the templates of parser/templates/zz-cloud/std-blb.json and the parser,
 * renderer and engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 608.2c, 118.12            "Then if C, sacrifice ~. If you do, create ..." (eff.t34.thenIf, parser/lower/conditions.ts#foldDidInIf)
 *   CR 608.2c, 608.2h            "Then if you have fewer than N cards in hand, draw cards equal to the difference."
 *   CR 608.2c, 110.2, 614.1c     "Mill N cards. Then return all land cards from your graveyard to the battlefield tapped."
 *   CR 611.2c, 608.2h, 613.4c    "Until end of turn, target creature you control gains vigilance and gets +X/+X, where X is ..."
 *   CR 608.2c, 611.2a            "It also gets +1/+0 until end of turn if you control a Mouse."
 *   CR 115.1, 601.2c             "target attacking, blocking, or tapped creature"; "costs {1} less to cast if it targets an attacking or tapped creature"
 *   CR 602.5b                    "Activate only if an opponent lost life this turn and only once each turn."; "... if three or more cards left your graveyard
 *                                this turn or if you've sacrificed a Food this turn."
 *   CR 603.7, 608.2c             "If C, return that card ... at the beginning of the next end step." (the condition is checked as the spell resolves)
 *   CR 614.1a, 400.3, 111.7      "If a card or token would be put into your graveyard from anywhere, exile it instead."
 *   CR 614.1a, 120.3, 120.2b     "If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage
 *                                plus 2 instead."
 *   CR 700.2i, 700.2d, 115.3     "Choose up to five {P} worth of modes. You may choose the same mode more than once."; "Choose three. You may choose the same mode
 *                                more than once." (each instance of a mode has its own targets)
 *   CR 107.3, 401.1, 608.2c      "Look at twice X cards from the top of your library. Put X cards from among them into your hand and the rest into your graveyard."
 *   CR 608.2c, 707.2             "Choose a creature you control. Create a token that's a copy of it." (a choice, not a target)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Fully automated: no manual ability or step, and the card's level is full (no experimental template caps it, design 6.9). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
type Tgt = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
const obj = (id: ObjectId): Tgt => ({ kind: 'object', id });

/** Answer the decisions that come up until priority (payments automatic; the targets `targets` in order; yes to every may; choices the first allowed). */
function drive(s0: GameState, targets: Tgt[][] = [], yes = true): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.max }); // X: the most the player can pay
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets?: Tgt[][], yes = true): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, yes);
  return s;
}
const cast = (s: GameState, name: string, targets?: Tgt[][], yes = true): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, yes), targets, yes);
const activations = (s: GameState, name: string) => legal(s, 'p1', 'activate').filter((x) => findAll(s, name, 'battlefield', 'p1').includes(x.object as ObjectId));
const activate = (s: GameState, name: string, targets: Tgt[][] = []): GameState => {
  const a = activations(s, name)[0];
  if (a === undefined) throw new Error(`no activation of ${name}`);
  return resolveAll(drive(act(s, a.action), targets), targets);
};

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SHOCK = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.');

describe('CR 608.2c, 118.12: "Create a Food token. Then if you control three or more Foods, sacrifice ~. If you do, draw two cards."', () => {
  const PANTRY = card('Test Pantry', 'Artifact', '{0}, {T}: Create a Food token. Then if you control three or more Foods, sacrifice this artifact. If you do, draw two cards.');
  it('is fully automated (eff.t34.thenIf is stable; "If you do" reads the sacrifice inside the branch)', () => {
    expect(full(PANTRY)).toBe(true);
    const steps = JSON.stringify(PANTRY.faces[0]!.abilities[0]);
    expect(steps).toMatch(/"op":"if".*"then":\[\{"op":"sacrifice".*"as":"did".*\{"op":"if","cond":\{"cond":"did","step":"did"\}/);
  });
  it('below three Foods nothing is sacrificed and nothing is drawn; at three the artifact is sacrificed and two cards are drawn', () => {
    let s = scenario([], { defs: [PANTRY], p1: { battlefield: ['Test Pantry'] } });
    const h0 = hand(s, 'p1');
    s = activate(s, 'Test Pantry');
    expect(findAll(s, 'Test Pantry', 'battlefield')).toHaveLength(1);
    expect(hand(s, 'p1')).toBe(h0);
    // untap it by passing to the next turn of p1 is long; put two more Foods instead by activating a fresh copy
    let t = scenario([], { defs: [PANTRY], p1: { battlefield: ['Test Pantry', 'Test Pantry', 'Test Pantry'] } });
    const h1 = hand(t, 'p1');
    t = activate(t, 'Test Pantry');
    t = activate(t, 'Test Pantry');
    expect(findAll(t, 'Test Pantry', 'battlefield')).toHaveLength(3);
    t = activate(t, 'Test Pantry'); // the third Food: this one is sacrificed, and you draw two
    expect(findAll(t, 'Test Pantry', 'battlefield')).toHaveLength(2);
    expect(hand(t, 'p1')).toBe(h1 + 2);
  });
});

describe('CR 608.2c, 608.2h, guard G10: "Draw a card. Then if you have fewer than three cards in hand, draw cards equal to the difference."', () => {
  const REFILL = card('Test Refill', 'Sorcery', 'Draw a card. Then if you have fewer than three cards in hand, draw cards equal to the difference.');
  it('"the difference" names the condition of its own "Then if" (no contagion): the draw before it stays automated, and since Cloud std-fin renders "the difference" inside a branch the sentence is automated too: if you have fewer than three cards, draw three minus your hand size (CR 608.2c, 608.2h)', () => {
    const steps = (REFILL.faces[0]!.abilities[0] as { effect: { steps: { op: string }[] } }).effect.steps;
    expect(steps[0]).toEqual({ op: 'draw', who: { ref: 'you' }, count: 1 });
    const hand = { q: 'zoneSize', zone: 'hand', of: { ref: 'you' } };
    expect(steps[1]).toEqual({ op: 'if', cond: { cond: 'compare', left: hand, op: '<', right: 3 }, then: [{ op: 'draw', who: { ref: 'you' }, count: { q: 'math', op: '-', args: [3, hand] } }] });
    expect(REFILL.automation.level).toBe('full');
  });
});

describe('CR 608.2c, 110.2, 614.1c: "Mill two cards. Then return all land cards from your graveyard to the battlefield tapped."', () => {
  const RECLAIM = card('Test Reclaim', 'Sorcery', 'Mill two cards. Then return all land cards from your graveyard to the battlefield tapped.');
  it('is fully automated, and every land card of your graveyard (the milled ones too) enters tapped under your control', () => {
    expect(full(RECLAIM)).toBe(true);
    const s0 = scenario(['Forest', 'Island'], { defs: [RECLAIM, BEAR], p1: { hand: ['Test Reclaim'], graveyard: ['Forest', 'Test Bear'], library: ['Island', 'Island'] } });
    const s = cast(s0, 'Test Reclaim');
    const lands = s.zones.battlefield.filter((id) => ['Forest', 'Island'].includes(s.objects[id]!.defId));
    expect(lands.length).toBeGreaterThanOrEqual(2);
    for (const id of lands) expect(s.objects[id]!.tapped).toBe(true);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Bear');
  });
});

describe('CR 611.2c, 608.2h, 613.4c: "Until end of turn, target creature you control gains vigilance and gets +X/+X, where X is the number of creatures you control."', () => {
  const RALLY = card('Test Rally', 'Instant', 'Until end of turn, target creature you control gains vigilance and gets +X/+X, where X is the number of creatures you control.');
  it('is fully automated; X is counted as it resolves and the bonus stays when the count changes (CR 611.2c)', () => {
    expect(full(RALLY)).toBe(true);
    let s = scenario([], { defs: [RALLY, BEAR, SHOCK], p1: { hand: ['Test Rally', 'Test Zap'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    const [a, b] = findAll(s, 'Test Bear', 'battlefield', 'p1');
    s = cast(s, 'Test Rally', [[obj(a!)]]);
    expect(ptOf(s, a!)).toBe('5/5');
    expect(hasKeyword(getChars(s, a!)!, 'vigilance')).toBe(true);
    s = cast(s, 'Test Zap', [[obj(b!)]]); // a Bear dies: the count drops, the pump does not
    expect(ptOf(s, a!)).toBe('5/5');
  });
});

describe('CR 608.2c, 611.2a: "Target creature gains trample until end of turn. It also gets +1/+0 until end of turn if you control a Mouse. Draw a card."', () => {
  const MIGHT = card('Test Might', 'Instant', 'Target creature gains trample until end of turn. It also gets +1/+0 until end of turn if you control a Mouse.\nDraw a card.');
  const MOUSE = card('Test Mouse', 'Creature — Mouse', '', { pt: ['1', '1'] });
  it('is fully automated', () => expect(full(MIGHT)).toBe(true));
  it('with a Mouse: trample and +1/+0; you draw', () => {
    let s = scenario([], { defs: [MIGHT, MOUSE, BEAR], p1: { hand: ['Test Might'], battlefield: ['Test Bear', 'Test Mouse'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    const h0 = hand(s, 'p1');
    s = cast(s, 'Test Might', [[obj(bear)]]);
    expect(ptOf(s, bear)).toBe('3/2');
    expect(hasKeyword(getChars(s, bear)!, 'trample')).toBe(true);
    expect(hand(s, 'p1')).toBe(h0); // cast one, drew one
  });
  it('without a Mouse: trample only', () => {
    let s = scenario([], { defs: [MIGHT, MOUSE, BEAR], p1: { hand: ['Test Might'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = cast(s, 'Test Might', [[obj(bear)]]);
    expect(ptOf(s, bear)).toBe('2/2');
    expect(hasKeyword(getChars(s, bear)!, 'trample')).toBe(true);
  });
});

describe('CR 115.1, 601.2c: "~ deals 4 damage to target attacking, blocking, or tapped creature. You gain 3 life if you control a Bat."', () => {
  const STRIKE = card('Test Sonic', 'Instant', 'Test Sonic deals 4 damage to target attacking, blocking, or tapped creature. You gain 3 life if you control a Bat.');
  const BAT = card('Test Bat', 'Creature — Bat', '', { pt: ['1', '1'] });
  it('is fully automated; the target is any of the three statuses', () => {
    expect(full(STRIKE)).toBe(true);
    expect(JSON.stringify(STRIKE.faces[0]!.abilities[0])).toContain('"anyOf":[{"attacking":true},{"blocking":true},{"tapped":true}]');
  });
  it('an untapped creature that is not in combat is not a legal target; a tapped one is, and you gain 3 life with a Bat', () => {
    let s = scenario([], { defs: [STRIKE, BAT, BEAR], p1: { hand: ['Test Sonic'], battlefield: ['Test Bat'] }, p2: { battlefield: ['Test Bear', { name: 'Test Bear', tapped: true }] } });
    const [untapped, tapped] = findAll(s, 'Test Bear', 'battlefield', 'p2');
    const s1 = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sonic', 'hand', 'p1') });
    expect(s1.pending?.kind).toBe('chooseTargets');
    const allowed = JSON.stringify(s1.pending);
    expect(allowed).toContain(tapped!);
    expect(allowed).not.toContain(`"${untapped!}"`);
    const l0 = life(s, 'p1');
    s = cast(s, 'Test Sonic', [[obj(tapped!)]]);
    expect(findAll(s, 'Test Bear', 'battlefield', 'p2')).toEqual([untapped]);
    expect(life(s, 'p1')).toBe(l0 + 3);
  });
});

describe('CR 601.2f, 115.1: "This spell costs {1} less to cast if it targets an attacking or tapped creature."', () => {
  const DRAFT = card('Test Draft', 'Instant', "This spell costs {1} less to cast if it targets an attacking or tapped creature.\nTarget creature's owner puts it on their choice of the top or bottom of their library.", { cost: '{1}{U}' });
  it('is fully automated and reads the target as attacking or tapped', () => {
    expect(full(DRAFT)).toBe(true);
    expect(JSON.stringify(DRAFT.faces[0]!.abilities[0])).toContain('"anyOf":[{"attacking":true},{"tapped":true}]');
  });
});

describe('CR 602.5b: "{1}{R}: Put a +1/+1 counter on ~. Activate only if an opponent lost life this turn and only once each turn."', () => {
  const CLAW = card('Test Claw', 'Creature — Lizard', '{0}: Put a +1/+1 counter on this creature. Activate only if an opponent lost life this turn and only once each turn.', { pt: ['1', '1'] });
  it('is fully automated: the condition is read from the turn\'s history when the ability is activated (no attestation)', () => {
    expect(full(CLAW)).toBe(true);
    const a = CLAW.faces[0]!.abilities[0] as { onlyIf?: unknown; limit?: unknown };
    expect(a.onlyIf).toEqual({ cond: 'happened', event: { ev: 'life', change: 'loss', player: 'opponent' }, scope: 'turn' });
    expect(a.limit).toEqual({ per: 'turn', max: 1 });
  });
  it('not offered before an opponent lost life; offered once after; not a second time this turn', () => {
    let s = scenario([], { defs: [CLAW, SHOCK], p1: { hand: ['Test Zap'], battlefield: ['Test Claw'] } });
    expect(activations(s, 'Test Claw')).toHaveLength(0);
    s = cast(s, 'Test Zap', [[{ kind: 'player', id: 'p2' }]]);
    expect(activations(s, 'Test Claw')).toHaveLength(1);
    s = activate(s, 'Test Claw');
    expect(ptOf(s, find(s, 'Test Claw', 'battlefield'))).toBe('2/2');
    expect(activations(s, 'Test Claw')).toHaveLength(0);
  });
  it('your own life loss does not count', () => {
    let s = scenario([], { defs: [CLAW, SHOCK], p1: { hand: ['Test Zap'], battlefield: ['Test Claw'] } });
    s = cast(s, 'Test Zap', [[{ kind: 'player', id: 'p1' }]]);
    expect(activations(s, 'Test Claw')).toHaveLength(0);
  });
});

describe('CR 602.5b, 400.3: "Activate only if three or more cards left your graveyard this turn or if you\'ve sacrificed a Food this turn."', () => {
  const KEEPER = card('Test Keeper', 'Creature — Squirrel', '{T}, Pay 1 life: Draw a card. Activate only if three or more cards left your graveyard this turn or if you\'ve sacrificed a Food this turn.', { pt: ['1', '1'] });
  const DIG = card('Test Dig', 'Sorcery', 'Exile up to three target cards from your graveyard.');
  it('is fully automated', () => expect(full(KEEPER)).toBe(true));
  it('offered only once three cards have left your graveyard this turn', () => {
    let s = scenario([], { defs: [KEEPER, DIG, BEAR], p1: { hand: ['Test Dig'], battlefield: ['Test Keeper'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    expect(activations(s, 'Test Keeper')).toHaveLength(0);
    const gy = findAll(s, 'Test Bear', 'graveyard', 'p1');
    s = cast(s, 'Test Dig', [gy.slice(0, 2).map(obj)]);
    expect(activations(s, 'Test Keeper')).toHaveLength(0); // two of them (and Test Dig went to the graveyard, it did not leave it)
    let t = scenario([], { defs: [KEEPER, DIG, BEAR], p1: { hand: ['Test Dig'], battlefield: ['Test Keeper'], graveyard: ['Test Bear', 'Test Bear', 'Test Bear'] } });
    t = cast(t, 'Test Dig', [findAll(t, 'Test Bear', 'graveyard', 'p1').map(obj)]);
    expect(activations(t, 'Test Keeper')).toHaveLength(1);
    const h0 = hand(t, 'p1');
    t = activate(t, 'Test Keeper');
    expect(hand(t, 'p1')).toBe(h0 + 1);
  });
});

describe('CR 603.7, 608.2c, 702.174: "Exile target nontoken creature. If the gift wasn\'t promised, return that card ... at the beginning of the next end step."', () => {
  const GUST = card('Test Gale', 'Instant', 'Exile target nontoken creature. If you control a Bat, return that card to the battlefield under its owner\'s control with a +1/+1 counter on it at the beginning of the next end step.');
  const BAT = card('Test Bat', 'Creature — Bat', '', { pt: ['1', '1'] });
  it('is fully automated: the condition is checked as the spell resolves and only then is the delayed trigger created', () => {
    expect(full(GUST)).toBe(true);
    const d = JSON.stringify(GUST.faces[0]!.abilities[0]);
    expect(d).toMatch(/"op":"if","cond":\{"cond":"exists".*"then":\[\{"op":"delay"/);
  });
  it('with a Bat the exiled creature comes back at the end step with a counter; without one it stays exiled', () => {
    let s = scenario([], { defs: [GUST, BAT, BEAR], p1: { hand: ['Test Gale'], battlefield: ['Test Bat'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Gale', [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]]);
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(0);
    s = resolveAll(advanceTo(s, 1, 'end'));
    const back = findAll(s, 'Test Bear', 'battlefield', 'p2');
    expect(back).toHaveLength(1);
    expect(s.objects[back[0]!]!.counters['+1/+1']).toBe(1);
    let t = scenario([], { defs: [GUST, BAT, BEAR], p1: { hand: ['Test Gale'] }, p2: { battlefield: ['Test Bear'] } });
    t = cast(t, 'Test Gale', [[obj(find(t, 'Test Bear', 'battlefield', 'p2'))]]);
    t = resolveAll(advanceTo(t, 1, 'end'));
    expect(findAll(t, 'Test Bear', 'battlefield')).toHaveLength(0);
  });
});

describe('CR 614.1a, 400.3, 111.7: "If a card or token would be put into your graveyard from anywhere, exile it instead."', () => {
  const PYRE = card('Test Pyre', 'Enchantment', 'If a card or token would be put into your graveyard from anywhere, exile it instead.');
  const KILL = card('Test Doom', 'Instant', 'Destroy target creature.');
  it('is fully automated; your creature card that dies is exiled, the opponent\'s goes to their graveyard', () => {
    expect(full(PYRE)).toBe(true);
    let s = scenario([], { defs: [PYRE, KILL, BEAR], p1: { hand: ['Test Doom', 'Test Doom'], battlefield: ['Test Pyre', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    s = cast(s, 'Test Doom', [[obj(find(s, 'Test Bear', 'battlefield', 'p1'))]]);
    expect(zoneNames(s, 'graveyard', 'p1')).not.toContain('Test Bear');
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Bear');
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toContain('Test Doom'); // the spell itself, put into your graveyard as it resolves
    s = cast(s, 'Test Doom', [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]]);
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Bear');
  });
});

describe('CR 614.1a, 120.3, 120.2b: "If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead."', () => {
  const STAGE = card('Test Stage', 'Enchantment', 'If a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus 2 instead.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
  it('is fully automated', () => expect(full(STAGE)).toBe(true));
  it('+2 to an opponent and to a creature an opponent controls; nothing more to your own creature or to you', () => {
    let s = scenario([], { defs: [STAGE, SHOCK, OGRE], p1: { hand: ['Test Zap', 'Test Zap', 'Test Zap', 'Test Zap'], battlefield: ['Test Stage', 'Test Ogre'] }, p2: { battlefield: ['Test Ogre'] } });
    const l2 = life(s, 'p2');
    s = cast(s, 'Test Zap', [[{ kind: 'player', id: 'p2' }]]);
    expect(life(s, 'p2')).toBe(l2 - 3);
    const theirs = find(s, 'Test Ogre', 'battlefield', 'p2');
    s = cast(s, 'Test Zap', [[obj(theirs)]]);
    expect(s.objects[theirs]!.damage).toBe(3);
    const mine = find(s, 'Test Ogre', 'battlefield', 'p1');
    s = cast(s, 'Test Zap', [[obj(mine)]]);
    expect(s.objects[mine]!.damage).toBe(1);
    const l1 = life(s, 'p1');
    s = cast(s, 'Test Zap', [[{ kind: 'player', id: 'p1' }]]);
    expect(life(s, 'p1')).toBe(l1 - 1);
  });
});

/** Cast `name` and answer the mode choice with `modes` (indices, repeats allowed); then targets in order, payments automatic. */
function castModes(s0: GameState, name: string, modes: number[], targets: Tgt[][] = []): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let guard = 0; guard < 10 && s.pending?.kind === 'payCost'; guard++) s = answer(s, { kind: 'payCost', auto: true });
  expect(s.pending?.kind).toBe('chooseOption');
  s = answer(s, { kind: 'chooseOption', ids: modes.map(String) });
  return resolveAll(drive(s, targets), targets);
}

describe('CR 700.2i, 700.2d: "Choose up to five {P} worth of modes. You may choose the same mode more than once." over "{P} -- ..." modes', () => {
  const SEASON = card('Test Season', 'Sorcery', 'Choose up to five {P} worth of modes. You may choose the same mode more than once.\n{P} — Draw a card.\n{P}{P} — Create a 1/1 white Rabbit creature token.\n{P}{P}{P} — Exile target nonland permanent. Its controller draws a card.');
  it('is fully automated: the budget, the pawprints of each mode, repeats allowed', () => {
    expect(full(SEASON)).toBe(true);
    const m = (SEASON.faces[0]!.abilities[0] as { effect: { modes: { min: number; max: number; pawprints: number; allowRepeat: boolean; options: { pawprints: number }[] } } }).effect.modes;
    expect([m.min, m.max, m.pawprints, m.allowRepeat]).toEqual([0, 5, 5, true]);
    expect(m.options.map((o) => o.pawprints)).toEqual([1, 2, 3]);
  });
  it('five draws ({P} five times)', () => {
    const s0 = scenario([], { defs: [SEASON], p1: { hand: ['Test Season'] } });
    const h0 = hand(s0, 'p1');
    const s = castModes(s0, 'Test Season', [0, 0, 0, 0, 0]);
    expect(hand(s, 'p1')).toBe(h0 - 1 + 5);
  });
  it('a Rabbit twice and a draw (2 + 2 + 1 pawprints)', () => {
    const s0 = scenario([], { defs: [SEASON], p1: { hand: ['Test Season'] } });
    const h0 = hand(s0, 'p1');
    const s = castModes(s0, 'Test Season', [1, 0, 1]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1')).toHaveLength(2);
    expect(hand(s, 'p1')).toBe(h0 - 1 + 1);
  });
  it('more than five pawprints together is refused (3 + 3)', () => {
    const s0 = scenario([], { defs: [SEASON, BEAR], p1: { hand: ['Test Season'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Season', 'hand', 'p1') });
    for (let guard = 0; guard < 10 && s.pending?.kind === 'payCost'; guard++) s = answer(s, { kind: 'payCost', auto: true });
    expect(() => answer(s, { kind: 'chooseOption', ids: ['2', '2'] })).toThrow(/pawprints/);
  });
  it('CR 700.2d, 115.3: the exile mode chosen... once with 3 pawprints, and its target is its own (the other modes have none)', () => {
    const s0 = scenario([], { defs: [SEASON, BEAR], p1: { hand: ['Test Season'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const h2 = hand(s0, 'p2');
    const s = castModes(s0, 'Test Season', [2, 0], [[obj(bear)]]);
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(0);
    expect(hand(s, 'p2')).toBe(h2 + 1);
  });
});

describe('CR 700.2d, 115.3: "Choose three. You may choose the same mode more than once." (a mode chosen twice has targets of its own)', () => {
  const CONFLUENCE = card('Test Confluence', 'Instant', 'Choose three. You may choose the same mode more than once.\n• Destroy target artifact.\n• Draw a card.\n• Target player gains 2 life.');
  const GEAR = card('Test Gear', 'Artifact', '');
  it('is fully automated', () => expect(full(CONFLUENCE)).toBe(true));
  it('the destroy mode twice destroys two different artifacts; the third mode draws', () => {
    const s0 = scenario([], { defs: [CONFLUENCE, GEAR], p1: { hand: ['Test Confluence'] }, p2: { battlefield: ['Test Gear', 'Test Gear', 'Test Gear'] } });
    const [a, b, c] = findAll(s0, 'Test Gear', 'battlefield', 'p2');
    const h0 = hand(s0, 'p1');
    const s = castModes(s0, 'Test Confluence', [0, 1, 0], [[obj(a!)], [obj(b!)]]);
    expect(findAll(s, 'Test Gear', 'battlefield', 'p2')).toEqual([c]);
    expect(hand(s, 'p1')).toBe(h0 - 1 + 1);
  });
  it('the life mode three times: the same player may be chosen for each instance (CR 115.3), and gains 6', () => {
    const s0 = scenario([], { defs: [CONFLUENCE, GEAR], p1: { hand: ['Test Confluence'] } });
    const l0 = life(s0, 'p1');
    const me: Tgt = { kind: 'player', id: 'p1' };
    const s = castModes(s0, 'Test Confluence', [2, 2, 2], [[me], [me], [me]]);
    expect(life(s, 'p1')).toBe(l0 + 6);
  });
});

describe('CR 107.3, 401.1, 608.2c: "Look at twice X cards from the top of your library. Put X cards from among them into your hand and the rest into your graveyard. You lose X life."', () => {
  const GAZE = card('Test Gaze', 'Sorcery', 'Look at twice X cards from the top of your library. Put X cards from among them into your hand and the rest into your graveyard. You lose X life.', { cost: '{X}' });
  it('is fully automated', () => expect(full(GAZE)).toBe(true));
  it('with X = 2: four cards looked at, two into your hand, the other two into your graveyard, and you lose 2 life', () => {
    const s0 = scenario([], { defs: [GAZE], p1: { hand: ['Test Gaze'], battlefield: ['Plains', 'Plains'] } });
    const h0 = hand(s0, 'p1');
    const lib0 = s0.zones.library.p1!.length;
    const gy0 = s0.zones.graveyard.p1!.length;
    const l0 = life(s0, 'p1');
    const s = cast(s0, 'Test Gaze');
    expect(hand(s, 'p1')).toBe(h0 - 1 + 2);
    expect(s.zones.library.p1!.length).toBe(lib0 - 4);
    expect(s.zones.graveyard.p1!.length).toBe(gy0 + 2 + 1); // the two cards and the spell itself
    expect(life(s, 'p1')).toBe(l0 - 2);
  });
});

describe('CR 608.2c, 707.2: "Choose a creature you control. Create a token that\'s a copy of it." (a choice as it resolves, not a target)', () => {
  const DOUBLE = card('Test Double', 'Sorcery', "Choose a creature you control. Create a token that's a copy of it.");
  it('is fully automated and announces no target', () => {
    expect(full(DOUBLE)).toBe(true);
    expect(JSON.stringify(DOUBLE.faces[0]!.abilities[0])).toContain('"targets":[]');
  });
  it('copies the creature you choose; an opponent\'s creature is never offered', () => {
    const CUB = card('Test Cub', 'Creature — Bear', '', { pt: ['1', '1'] });
    const s0 = scenario([], { defs: [DOUBLE, BEAR, CUB], p1: { hand: ['Test Double'], battlefield: ['Test Bear', 'Test Cub'] }, p2: { battlefield: ['Test Bear'] } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Double', 'hand', 'p1') });
    s = drive(s);
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseObjects');
    const offered = s.pending?.kind === 'chooseObjects' ? [...s.pending.options].sort() : [];
    expect(offered).toEqual([find(s0, 'Test Bear', 'battlefield', 'p1'), find(s0, 'Test Cub', 'battlefield', 'p1')].sort());
    s = resolveAll(answer(s, { kind: 'chooseObjects', ids: [find(s0, 'Test Cub', 'battlefield', 'p1')] }));
    const cubs = findAll(s, 'Test Cub', 'battlefield', 'p1');
    expect(cubs).toHaveLength(2);
    expect(cubs.filter((id) => s.objects[id]!.kind === 'token').map((id) => ptOf(s, id))).toEqual(['1/1']);
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(2);
  });
  it('with no creature you control nothing is created', () => {
    const s0 = scenario([], { defs: [DOUBLE, BEAR], p1: { hand: ['Test Double'] }, p2: { battlefield: ['Test Bear'] } });
    const s = cast(s0, 'Test Double');
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(1);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
  });
});
