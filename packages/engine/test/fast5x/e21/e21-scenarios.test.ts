/**
 * FAST5X E21: counters II, played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 122.5    "put its counters on <object>": every counter of every kind is moved (all or nothing per kind)
 *   CR 122.8    a triggered ability that looks back at an object that left the battlefield puts the same number of each kind of counter it had
 *   CR 603.10a  leaves-the-battlefield triggers look back: "if it had counters on it", "with one or more counters on it dies"
 *   CR 603.4    the intervening "if" is checked as it triggers and again as it resolves, both on the last known information of the object that left
 *   CR 608.2h   last known information includes the counters on the object
 *   CR 122.6    "whenever you put ... counters": the controller of the resolving spell or ability, the player paying a cost, the controller of a permanent
 *               entering with counters (CR 122.6a)
 *   CR 603.2    "the third plan counter is put on ~": the event that makes the number reach N; "while ~ has a -1/-1 counter on it" is judged with the event
 *   CR 603.2h   "This ability triggers only once each turn"; "Do this only once each turn" counts the action when it is taken
 *   CR 603.8    "When there are four or more page counters on ~": a state trigger
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, passBoth, scenario } from '../../m3/scenario';
import { lifeOf, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string], loyalty?: string): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(loyalty ? { loyalty } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][]; options?: string[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])], options: [...(script.options ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers' && s.pending.kind !== 'declareBlockers'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: q.options.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
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
function activate(s: GameState, id: ObjectId, script?: Script, player = 'p1', index = 0): GameState {
  const la = legal(s, player, 'activate').filter((a) => a.object === id && !a.isMana)[index];
  if (!la) throw new Error('no activated ability');
  return drive(act(s, la.action), script);
}
const counters = (s: GameState, id: ObjectId): Record<string, number> => ({ ...s.objects[id]!.counters });
const handSize = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const triggered = (s: GameState, name: string): number => s.log.filter((l) => l.text.startsWith(`${name} triggers`)).length;
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{0}', ['3', '3']);
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const GROW = card('Test Grow', 'Instant', 'Put a +1/+1 counter on target creature.');
const GROW2 = card('Test Grow Twice', 'Instant', 'Put two +1/+1 counters on target creature.');
const SHRINK = card('Test Shrink', 'Instant', 'Put a -1/-1 counter on target creature.');
const BOUNCE = card('Test Bounce', 'Instant', "Return target creature to its owner's hand.");

const CHANNELER = card('Test Channeler', 'Creature — Bat', 'When this creature dies, put its counters on target creature you control.', '{0}', ['1', '1']);
const SCOLD = card('Test Scold', 'Creature — Human', 'When this creature dies, if it had counters on it, put those counters on up to one target creature.', '{0}', ['1', '1']);
const WASP = card('Test Wasp', 'Creature — Insect', 'Whenever another creature you control dies, if it had counters on it, put its counters on this creature.', '{0}', ['1', '1']);
const AUGMENTER = card('Test Augmenter', 'Creature — Human', "When this creature dies, if it had one or more counters on it, create a 0/0 green Ooze creature token, then put Test Augmenter's counters on that token.", '{0}', ['1', '1']);
const WRETCH = card('Test Wretch', 'Creature — Goblin', 'When this creature dies, if it had a -1/-1 counter on it, you gain 3 life.', '{0}', ['3', '3']);
const SLASHER = card('Test Slasher', 'Creature — Zombie', 'When this creature dies, if it had no counters on it, you gain 2 life.', '{0}', ['2', '2']);
const TALENT = card('Test Talent', 'Enchantment', 'Whenever a creature you control leaves the battlefield, if it had a counter on it, you gain 2 life.');
const URCHIN = card('Test Urchin', 'Creature — Ouphe', 'Whenever a creature you control with one or more counters on it dies, draw a card.', '{0}', ['1', '1']);
const HEARTLESS = card('Test Heartless', 'Instant', 'Destroy target creature with no counters on it.');
const REEJ = card('Test Reej', 'Creature — Merfolk', 'This creature enters with three -1/-1 counters on it.\nWhenever this creature becomes tapped while it has a -1/-1 counter on it, remove a -1/-1 counter from it.\n{0}: Tap this creature.', '{0}', ['4', '4']);
const DOUN = card('Test Doun', 'Creature — Kithkin', 'This creature enters with two -1/-1 counters on it.\nWhenever another creature you control enters while this creature has a -1/-1 counter on it, remove a -1/-1 counter from this creature.', '{0}', ['3', '3']);
const PANTRY = card('Test Pantry', 'Enchantment', 'Whenever you put one or more +1/+1 counters on a creature you control, put a supply counter on this enchantment.');
const TERRA = card('Test Terra', 'Enchantment', 'Whenever you put one or more +1/+1 counters on a creature you control, you may draw that many cards. Do this only once each turn.');
const MIKEY = card('Test Mikey', 'Creature — Turtle', 'Whenever you put a counter on a creature you control, draw a card. This ability triggers only once each turn.', '{0}', ['2', '2']);
const TETHER = card('Test Tether', 'Creature — Elf', 'Whenever you put one or more loyalty counters on a planeswalker, you gain 1 life.', '{0}', ['1', '1']);
const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '+1: You gain 2 life.', '{0}', undefined, '3');
const PLAN = card('Test Plan', 'Enchantment — Plan', '{0}: Put a plan counter on this enchantment.\n{0}: Put two plan counters on this enchantment.\nWhen the third plan counter is put on this enchantment, draw two cards.');
const TOME = card('Test Tome', 'Artifact', '{0}: Put a page counter on this artifact.\nWhen there are four or more page counters on this artifact, exile it. If you do, you gain 4 life.');
const DEFS = [BEAR, OGRE, KILL, GROW, GROW2, SHRINK, BOUNCE, CHANNELER, SCOLD, WASP, AUGMENTER, WRETCH, SLASHER, TALENT, URCHIN, HEARTLESS, REEJ, DOUN, PANTRY, TERRA, MIKEY, TETHER, WALKER, PLAN, TOME];

describe('the synthetic cards are automated (FAST5X E21)', () => {
  it('every card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 122.5, 122.8: "put its counters on" another object', () => {
  it('CR 122.8, 603.10a: a creature that died puts the same number of each kind of counter it had on the target (Essence Channeler)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kill'], battlefield: [{ name: 'Test Channeler', counters: { '+1/+1': 2, flying: 1 } }, 'Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield');
    const ch = find(s, 'Test Channeler', 'battlefield');
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(ch)], [obj(ogre)]] }), { targets: [[obj(ogre)]] });
    expect(counters(s, ogre)).toEqual({ '+1/+1': 2, flying: 1 });
  });

  it('CR 122.8: nothing is put when it had no counters; a target that left gets nothing (CR 608.2b)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kill'], battlefield: ['Test Channeler', 'Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield');
    const ch = find(s, 'Test Channeler', 'battlefield');
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(ch)]] }), { targets: [[obj(ogre)]] });
    expect(counters(s, ogre)).toEqual({});
  });

  it('CR 603.4, 608.2h: "if it had counters on it, put those counters on up to one target creature" (Scolding Administrator)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kill'], battlefield: [{ name: 'Test Scold', counters: { '+1/+1': 3 } }] }, p2: { battlefield: ['Test Bear'] } });
    const scold = find(s, 'Test Scold', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(scold)]] }), { targets: [[obj(bear)]] });
    expect(counters(s, bear)).toEqual({ '+1/+1': 3 });
  });

  it('CR 603.4: with no counters it does not trigger at all', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kill'], battlefield: ['Test Scold'] } });
    const scold = find(s, 'Test Scold', 'battlefield');
    s = cast(s, 'Test Kill', { targets: [[obj(scold)]] });
    s = drive(passBoth(s));
    expect(s.zones.stack.length).toBe(0);
    expect(s.pendingTriggers.length).toBe(0);
  });

  it('CR 122.8, 603.10a: "whenever another creature you control dies, if it had counters on it, put its counters on ~" (Buzzard-Wasp Colony)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kill'], battlefield: ['Test Wasp', { name: 'Test Ogre', counters: { '+1/+1': 1, '-1/-1': 0, stun: 2 } }] } });
    const wasp = find(s, 'Test Wasp', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(ogre)]] }));
    expect(counters(s, wasp)).toEqual({ '+1/+1': 1, stun: 2 });
  });

  it('CR 122.8: "create a 0/0 token, then put ~\'s counters on that token": the token survives with them (Ambitious Augmenter)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kill'], battlefield: [{ name: 'Test Augmenter', counters: { '+1/+1': 2 } }] } });
    const aug = find(s, 'Test Augmenter', 'battlefield');
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(aug)]] }));
    const tokens = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(1);
    expect(counters(s, tokens[0]!)).toEqual({ '+1/+1': 2 });
  });

  it('CR 603.4: the Augmenter with no counters creates no token', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kill'], battlefield: ['Test Augmenter'] } });
    const aug = find(s, 'Test Augmenter', 'battlefield');
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(aug)]] }));
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token')).toBe(false);
  });
});

describe('CR 603.4, 603.10a: intervening "if" on the counters a creature had', () => {
  it('"if it had a -1/-1 counter on it": true with one, false without (Retched Wretch)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kill', 'Test Shrink'], battlefield: ['Test Wretch'] } });
    const w = find(s, 'Test Wretch', 'battlefield');
    s = resolveAll(cast(s, 'Test Shrink', { targets: [[obj(w)]] }));
    const life = lifeOf(s, 'p1');
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(w)]] }));
    expect(lifeOf(s, 'p1')).toBe(life + 3);
    let t = scenario([], { defs: DEFS, p1: { hand: ['Test Kill'], battlefield: ['Test Wretch'] } });
    const w2 = find(t, 'Test Wretch', 'battlefield');
    const l2 = lifeOf(t, 'p1');
    t = resolveAll(cast(t, 'Test Kill', { targets: [[obj(w2)]] }));
    expect(lifeOf(t, 'p1')).toBe(l2);
  });

  it('"if it had no counters on it" (Unstoppable Slasher)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kill'], battlefield: ['Test Slasher'] } });
    const sl = find(s, 'Test Slasher', 'battlefield');
    const life = lifeOf(s, 'p1');
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(sl)]] }));
    expect(lifeOf(s, 'p1')).toBe(life + 2);
    let t = scenario([], { defs: DEFS, p1: { hand: ['Test Kill'], battlefield: [{ name: 'Test Slasher', counters: { '+1/+1': 1 } }] } });
    const sl2 = find(t, 'Test Slasher', 'battlefield');
    const l2 = lifeOf(t, 'p1');
    t = resolveAll(cast(t, 'Test Kill', { targets: [[obj(sl2)]] }));
    expect(lifeOf(t, 'p1')).toBe(l2);
  });

  it('"whenever a creature you control leaves the battlefield, if it had a counter on it" (Leader\'s Talent): bounce with a counter', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Bounce', 'Test Kill'], battlefield: ['Test Talent', { name: 'Test Bear', counters: { '+1/+1': 1 } }, 'Test Ogre'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    const life = lifeOf(s, 'p1');
    s = resolveAll(cast(s, 'Test Bounce', { targets: [[obj(bear)]] }));
    expect(lifeOf(s, 'p1')).toBe(life + 2);
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(ogre)]] }));
    expect(lifeOf(s, 'p1')).toBe(life + 2);
  });

  it('CR 603.10a: "whenever a creature you control with one or more counters on it dies" (Shadow Urchin)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Kill', 'Test Kill'], battlefield: ['Test Urchin', { name: 'Test Bear', counters: { '-1/-1': 1 } }, 'Test Ogre'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    const h0 = handSize(s);
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(ogre)]] }));
    expect(handSize(s)).toBe(h0 - 1);
    s = resolveAll(cast(s, 'Test Kill', { targets: [[obj(bear)]] }));
    expect(handSize(s)).toBe(h0 - 2 + 1);
  });

  it('CR 122.1: "destroy target creature with no counters on it" can target only a creature without counters (Heartless Act)', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Heartless'] }, p2: { battlefield: [{ name: 'Test Bear', counters: { stun: 1 } }, 'Test Ogre'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    const ogre = find(s, 'Test Ogre', 'battlefield');
    const t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Heartless', 'hand') });
    const p = t.pending;
    expect(p?.kind).toBe('chooseTargets');
    const cands = p?.kind === 'chooseTargets' ? JSON.stringify(p) : '';
    expect(cands.includes(ogre)).toBe(true);
    expect(cands.includes(`"${bear}"`)).toBe(false);
    const done = resolveAll(drive(t, { targets: [[obj(ogre)]] }));
    expect(done.zones.battlefield.includes(ogre)).toBe(false);
  });
});

describe('CR 603.2: trigger events with a condition on the counters of ~', () => {
  it('"whenever ~ becomes tapped while it has a -1/-1 counter on it, remove a -1/-1 counter from it" (Encumbered Reejerey)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Reej', counters: { '-1/-1': 1 } }] } });
    const r = find(s, 'Test Reej', 'battlefield');
    s = resolveAll(activate(s, r));
    expect(counters(s, r)).toEqual({});
    s = tweak(s, (t) => { t.objects[r]!.tapped = false; });
    s = resolveAll(activate(s, r));
    expect(s.zones.stack.length).toBe(0);
    expect(counters(s, r)).toEqual({});
  });

  it('"whenever another creature you control enters while ~ has a -1/-1 counter on it" (Reluctant Dounguard)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Bear', 'Test Ogre', 'Test Doun'], battlefield: [{ name: 'Test Doun', counters: { '-1/-1': 1 } }] } });
    const d = find(s, 'Test Doun', 'battlefield');
    s = resolveAll(cast(s, 'Test Bear'));
    expect(counters(s, d)).toEqual({});
    s = resolveAll(cast(s, 'Test Ogre'));
    expect(counters(s, d)).toEqual({});
    expect(s.zones.battlefield.includes(d)).toBe(true);
  });
});

describe('CR 122.6: "whenever you put ... counters on ..."', () => {
  it('your spell putting +1/+1 counters on your creature triggers it; an opponent\'s spell does not (Stocking the Pantry)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Grow'], battlefield: ['Test Pantry', 'Test Bear'] }, p2: { hand: ['Test Grow'] } });
    const pantry = find(s, 'Test Pantry', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    s = resolveAll(cast(s, 'Test Grow', { targets: [[obj(bear)]] }));
    expect(counters(s, pantry)).toEqual({ supply: 1 });
    s = act(s, { type: 'pass', player: 'p1' }); // Bob gets priority (CR 117.3d)
    s = resolveAll(cast(s, 'Test Grow', { targets: [[obj(bear)]] }, 'p2'));
    expect(counters(s, bear)).toEqual({ '+1/+1': 2 });
    expect(counters(s, pantry)).toEqual({ supply: 1 });
  });

  it('CR 122.6a: a creature you control entering with +1/+1 counters: you put them', () => {
    const PUPPY = card('Test Pup', 'Creature — Dog', 'This creature enters with two +1/+1 counters on it.', '{0}', ['0', '0']);
    let s = scenario([], { defs: [...DEFS, PUPPY], p1: { hand: ['Test Pup'], battlefield: ['Test Pantry'] } });
    const pantry = find(s, 'Test Pantry', 'battlefield');
    s = resolveAll(cast(s, 'Test Pup'));
    expect(counters(s, pantry)).toEqual({ supply: 1 });
  });

  it('CR 603.2h: "you may draw that many cards. Do this only once each turn": declining keeps it available; taking it ends it for the turn (Terrasymbiosis)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Grow', 'Test Grow Twice', 'Test Grow'], battlefield: ['Test Terra', 'Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield');
    let h = handSize(s);
    s = resolveAll(cast(s, 'Test Grow', { targets: [[obj(bear)]] }), { yes: [false] });
    expect(handSize(s)).toBe(h - 1); // declined
    expect(triggered(s, 'Test Terra')).toBe(1);
    h = handSize(s);
    s = resolveAll(cast(s, 'Test Grow Twice', { targets: [[obj(bear)]] }), { yes: [true] });
    expect(handSize(s)).toBe(h - 1 + 2); // "that many": two counters, two cards
    h = handSize(s);
    s = resolveAll(cast(s, 'Test Grow', { targets: [[obj(bear)]] }), { yes: [true] });
    expect(handSize(s)).toBe(h - 1); // already done this turn: it does not trigger
    expect(triggered(s, 'Test Terra')).toBe(2);
  });

  it('CR 603.2h: "This ability triggers only once each turn" (Mikey & Leo)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Grow', 'Test Shrink'], battlefield: ['Test Mikey', 'Test Ogre'] } });
    const ogre = find(s, 'Test Ogre', 'battlefield');
    const h = handSize(s);
    s = resolveAll(cast(s, 'Test Shrink', { targets: [[obj(ogre)]] }));
    expect(handSize(s)).toBe(h - 1 + 1);
    s = resolveAll(cast(s, 'Test Grow', { targets: [[obj(ogre)]] }));
    expect(handSize(s)).toBe(h - 2 + 1);
  });

  it('CR 606.4, 122.6: activating a +1 loyalty ability puts loyalty counters: you put them (Inspired Tethermage)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tether', { name: 'Test Walker', counters: { loyalty: 3 } }] } });
    const walker = find(s, 'Test Walker', 'battlefield');
    const life = lifeOf(s, 'p1');
    s = resolveAll(activate(s, walker));
    expect(counters(s, walker)).toEqual({ loyalty: 4 });
    expect(lifeOf(s, 'p1')).toBe(life + 2 + 1);
  });
});

describe('CR 122.1, 603.2: "When the third plan counter is put on ~"', () => {
  it('triggers when the count reaches three, one at a time or two at once, and not again after', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Plan'] } });
    const plan = find(s, 'Test Plan', 'battlefield');
    const h = handSize(s);
    s = resolveAll(activate(s, plan, undefined, 'p1', 0));
    s = resolveAll(activate(s, plan, undefined, 'p1', 0));
    expect(handSize(s)).toBe(h);
    s = resolveAll(activate(s, plan, undefined, 'p1', 0));
    expect(handSize(s)).toBe(h + 2);
    s = resolveAll(activate(s, plan, undefined, 'p1', 0));
    expect(handSize(s)).toBe(h + 2);
    let t = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Plan', counters: { plan: 2 } }] } });
    const plan2 = find(t, 'Test Plan', 'battlefield');
    t = resolveAll(activate(t, plan2, undefined, 'p1', 1)); // 2 -> 4: the third counter is among them
    expect(handSize(t)).toBe(h + 2);
  });
});

describe('CR 603.8: "When there are four or more page counters on ~" (Mazemind Tome)', () => {
  it('a state trigger: exiles it and gains 4 life once the fourth counter is there', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Tome', counters: { page: 2 } }] } });
    const tome = find(s, 'Test Tome', 'battlefield');
    const life = lifeOf(s, 'p1');
    s = resolveAll(activate(s, tome));
    expect(lifeOf(s, 'p1')).toBe(life);
    s = resolveAll(activate(s, tome));
    expect(s.zones.battlefield.includes(tome)).toBe(false);
    expect(lifeOf(s, 'p1')).toBe(life + 4);
    expect(named(s, 'Test Tome')).toEqual([]);
  });
});
