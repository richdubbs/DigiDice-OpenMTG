/**
 * FAST5X E12: suspect (CR 701.60) and collect evidence (CR 701.59), played through the engine with synthetic cards compiled by the game's default compiler
 * (wordings are invented, design 6.10).
 *
 *   CR 701.60a   "suspect X": it becomes suspected until it leaves the battlefield or an effect makes it no longer suspected
 *   CR 701.60b   suspected is a designation of a permanent only, not copiable; control changes keep it
 *   CR 701.60c   a suspected permanent has menace and "This creature can't block" (a rule-generated layer 6 effect with the timestamp of becoming suspected)
 *   CR 701.60d   a suspected permanent can't become suspected again
 *   CR 701.59a   collect evidence N: exile cards from your graveyard with total mana value N or more (an effect and a cost)
 *   CR 701.59b   a player who can't reach N can't choose to collect evidence ("you may" is not offered, the optional cost is not paid)
 *   CR 701.59c   "if evidence was collected" reads the linked optional additional cost of the spell (CR 607.2i), also on the permanent it became (CR 400.7d)
 *   CR 603.2     "whenever you collect evidence" triggers on both the cost and the effect
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, passBoth, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, lifeOf, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers' && s.pending.kind !== 'declareBlockers'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
function activate(s: GameState, id: ObjectId, script?: Script, player = 'p1'): GameState {
  const la = legal(s, player, 'activate').filter((a) => a.object === id && !a.isMana)[0];
  if (!la) throw new Error('no activated ability');
  return drive(act(s, la.action), script);
}
const canActivate = (s: GameState, id: ObjectId, player = 'p1'): boolean => legal(s, player, 'activate').some((a) => a.object === id && !a.isMana);
const suspected = (s: GameState, id: ObjectId): boolean => s.objects[id]?.suspected !== undefined;
const named = (s: GameState, name: string, zone: 'battlefield' | 'exile' = 'battlefield'): ObjectId[] => s.zones[zone].filter((id) => s.objects[id]!.defId === name);
const gy = (s: GameState, p = 'p1'): ObjectId[] => s.zones.graveyard[p]!;
const handSize = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
/** Can `blocker` block `attacker` (p1 attacks with it, p2 is asked)? A block the rules forbid is rejected (CR 509.1a-c). */
function canBlock(s0: GameState, attacker: ObjectId, blocker: ObjectId): boolean {
  const t = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[attacker]]));
  try {
    declareBlockers(t, [[blocker, attacker]]);
    return true;
  } catch {
    return false;
  }
}

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', ['3', '3']);
const BIG = card('Test Relic', 'Artifact', '', '{4}');
const SMALL = card('Test Charm', 'Artifact', '', '{1}');
const LAND = card('Test Land', 'Land', '');
const SNEAK = card('Test Sneak', 'Creature — Rogue', 'When Test Sneak enters, suspect it.', '{0}', ['2', '2']);
const ACCUSE = card('Test Accuse', 'Instant', 'Suspect up to one target creature.');
const PARDON = card('Test Pardon', 'Creature — Angel', 'When Test Pardon enters, all suspected creatures are no longer suspected.', '{0}', ['1', '1']);
const HUSH = card('Test Hush', 'Instant', 'Target creature loses all abilities until end of turn.');
const OFFENDER = card('Test Offender', 'Creature — Human', '{1}: If Test Offender is suspected, put a +1/+1 counter on it. Otherwise, suspect it.', '{0}', ['1', '1']);
const CORONER = card('Test Coroner', 'Creature — Ogre', '{0}, Sacrifice another creature: Draw a card. If the sacrificed creature was suspected, draw two cards instead.', '{0}', ['2', '2']);
const GRAB = card('Test Grab', 'Instant', 'Gain control of target creature until end of turn. Suspect it.');
const SEER = card('Test Seer', 'Creature — Merfolk', '{T}, Collect evidence 3: Draw a card.', '{0}', ['1', '1']);
const SCOUT = card('Test Scout', 'Creature — Elf', 'When Test Scout enters, you may collect evidence 4. If you do, you gain 5 life.', '{0}', ['1', '1']);
const CLERK = card('Test Clerk', 'Creature — Vedalken', 'Whenever you collect evidence, you gain 1 life.', '{0}', ['1', '1']);
const WARDEN = card('Test Warden', 'Creature — Elf', 'As an additional cost to cast this spell, you may collect evidence 5.\nWhen this creature enters, if evidence was collected, you gain 4 life.', '{0}', ['1', '1']);
const RUSH = card('Test Rush', 'Sorcery', 'As an additional cost to cast this spell, you may collect evidence 5.\nDraw a card. If evidence was collected, draw two cards instead.');
const BIRD = card('Test Bird', 'Creature — Phoenix', 'When this creature dies, you may exile it and collect evidence 4. If you do, return this card to the battlefield tapped.', '{3}', ['2', '2']);
const CHOMP = card('Test Chomp', 'Sorcery', 'As an additional cost to cast this spell, you may collect evidence 6. This spell costs {2} less to cast if evidence was collected.\nDraw a card.', '{2}{W}');
const RAISE = card('Test Raise', 'Instant', 'Return target creature card from your graveyard to the battlefield. Suspect it.');
const FEROX = card('Test Ferox', 'Creature — Beast', 'Ward--Collect evidence 4.', '{0}', ['4', '4']);
const JOLT = card('Test Jolt', 'Instant', 'Test Jolt deals 2 damage to target creature.');
const HERALD = card('Test Herald', 'Creature — Human', 'Whenever a creature you control with menace attacks, you gain 2 life.', '{0}', ['1', '1']);
const MOURNER = card('Test Mourner', 'Creature — Spirit', "When this creature dies, if it's not a token, you gain 3 life.", '{0}', ['1', '1']);
const PACT = compileCard({ name: 'Test Case of the Prism', layout: 'case', type_line: 'Enchantment — Case', mana_cost: '{1}', colors: [], oracle_text: [
  'To solve — There are five colors among permanents you control. (If unsolved, solve at the beginning of your end step.)',
  'Solved — Creatures you control get +1/+1.',
].join('\n') } as OracleCard);
const colored = (name: string, color: 'W' | 'U' | 'B' | 'R' | 'G'): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: `{${color}}`, type_line: 'Artifact', oracle_text: '', colors: [color] } as OracleCard);
const HUES = [colored('Test White', 'W'), colored('Test Blue', 'U'), colored('Test Black', 'B'), colored('Test Red', 'R'), colored('Test Green', 'G')];
const EYE = card('Test Eye', 'Artifact', '{0}, {T}: Draw a card. Activate only if there are five colors among permanents you control.');
const DEFS = [EYE, PACT, ...HUES, MOURNER, RAISE, FEROX, JOLT, HERALD, CHOMP, BEAR, OGRE, BIG, SMALL, LAND, SNEAK, ACCUSE, PARDON, HUSH, OFFENDER, CORONER, GRAB, SEER, SCOUT, CLERK, WARDEN, RUSH, BIRD];

describe('the synthetic cards are automated (FAST5X E12)', () => {
  it('every card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 701.60: suspect', () => {
  it('CR 701.60a, 701.60c: "suspect it" makes the creature suspected: it has menace and can\'t block', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Sneak'] }, p2: { battlefield: ['Test Bear'] } });
    s = resolveAll(cast(s, 'Test Sneak'));
    const sneak = find(s, 'Test Sneak', 'battlefield');
    expect(suspected(s, sneak)).toBe(true);
    expect(hasKeyword(getChars(s, sneak)!, 'menace')).toBe(true);
    // the restriction is the creature's own static ability "can't block" (CR 509.1a)
    expect(getChars(s, sneak)!.abilities.some((a) => a.def.kind === 'static' && a.def.text === '~ can\'t block.')).toBe(true);
  });

  it('CR 701.60c, 509.1a: a suspected creature is not a legal blocker; an unsuspected one is', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Ogre', since: 0 }] }, p2: { battlefield: ['Test Bear', 'Test Sneak'] } });
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const sneak = find(s0, 'Test Sneak', 'battlefield');
    const s = tweak(s0, (t) => { t.objects[sneak]!.suspected = t.counters.timestamp++; });
    expect(canBlock(s, ogre, bear)).toBe(true);
    expect(canBlock(s, ogre, sneak)).toBe(false);
  });

  it('CR 701.60d: a suspected creature can\'t become suspected again (no new timestamp)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Accuse'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = tweak(s, (t) => { t.objects[bear]!.suspected = 5; });
    s = resolveAll(cast(s, 'Test Accuse', { targets: [[obj(bear)]] }));
    expect(s.objects[bear]!.suspected).toBe(5);
  });

  it('CR 701.60a: "all suspected creatures are no longer suspected": menace and "can\'t block" go away', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Pardon'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = tweak(s, (t) => { t.objects[bear]!.suspected = t.counters.timestamp++; t.objects[ogre]!.suspected = t.counters.timestamp++; });
    expect(hasKeyword(getChars(s, ogre)!, 'menace')).toBe(true);
    s = resolveAll(cast(s, 'Test Pardon'));
    expect(suspected(s, bear)).toBe(false);
    expect(suspected(s, ogre)).toBe(false);
    expect(hasKeyword(getChars(s, ogre)!, 'menace')).toBe(false);
    expect(getChars(s, ogre)!.abilities.some((a) => a.def.kind === 'static')).toBe(false);
  });

  it('CR 613.7, 701.60c: losing all abilities after it became suspected removes menace and "can\'t block"; it stays suspected', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Hush'], battlefield: ['Test Sneak'] } });
    const sneak = find(s, 'Test Sneak', 'battlefield');
    s = tweak(s, (t) => { t.objects[sneak]!.suspected = t.counters.timestamp++; });
    s = resolveAll(cast(s, 'Test Hush', { targets: [[obj(sneak)]] }));
    expect(suspected(s, sneak)).toBe(true);
    expect(hasKeyword(getChars(s, sneak)!, 'menace')).toBe(false);
  });

  it('CR 613.7: suspected AFTER losing all abilities, it has menace (the later timestamp applies last)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Hush', 'Test Accuse'], battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(cast(s, 'Test Hush', { targets: [[obj(bear)]] }));
    s = resolveAll(cast(s, 'Test Accuse', { targets: [[obj(bear)]] }));
    expect(suspected(s, bear)).toBe(true);
    expect(hasKeyword(getChars(s, bear)!, 'menace')).toBe(true);
  });

  it('CR 701.60a-b, 400.7: control changes keep it; leaving the battlefield ends it (Caught Red-Handed style)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Grab'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = resolveAll(cast(s, 'Test Grab', { targets: [[obj(ogre)]] }));
    expect(s.objects[ogre]!.controller).toBe('p1');
    expect(suspected(s, ogre)).toBe(true);
    // the control effect ends in the cleanup step; the designation stays
    s = drive(passBoth(passBoth(passBoth(passBoth(passBoth(s))))));
    for (let i = 0; i < 30 && s.turn.number < 2; i++) s = s.pending?.kind === 'priority' ? passBoth(s) : drive(s);
    expect(s.objects[ogre]!.controller).toBe('p2');
    expect(suspected(s, ogre)).toBe(true);
  });

  it('"If ~ is suspected, put a +1/+1 counter on it. Otherwise, suspect it." (Repeat Offender)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Offender', 'Plains', 'Plains'] } });
    const off = find(s, 'Test Offender', 'battlefield');
    s = resolveAll(activate(s, off));
    expect(suspected(s, off)).toBe(true);
    expect(s.objects[off]!.counters['+1/+1'] ?? 0).toBe(0);
    s = resolveAll(activate(s, off));
    expect(s.objects[off]!.counters['+1/+1']).toBe(1);
  });

  it('CR 608.2h: "if the sacrificed creature was suspected" reads it as it last existed (Agency Coroner)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Coroner', 'Test Bear', 'Test Ogre'] } });
    const coroner = find(s, 'Test Coroner', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = tweak(s, (t) => { t.objects[ogre]!.suspected = t.counters.timestamp++; });
    const h0 = handSize(s);
    s = resolveAll(activate(s, coroner, { objects: [[bear]] }));
    expect(handSize(s)).toBe(h0 + 1);
    s = resolveAll(activate(s, coroner, { objects: [[ogre]] }));
    expect(handSize(s)).toBe(h0 + 3);
  });
});

describe('CR 701.60: suspect, with the rest of the game', () => {
  it('CR 400.7j: "Return target creature card ... to the battlefield. Suspect it." suspects the permanent it became', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Raise'], graveyard: ['Test Ogre'] } });
    const card = find(s, 'Test Ogre', 'graveyard');
    s = resolveAll(cast(s, 'Test Raise', { targets: [[obj(card)]] }));
    const ogre = named(s, 'Test Ogre');
    expect(ogre).toHaveLength(1);
    expect(suspected(s, ogre[0]!)).toBe(true);
    expect(hasKeyword(getChars(s, ogre[0]!)!, 'menace')).toBe(true);
  });

  it('CR 701.60c, 603.2: the menace a suspected creature has is seen by "whenever a creature you control with menace attacks" (J. Jonah Jameson)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Herald', 'Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = tweak(s, (t) => { t.objects[ogre]!.suspected = t.counters.timestamp++; });
    s = declareAttackers(toDeclareAttackers(s), [[ogre]]);
    s = resolveAll(drive(s));
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});

describe('the uncontracted negation the render gate now accepts ("if it is not a token")', () => {
  it('CR 603.4, 111.7: "When this creature dies, if it is not a token" triggers for a card and not for a token', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Mourner', 'Test Mourner'] } });
    const [a, b] = named(s, 'Test Mourner');
    s = tweak(s, (t) => { t.objects[b!]!.kind = 'token'; t.objects[a!]!.damage = 5; t.objects[b!]!.damage = 5; });
    s = resolveAll(drive(passBoth(s)));
    expect(lifeOf(s, 'p1')).toBe(23);
  });
});

describe('CR 719.3a, 105.1: "To solve — There are five colors among permanents you control" (Case of the Shattered Pact)', () => {
  it('the Case is full; it is solved at the end step with five colors among your permanents, not with four', () => {
    expect(full(PACT)).toBe(true);
    const toEnd = (s: GameState): GameState => drive(advanceTo(s, 1, 'end'));
    let four = scenario([], { defs: DEFS, p1: { battlefield: ['Test Case of the Prism', 'Test White', 'Test Blue', 'Test Black', 'Test Red'] } });
    four = resolveAll(toEnd(four));
    expect(four.objects[find(four, 'Test Case of the Prism', 'battlefield')]!.solved).toBeUndefined();
    let five = scenario([], { defs: DEFS, p1: { battlefield: ['Test Case of the Prism', 'Test White', 'Test Blue', 'Test Black', 'Test Red', 'Test Green'] } });
    five = resolveAll(toEnd(five));
    expect(five.objects[find(five, 'Test Case of the Prism', 'battlefield')]!.solved).toBe(true);
  });
  it('CR 602.5b: "Activate only if there are five colors among permanents you control" (Puca Eye) is read while activating', () => {
    expect(full(EYE)).toBe(true);
    const four = scenario([], { defs: DEFS, p1: { battlefield: ['Test Eye', 'Test White', 'Test Blue', 'Test Black', 'Test Red'], graveyard: ['Test Green'] } });
    expect(canActivate(four, find(four, 'Test Eye', 'battlefield'))).toBe(false);
    const five = scenario([], { defs: DEFS, p1: { battlefield: ['Test Eye', 'Test White', 'Test Blue', 'Test Black', 'Test Red', 'Test Green'] } });
    expect(canActivate(five, find(five, 'Test Eye', 'battlefield'))).toBe(true);
  });
});

describe('CR 701.59: collect evidence', () => {
  it('CR 702.21a, 701.59a: "Ward--Collect evidence 4": the opponent exiles cards from THEIR graveyard or the spell is countered', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ferox'] }, p2: { hand: ['Test Jolt', 'Test Jolt'], graveyard: ['Test Relic'], battlefield: ['Plains', 'Plains'] } });
    const ferox = find(s, 'Test Ferox', 'battlefield');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Jolt', { targets: [[obj(ferox)]] }, 'p2');
    s = resolveAll(s, { yes: [true], objects: [[find(s, 'Test Relic', 'graveyard', 'p2')]] });
    expect(named(s, 'Test Relic', 'exile')).toHaveLength(1);
    expect(s.objects[ferox]!.damage).toBe(2);
    // without the cards to pay, the ward counters the spell (CR 702.21a, 701.59b)
    let u = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ferox'] }, p2: { hand: ['Test Jolt'], graveyard: ['Test Charm'] } });
    const f2 = find(u, 'Test Ferox', 'battlefield');
    u = act(u, { type: 'pass', player: 'p1' });
    u = resolveAll(cast(u, 'Test Jolt', { targets: [[obj(f2)]] }, 'p2'), { yes: [true] });
    expect(u.objects[f2]!.damage).toBe(0);
    expect(named(u, 'Test Charm', 'exile')).toHaveLength(0);
  });


  it('CR 701.59a, 118.3: as a cost, exile cards with total mana value N or more; not activatable below N', () => {
    const poor = scenario([], { defs: DEFS, p1: { battlefield: ['Test Seer'], graveyard: ['Test Charm', 'Test Charm', 'Test Land'] } });
    expect(canActivate(poor, find(poor, 'Test Seer', 'battlefield'))).toBe(false);
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Seer', 'Test Clerk'], graveyard: ['Test Relic', 'Test Charm'] } });
    const relic = find(s, 'Test Relic', 'graveyard');
    const h0 = handSize(s);
    s = activate(s, find(s, 'Test Seer', 'battlefield'), { objects: [[relic]] });
    expect(s.objects[relic]).toBeUndefined();
    expect(named(s, 'Test Relic', 'exile')).toHaveLength(1);
    expect(gy(s).map((id) => s.objects[id]!.defId)).toEqual(['Test Charm']);
    s = resolveAll(s);
    expect(handSize(s)).toBe(h0 + 1);
    expect(lifeOf(s, 'p1')).toBe(21); // CR 603.2: "whenever you collect evidence" triggered on the cost
  });

  it('CR 701.59a: as an effect ("you may collect evidence 4. If you do, ..."), with the triggers', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Scout'], battlefield: ['Test Clerk'], graveyard: ['Test Charm', 'Test Charm', 'Test Charm', 'Test Charm', 'Test Land'] } });
    const charms = gy(s).filter((id) => s.objects[id]!.defId === 'Test Charm');
    s = resolveAll(cast(s, 'Test Scout'), { yes: [true], objects: [charms.slice(0, 2), [charms[2]!], [charms[3]!]] });
    expect(named(s, 'Test Charm', 'exile')).toHaveLength(4);
    expect(gy(s).map((id) => s.objects[id]!.defId)).toEqual(['Test Land']);
    expect(lifeOf(s, 'p1')).toBe(26); // 5 from "if you do", 1 from "whenever you collect evidence"
  });

  it('CR 701.59b, 608.2d: with less than N in the graveyard, "you may collect evidence" is not offered and "if you do" is false', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Scout'], battlefield: ['Test Clerk'], graveyard: ['Test Charm', 'Test Charm', 'Test Charm'] } });
    s = resolveAll(cast(s, 'Test Scout'));
    expect(gy(s)).toHaveLength(3);
    expect(lifeOf(s, 'p1')).toBe(20);
  });

  it('CR 701.59c, 607.2i, 400.7d: the optional additional cost; "if evidence was collected" on the permanent it became', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Warden'], graveyard: ['Test Relic', 'Test Charm'] } });
    s = resolveAll(cast(s, 'Test Warden', { yes: [true], objects: [[...gy(s)]] }));
    expect(gy(s)).toHaveLength(0);
    expect(lifeOf(s, 'p1')).toBe(24);
    let t = scenario([], { defs: DEFS, p1: { hand: ['Test Warden'], graveyard: ['Test Relic', 'Test Charm'] } });
    t = resolveAll(cast(t, 'Test Warden', { yes: [false] }));
    expect(gy(t)).toHaveLength(2);
    expect(lifeOf(t, 'p1')).toBe(20);
  });

  it('CR 701.59b: the optional cost is not paid when it can\'t be (the graveyard totals less than N)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Rush'], graveyard: ['Test Relic'] } });
    const h0 = handSize(s);
    s = resolveAll(cast(s, 'Test Rush', { yes: [true, true] }));
    expect(gy(s).map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Relic', 'Test Rush']);
    expect(handSize(s)).toBe(h0 - 1 + 1);
  });

  it('CR 614.15, 701.59c: "If evidence was collected, draw two cards instead"', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Rush'], graveyard: ['Test Relic', 'Test Charm'] } });
    const h0 = handSize(s);
    s = resolveAll(cast(s, 'Test Rush', { yes: [true], objects: [[...gy(s)]] }));
    expect(handSize(s)).toBe(h0 - 1 + 2);
  });

  it('Lamplight Phoenix shape: exile it and collect evidence 4, then it returns tapped; not offered when the rest of the graveyard is short', () => {
    let g = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bird'], graveyard: ['Test Relic'] } });
    const b = find(g, 'Test Bird', 'battlefield');
    g = tweak(g, (t) => { t.objects[b]!.damage = 5; }); // CR 704.5g: it dies when state-based actions are checked
    const script = { yes: [true], objects: [[find(g, 'Test Relic', 'graveyard')]] };
    g = resolveAll(drive(passBoth(g), script), script);
    const back = named(g, 'Test Bird');
    expect(back).toHaveLength(1);
    expect(g.objects[back[0]!]!.tapped).toBe(true);
    expect(named(g, 'Test Relic', 'exile')).toHaveLength(1);
    // the bird (mana value 3) is exiled first, so with only a 1 beside it evidence 4 can't be collected: the choice is not offered (CR 701.59b, 608.2d)
    let h = scenario([], { defs: DEFS, p1: { battlefield: ['Test Bird'], graveyard: ['Test Charm'] } });
    const b2 = find(h, 'Test Bird', 'battlefield');
    h = tweak(h, (t) => { t.objects[b2]!.damage = 5; });
    h = resolveAll(drive(passBoth(h), { yes: [true, true] }), { yes: [true, true] });
    expect(named(h, 'Test Bird')).toHaveLength(0);
    expect(gy(h).map((id) => h.objects[id]!.defId).sort()).toEqual(['Test Bird', 'Test Charm']);
  });

  it('CR 601.2f, 701.59c: "costs {2} less to cast if evidence was collected" (Bite Down on Crime): with one land, castable only by collecting evidence', () => {
    const poor = scenario([], { defs: DEFS, p1: { hand: ['Test Chomp'], battlefield: ['Plains'], graveyard: ['Test Charm'] } });
    expect(legalActions(poor, 'p1').some((a) => a.kind === 'cast' && a.label.includes('Test Chomp'))).toBe(false);
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Chomp'], battlefield: ['Plains'], graveyard: ['Test Relic', 'Test Relic'] } });
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.label.includes('Test Chomp'))).toBe(true);
    const h0 = handSize(s);
    s = resolveAll(cast(s, 'Test Chomp', { yes: [true], objects: [[...gy(s)]] }));
    expect(named(s, 'Test Relic', 'exile')).toHaveLength(2);
    expect(handSize(s)).toBe(h0 - 1 + 1);
  });

  it('legal actions: a spell with the optional cost is castable whatever the graveyard holds', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Rush'] } });
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.label.includes('Test Rush'))).toBe(true);
  });
});

// Review fix (E12, G10): the event role re-based by "exile it" / "destroy that creature" (CR 400.7j) still reads the object as it last existed (CR 608.2h).
const SLAGWURM = compileCard({ name: 'Engulfing Slagwurm', layout: 'normal', mana_cost: '{5}{G}{G}', type_line: 'Creature — Wurm', colors: ['G'], keywords: [], power: '7', toughness: '7',
  oracle_text: "Whenever this creature blocks or becomes blocked by a creature, destroy that creature. You gain life equal to that creature's toughness." } as OracleCard);
const SCAVENGER = card('Test Scavenger', 'Creature — Zombie', 'Whenever a creature dies, exile it. You gain life equal to its power.', '{0}', ['0', '1']);
const KEEPER = card('Test Keeper', 'Creature — Zombie', 'Whenever a creature dies, exile it. Its controller gains 3 life.', '{0}', ['0', '1']);
const LKI_DEFS = [...DEFS, SLAGWURM, SCAVENGER, KEEPER];

describe('CR 608.2h, 400.7j: an event role re-based by the effect keeps its last known information', () => {
  it('the cards are full', () => {
    for (const d of [SLAGWURM, SCAVENGER, KEEPER]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });

  it('Engulfing Slagwurm: "destroy that creature. You gain life equal to that creature\'s toughness" uses the toughness it last had (counters)', () => {
    let s = scenario([], { defs: LKI_DEFS, p1: { battlefield: ['Engulfing Slagwurm'] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 3 } }] } });
    const wurm = find(s, 'Engulfing Slagwurm', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = declareBlockers(toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[wurm]])), [[bear, wurm]]);
    s = resolveAll(drive(s));
    expect(s.objects[bear]?.zone).not.toBe('battlefield');
    expect(lifeOf(s, 'p1')).toBe(25);
  });

  it('"Whenever a creature dies, exile it. You gain life equal to its power." reads the power it died with', () => {
    let s = scenario([], { defs: LKI_DEFS, p1: { battlefield: ['Test Scavenger', { name: 'Test Bear', counters: { '+1/+1': 3 } }] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    s = tweak(s, (t) => { t.objects[bear]!.damage = 9; });
    s = resolveAll(drive(passBoth(s)));
    expect(named(s, 'Test Bear', 'exile')).toHaveLength(1);
    expect(lifeOf(s, 'p1')).toBe(25);
  });

  it('"Whenever a creature dies, exile it. Its controller gains 3 life." gives the life to its last controller, not its owner', () => {
    let s = scenario([], { defs: LKI_DEFS, p1: { battlefield: ['Test Keeper'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = tweak(s, (t) => { t.objects[bear]!.controller = 'p1'; t.objects[bear]!.damage = 9; });
    s = resolveAll(drive(passBoth(s)));
    expect(named(s, 'Test Bear', 'exile')).toHaveLength(1);
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});
