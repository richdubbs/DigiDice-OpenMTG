/**
 * FAST5 T76 (pronoun antecedents after counters, tokens and blinks): the focus rule of the anaphora pass (parser/lower/anaphora.ts#focusAt, model/focus.ts), the
 * templates of parser/templates/zz-fast5/t76.json and the renderer reading they needed, played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10). Each test checks that the effect lands on the INTENDED object (the token, the counted creature, the
 * blinked card), never on the object that merely triggered or cast the ability.
 *
 *   CR 608.2c, 111.1     "Create a token. It gains haste until end of turn. Sacrifice it at the beginning of the next end step": "it" is the token, not the source
 *   CR 608.2c, 122.1     "Put a +1/+1 counter on ~. It gains flying": the object the counters went on; "create a token. Put a counter on it": the token
 *   CR 707.9, 111.1      a token copy gains haste and is sacrificed; the original is not touched
 *   CR 608.2c            "Put a +1/+1 counter on each creature you control. Untap those creatures.": exactly the creatures that got the counters
 *   CR 400.7, 603.7      "Exile target creature you control. Return that card to the battlefield ... at the beginning of the next end step": the exiled card, a new object
 *   CR 603.12a           "When you do, put a +1/+1 counter on target creature you control. It gains trample": the reflexive trigger's own target
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the level itself is checked by the template tests). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const bf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p);
const named = (s: GameState, name: string, p?: PlayerId): ObjectId[] => bf(s, p ?? 'p1').filter((id) => s.objects[id]!.defId === name || (s.objects[id]!.kind === 'token' && getChars(s, id)!.name === name));
const tokens = (s: GameState, p: PlayerId): ObjectId[] => bf(s, p).filter((id) => s.objects[id]!.kind === 'token');
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;
const has = (s: GameState, id: ObjectId, kw: string): boolean => hasKeyword(getChars(s, id)!, kw);
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

/** The cards a choice of cards (chooseObjects) is answered with; none by default. */
let PICK: ObjectId[] = [];

/** Answer the decisions that come up: payments automatic, targets from `targets` in order, options/may from `ids`; stop at priority. */
function drive(s0: GameState, targets: TargetChoice[] = [], ids: string[] = [], yes = true): GameState {
  let s = s0;
  const t = [...targets];
  const q = [...ids];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: t.splice(0, Math.max(1, p.min)) } as DecisionAnswer);
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: q.length > 0 ? [q.shift()!] : p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: PICK } as DecisionAnswer);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes } as DecisionAnswer);
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets: TargetChoice[] = [], ids: string[] = []): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, ids);
  return s;
}
/** Cast the named card from p1's hand (targets chosen as asked) and let everything that goes on the stack resolve. */
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], ids: string[] = []): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, ids), targets, ids);
/** The beginning of the end step of this turn, with what it triggered resolved (CR 513.1, 603.7). */
const toEnd = (s: GameState): GameState => resolveAll(advanceTo(s, s.turn.number, 'end'));

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const SHOCK = card('Test Bolt', 'Instant', 'Draw a card.');
const BASE = [BEAR, SHOCK];

describe('CR 608.2c, 111.1: "Whenever you cast a noncreature spell, create a 1/1 Soldier token. It gains haste until end of turn. Sacrifice it at the beginning of the next end step."', () => {
  const RAISER = card('Test Raiser', 'Creature — Human', 'Whenever you cast a noncreature spell, create a 1/1 white Soldier creature token. It gains haste until end of turn. Sacrifice it at the beginning of the next end step.', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(RAISER)).toBe(true));
  it('the token has haste and is sacrificed at the end step; the Raiser does not gain haste and stays', () => {
    const s0 = scenario([], { defs: [RAISER, ...BASE], p1: { hand: ['Test Bolt'], battlefield: ['Test Raiser'] } });
    const raiser = find(s0, 'Test Raiser', 'battlefield', 'p1');
    const s = cast(s0, 'Test Bolt');
    const soldiers = tokens(s, 'p1');
    expect(soldiers).toHaveLength(1);
    expect(has(s, soldiers[0]!, 'haste')).toBe(true);
    expect(has(s, raiser, 'haste')).toBe(false);
    const later = toEnd(s);
    expect(tokens(later, 'p1')).toHaveLength(0);
    expect(bf(later, 'p1')).toContain(raiser);
  });
});

describe('CR 608.2c, 122.1: "Whenever you cast a noncreature spell, put a +1/+1 counter on ~. It gains flying until end of turn."', () => {
  const CAT = card('Test Cat', 'Creature — Cat', 'Whenever you cast a noncreature spell, put a +1/+1 counter on ~. It gains flying until end of turn.', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(CAT)).toBe(true));
  it('the Cat (not the spell) gets the counter and flying until end of turn', () => {
    const s0 = scenario([], { defs: [CAT, ...BASE], p1: { hand: ['Test Bolt'], battlefield: ['Test Cat'] } });
    const cat = find(s0, 'Test Cat', 'battlefield', 'p1');
    const s = cast(s0, 'Test Bolt');
    expect(counters(s, cat, '+1/+1')).toBe(1);
    expect(has(s, cat, 'flying')).toBe(true);
    expect(pt(s, cat)).toBe('2/2');
  });
});

describe('CR 608.2c, 122.1: "When ~ enters, create a 0/0 Fractal token. Put three +1/+1 counters on it."', () => {
  const EVO = card('Test Evolver', 'Creature — Human', 'When this creature enters, create a 0/0 green and blue Fractal creature token. Put three +1/+1 counters on it.', { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(EVO)).toBe(true));
  it('the token is a 3/3 and survives; the Evolver has no counters', () => {
    const s = cast(scenario([], { defs: [EVO, ...BASE], p1: { hand: ['Test Evolver'] } }), 'Test Evolver');
    const evolver = named(s, 'Test Evolver');
    expect(evolver).toHaveLength(1);
    expect(counters(s, evolver[0]!, '+1/+1')).toBe(0);
    const fractals = tokens(s, 'p1');
    expect(fractals).toHaveLength(1);
    expect(counters(s, fractals[0]!, '+1/+1')).toBe(3);
    expect(pt(s, fractals[0]!)).toBe('3/3');
  });
});

describe('CR 707.9, 608.2c: "Create a token that\'s a copy of target creature you control, except it\'s an artifact in addition to its other types. It gains haste until end of turn. Sacrifice it at the beginning of the next end step."', () => {
  const DUP = card('Test Duplication', 'Sorcery', "Create a token that's a copy of target creature you control, except it's an artifact in addition to its other types. It gains haste until end of turn. Sacrifice it at the beginning of the next end step.");
  it('is understood', () => expect(noManual(DUP)).toBe(true));
  it('the copy is an artifact with haste and is sacrificed at the end step; the original stays, with no haste and not an artifact', () => {
    const s0 = scenario([], { defs: [DUP, ...BASE], p1: { hand: ['Test Duplication'], battlefield: [{ name: 'Test Bear', since: 0 }] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Duplication', [obj(bear)]);
    const copy = tokens(s, 'p1');
    expect(copy).toHaveLength(1);
    expect(has(s, copy[0]!, 'haste')).toBe(true);
    expect(getChars(s, copy[0]!)!.types).toContain('Artifact');
    expect(has(s, bear, 'haste')).toBe(false);
    expect(getChars(s, bear)!.types).not.toContain('Artifact');
    const later = toEnd(s);
    expect(tokens(later, 'p1')).toHaveLength(0);
    expect(bf(later, 'p1')).toContain(bear);
  });
});

describe('CR 608.2c, 111.1: "Create two 1/1 Warrior tokens. They gain menace and haste until end of turn. Sacrifice them at the beginning of the next end step."', () => {
  const RAID = card('Test Raid', 'Sorcery', 'Create two 1/1 red Warrior creature tokens. They gain menace and haste until end of turn. Sacrifice them at the beginning of the next end step.');
  it('is understood', () => expect(noManual(RAID)).toBe(true));
  it('both tokens (and only they) gain menace and haste; both are sacrificed at the end step', () => {
    const s0 = scenario([], { defs: [RAID, ...BASE], p1: { hand: ['Test Raid'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Raid');
    const warriors = tokens(s, 'p1');
    expect(warriors).toHaveLength(2);
    for (const w of warriors) expect(has(s, w, 'menace') && has(s, w, 'haste')).toBe(true);
    expect(has(s, bear, 'menace')).toBe(false);
    const later = toEnd(s);
    expect(tokens(later, 'p1')).toHaveLength(0);
    expect(bf(later, 'p1')).toContain(bear);
  });
});

describe('CR 608.2c, 122.1: "Put a +1/+1 counter on each creature you control. Untap those creatures."', () => {
  const RALLY = card('Test Rally', 'Sorcery', 'Put a +1/+1 counter on each creature you control. Untap those creatures.');
  it('is understood', () => expect(noManual(RALLY)).toBe(true));
  it('your creatures get the counter and untap; the opponent\'s tapped creature is untouched', () => {
    const s0 = scenario([], { defs: [RALLY, ...BASE], p1: { hand: ['Test Rally'], battlefield: [{ name: 'Test Bear', tapped: true }, { name: 'Test Bear', tapped: true }] }, p2: { battlefield: [{ name: 'Test Bear', tapped: true }] } });
    const s = cast(s0, 'Test Rally');
    const mine = bf(s, 'p1');
    expect(mine).toHaveLength(2);
    for (const id of mine) {
      expect(counters(s, id, '+1/+1')).toBe(1);
      expect(s.objects[id]!.tapped).toBe(false);
    }
    const theirs = bf(s, 'p2')[0]!;
    expect(counters(s, theirs, '+1/+1')).toBe(0);
    expect(s.objects[theirs]!.tapped).toBe(true);
  });
});

describe('CR 608.2c, 611.2: "Creatures you control get +2/+0 until end of turn. Untap them."', () => {
  const ROAR = card('Test Roar', 'Sorcery', 'Creatures you control get +2/+0 until end of turn. Untap them.');
  it('is understood', () => expect(noManual(ROAR)).toBe(true));
  it('your creatures are pumped and untapped; the opponent\'s tapped creature is neither', () => {
    const s0 = scenario([], { defs: [ROAR, ...BASE], p1: { hand: ['Test Roar'], battlefield: [{ name: 'Test Bear', tapped: true }] }, p2: { battlefield: [{ name: 'Test Bear', tapped: true }] } });
    const s = cast(s0, 'Test Roar');
    const mine = bf(s, 'p1')[0]!;
    expect(pt(s, mine)).toBe('4/2');
    expect(s.objects[mine]!.tapped).toBe(false);
    const theirs = bf(s, 'p2')[0]!;
    expect(pt(s, theirs)).toBe('2/2');
    expect(s.objects[theirs]!.tapped).toBe(true);
  });
});

describe('CR 400.7, 603.7, 608.2c: "Whenever you cast a noncreature spell, exile target creature you control. Return that card to the battlefield under its owner\'s control at the beginning of the next end step."', () => {
  const BLINKER = card('Test Blinker', 'Creature — Wizard', "Whenever you cast a noncreature spell, exile target creature you control. Return that card to the battlefield under its owner's control at the beginning of the next end step.", { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(BLINKER)).toBe(true));
  it('the targeted Bear (not the cast spell) is exiled, and returns at the beginning of the next end step', () => {
    const s0 = scenario([], { defs: [BLINKER, ...BASE], p1: { hand: ['Test Bolt'], battlefield: ['Test Blinker', 'Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Bolt', [obj(bear)]);
    expect(named(s, 'Test Bear')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'exile')).toHaveLength(1);
    const later = toEnd(s);
    expect(named(later, 'Test Bear')).toHaveLength(1);
    expect(findAll(later, 'Test Bear', 'exile')).toHaveLength(0);
  });
});

describe('CR 608.2c, 400.7: "exile another target nonland permanent. If you controlled it, return it to the battlefield tapped. Otherwise, its controller creates a 2/2 Detective token."', () => {
  const GATE = card('Test Gate', 'Creature — Cleric', 'When this creature enters, exile another target nonland permanent. If you controlled it, return it to the battlefield tapped. Otherwise, its controller creates a 2/2 white and blue Detective creature token.', { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(GATE)).toBe(true));
  it('your own Bear comes back tapped (a new object); the Gate stays', () => {
    const s0 = scenario([], { defs: [GATE, ...BASE], p1: { hand: ['Test Gate'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Gate', [obj(bear)]);
    const bears = named(s, 'Test Bear');
    expect(bears).toHaveLength(1);
    expect(s.objects[bears[0]!]!.tapped).toBe(true);
    expect(named(s, 'Test Gate')).toHaveLength(1);
    expect(tokens(s, 'p1')).toHaveLength(0);
  });
  it('the opponent\'s Bear stays exiled and its controller (the opponent) creates the Detective', () => {
    const s0 = scenario([], { defs: [GATE, ...BASE], p1: { hand: ['Test Gate'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Gate', [obj(bear)]);
    expect(named(s, 'Test Bear', 'p2')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'exile')).toHaveLength(1);
    expect(tokens(s, 'p2')).toHaveLength(1);
    expect(tokens(s, 'p1')).toHaveLength(0);
    expect(pt(s, tokens(s, 'p2')[0]!)).toBe('2/2');
  });
});

describe('CR 608.2c, 122.1: "When this Aura enters, tap enchanted creature. Put three stun counters on it."', () => {
  const FREEZE = card('Test Freeze', 'Enchantment — Aura', 'Enchant creature\nWhen this Aura enters, tap enchanted creature. Put three stun counters on it.');
  it('is understood', () => expect(noManual(FREEZE)).toBe(true));
  it('the enchanted creature (not the Aura) gets the counters and is tapped', () => {
    const s0 = scenario([], { defs: [FREEZE, ...BASE], p1: { hand: ['Test Freeze'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Freeze', [obj(bear)]);
    expect(counters(s, bear, 'stun')).toBe(3);
    expect(s.objects[bear]!.tapped).toBe(true);
    const aura = find(s, 'Test Freeze', 'battlefield', 'p1');
    expect(counters(s, aura, 'stun')).toBe(0);
  });
});

describe('CR 603.12a, 608.2c: "When you do, put a +1/+1 counter on target creature you control. It gains trample until end of turn."', () => {
  const TUTOR = card('Test Tutor', 'Creature — Human', 'Whenever you cast a noncreature spell, you may discard a card. When you do, put a +1/+1 counter on target creature you control. It gains trample until end of turn.', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(TUTOR)).toBe(true));
  it('the reflexive trigger\'s target gets the counter and trample; the Tutor does not', () => {
    const s0 = scenario([], { defs: [TUTOR, ...BASE], p1: { hand: ['Test Bolt', 'Test Bear'], battlefield: ['Test Tutor', 'Test Bear'] } });
    const tutor = find(s0, 'Test Tutor', 'battlefield', 'p1');
    const bear = findAll(s0, 'Test Bear', 'battlefield', 'p1')[0]!;
    const s = cast(s0, 'Test Bolt', [obj(bear)]);
    expect(counters(s, bear, '+1/+1')).toBe(1);
    expect(has(s, bear, 'trample')).toBe(true);
    expect(counters(s, tutor, '+1/+1')).toBe(0);
    expect(has(s, tutor, 'trample')).toBe(false);
  });
});

describe('CR 608.2c, 400.7: "If you control a Bear, exile the top card of your library. You may play it until the end of your next turn."', () => {
  const PEEK = card('Test Peek', 'Instant', 'If you control a Bear, exile the top card of your library. You may play it until the end of your next turn.');
  it('is understood', () => expect(noManual(PEEK)).toBe(true));
  it('the exiled top card (a land) can be played from exile; with no Bear nothing is exiled', () => {
    const s0 = scenario(['Forest'], { defs: [PEEK, ...BASE], p1: { hand: ['Test Peek'], battlefield: ['Test Bear'], library: ['Forest'] } });
    const s = cast(s0, 'Test Peek');
    const exiled = findAll(s, 'Forest', 'exile');
    expect(exiled).toHaveLength(1);
    expect(legal(s, 'p1').some((a) => a.kind === 'playLand' && JSON.stringify(a).includes(exiled[0]!))).toBe(true);
    const none = cast(scenario(['Forest'], { defs: [PEEK, ...BASE], p1: { hand: ['Test Peek'], library: ['Forest'] } }), 'Test Peek');
    expect(findAll(none, 'Forest', 'exile')).toHaveLength(0);
  });
});

describe('CR 611.2a, 613.1f: "Create a 1/1 Soldier token. It gains flying." (no duration: it lasts)', () => {
  const FLOCK = card('Test Flock', 'Sorcery', 'Create a 1/1 white Soldier creature token. It gains flying.');
  const PUSH = card('Test Push', 'Sorcery', 'Put a +1/+1 counter on target creature you control. That creature gains trample and haste.');
  it('is understood', () => {
    expect(noManual(FLOCK)).toBe(true);
    expect(noManual(PUSH)).toBe(true);
  });
  it('the token has flying now and still has it on the next turn', () => {
    const s = cast(scenario([], { defs: [FLOCK, ...BASE], p1: { hand: ['Test Flock'], battlefield: ['Test Bear'] } }), 'Test Flock');
    const [soldier] = tokens(s, 'p1');
    expect(has(s, soldier!, 'flying')).toBe(true);
    expect(has(s, bf(s, 'p1').find((id) => id !== soldier)!, 'flying')).toBe(false);
    const later = advanceTo(s, s.turn.number + 2, 'upkeep');
    expect(has(later, soldier!, 'flying')).toBe(true);
  });
  it('"That creature gains trample and haste" lands on the creature that got the counter', () => {
    const s0 = scenario([], { defs: [PUSH, ...BASE], p1: { hand: ['Test Push'], battlefield: ['Test Bear', 'Test Bear'] } });
    const [a, b] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    const s = cast(s0, 'Test Push', [obj(a!)]);
    expect(counters(s, a!, '+1/+1')).toBe(1);
    expect(has(s, a!, 'trample') && has(s, a!, 'haste')).toBe(true);
    expect(has(s, b!, 'trample') || has(s, b!, 'haste')).toBe(false);
  });
});

describe('CR 702.15a, 611.2a: "Whenever you cast an instant or sorcery spell, that spell gains lifelink."', () => {
  const JUDGE = card('Test Judge', 'Creature — Human', 'Whenever you cast an instant or sorcery spell, that spell gains lifelink.', { pt: ['1', '1'] });
  const STRIKE = card('Test Strike', 'Instant', '~ deals 2 damage to target creature.');
  it('is understood', () => expect(noManual(JUDGE)).toBe(true));
  it('the cast spell (not the Judge) has lifelink: its damage gains its controller 2 life', () => {
    const s0 = scenario([], { defs: [JUDGE, STRIKE, BEAR], p1: { hand: ['Test Strike'], battlefield: ['Test Judge'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = cast(s0, 'Test Strike', [obj(bear)]);
    expect(bf(s, 'p2')).not.toContain(bear); // 2 damage kills the 2/2
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
  });
});

describe('CR 608.2c, 400.7j, 603.7c: "{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step."', () => {
  const SNEAK = card('Test Sneak', 'Enchantment', '{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step.');
  it('is understood', () => expect(noManual(SNEAK)).toBe(true));
  const activate = (s0: GameState, pick: ObjectId[]): GameState => {
    PICK = pick;
    let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Sneak', 'battlefield', 'p1'), ability: 'p:0:0' });
    for (let guard = 0; guard < 20 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    return resolveAll(s);
  };
  it('the creature put onto the battlefield has haste (the enchantment does not) and is sacrificed at the beginning of the next end step', () => {
    const s0 = scenario(['Mountain'], { defs: [SNEAK, ...BASE], p1: { hand: ['Test Bear'], battlefield: ['Test Sneak', 'Mountain'] } });
    const s = activate(s0, [find(s0, 'Test Bear', 'hand', 'p1')]);
    const [bear] = named(s, 'Test Bear');
    expect(bear).toBeDefined();
    expect(has(s, bear!, 'haste')).toBe(true);
    expect(has(s, find(s, 'Test Sneak', 'battlefield', 'p1'), 'haste')).toBe(false);
    const later = toEnd(s);
    expect(named(later, 'Test Bear')).toHaveLength(0);
    expect(findAll(later, 'Test Bear', 'graveyard')).toHaveLength(1);
    expect(find(later, 'Test Sneak', 'battlefield', 'p1')).toBeDefined();
  });
  it('choosing no card does nothing (nothing is hasty, nothing is sacrificed at the end step)', () => {
    const s0 = scenario(['Mountain'], { defs: [SNEAK, ...BASE], p1: { hand: ['Test Bear'], battlefield: ['Test Sneak', 'Mountain', 'Test Bear'] } });
    const onField = findAll(s0, 'Test Bear', 'battlefield', 'p1')[0]!;
    const s = activate(s0, []);
    expect(has(s, onField, 'haste')).toBe(false);
    const later = toEnd(s);
    expect(named(later, 'Test Bear')).toHaveLength(1);
    expect(findAll(later, 'Test Bear', 'hand')).toHaveLength(1);
  });
});

describe('CR 701.63a, 608.2c: "it endures X, where X is the number of counters on this creature" / "Whenever ~ enters or attacks, it endures 2."', () => {
  const WARDEN = card('Test Warden', 'Creature — Hydra', 'Whenever another nontoken creature you control enters, it endures X, where X is the number of counters on this creature.', { pt: ['2', '2'] });
  const VANGUARD = card('Test Vanguard', 'Creature — Soldier', 'Whenever this creature enters or attacks, it endures 2.', { pt: ['3', '2'] });
  it('is understood', () => {
    expect(noManual(WARDEN)).toBe(true);
    expect(noManual(VANGUARD)).toBe(true);
  });
  it('the entering Bear (not the Warden) endures X: it gets X +1/+1 counters, X being the Warden\'s counters', () => {
    const s0 = scenario([], { defs: [WARDEN, ...BASE], p1: { hand: ['Test Bear'], battlefield: [{ name: 'Test Warden', counters: { '+1/+1': 3 } }] } });
    const warden = find(s0, 'Test Warden', 'battlefield', 'p1');
    const s = cast(s0, 'Test Bear');
    const [bear] = named(s, 'Test Bear');
    expect(bear).toBeDefined();
    expect(counters(s, bear!, '+1/+1')).toBe(3);
    expect(counters(s, warden, '+1/+1')).toBe(3);
    expect(tokens(s, 'p1')).toHaveLength(0);
  });
  it('the Vanguard endures itself when it enters: 2 +1/+1 counters on it (the first choice)', () => {
    const s = cast(scenario([], { defs: [VANGUARD, ...BASE], p1: { hand: ['Test Vanguard'] } }), 'Test Vanguard');
    const [v] = named(s, 'Test Vanguard');
    expect(v).toBeDefined();
    expect(counters(s, v!, '+1/+1')).toBe(2);
    expect(tokens(s, 'p1')).toHaveLength(0);
  });
});
