/**
 * FAST5 T45 (copy spells and abilities): the templates of parser/templates/zz-fast5/t45.json (and the engine support they needed) played through the engine
 * with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10). Each describe is named after the rule it checks.
 *
 *   CR 603.7b, 707.10      "When you next cast an instant or sorcery spell this turn, copy that spell." (a delayed trigger that waits for ONE spell, this turn only)
 *   CR 707.10, 603.7       "Copy the next spell you cast this turn when you cast it."
 *   CR 707.10, 113.3b-c    "Copy target activated or triggered ability you control [from an artifact source]."
 *   CR 115.9a, 115.9c      "... that targets only a single creature you control", "... with a single target"
 *   CR 702.40a             "copy it for each other instant and sorcery spell you've cast before it this turn"
 *   CR 601.2a              "Whenever you cast a spell from anywhere other than your hand, ..."
 *   CR 508.1, 603.2        "Whenever you cast a spell while ~ is attacking, copy that spell."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, castAuto, find, findAll, life, pass, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces[0]!.abilities.filter((a) => a.kind === 'manual').map((a) => a.text);

const DOUBLER = card('Test Doubler', 'Instant', 'When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.', { colors: ['U'] });
const SMALL_DOUBLER = card('Test Small Doubler', 'Instant', 'When you next cast an instant or sorcery spell with mana value 1 or less this turn, copy that spell.', { colors: ['U'] });
const TRIPLER = card('Test Tripler', 'Instant', 'When you next cast an instant or sorcery spell this turn, copy it twice. You may choose new targets for the copies.', { colors: ['U'] });
const ANY_DOUBLER = card('Test Any Doubler', 'Instant', 'Copy the next spell you cast this turn when you cast it. You may choose new targets for the copy.', { colors: ['U'] });
const GAIN = card('Test Gain', 'Instant', 'You gain 2 life.', { colors: ['W'] });
const GAIN_COSTLY = card('Test Costly Gain', 'Sorcery', 'You gain 5 life.', { cost: '{2}', colors: ['W'] });
const PUMP = card('Test Pump', 'Instant', 'Target creature gets +1/+1 until end of turn.', { colors: ['G'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { cost: '{0}', colors: ['G'], pt: ['2', '2'] });
const COPIER = card('Test Copier', 'Artifact', '{T}: Copy target activated or triggered ability you control. You may choose new targets for the copy.', { colors: [] });
const ART_COPIER = card('Test Artifact Copier', 'Artifact', '{T}: Copy target activated or triggered ability you control from an artifact source. You may choose new targets for the copy.', { colors: [] });
const LIFEGEM = card('Test Lifegem', 'Artifact', '{T}: You gain 1 life.', { colors: [] });
const LIFEBIRD = card('Test Lifebird', 'Creature — Bird', '{T}: You gain 3 life.', { colors: ['W'], pt: ['1', '1'] });
const XCOPIER = card('Test X Copier', 'Artifact', '{X}, {T}: Copy target activated or triggered ability you control X times. You may choose new targets for the copies.', { colors: [] });
const MIRROR = card('Test Mirror', 'Enchantment', 'Whenever you cast an instant or sorcery spell that targets only a single creature you control, copy that spell. You may choose new targets for the copy.', { colors: ['U'] });
const SINGLE = card('Test Single', 'Enchantment', 'Whenever you cast an instant or sorcery spell with a single target, copy it.', { colors: ['U'] });
const STORM_ENGINE = card('Test Storm Engine', 'Enchantment', "Whenever you cast an instant or sorcery spell, copy it for each other instant and sorcery spell you've cast before it this turn. You may choose new targets for the copies.", { colors: ['U'] });
const OTHER_HAND = card('Test Elsewhere', 'Enchantment', 'Whenever you cast a spell from anywhere other than your hand, you may copy it.', { colors: ['U'] });
const FLASHBACK_GAIN = card('Test Flashback Gain', 'Instant', 'You gain 4 life.\nFlashback {0}', { colors: ['W'] });
const ATTACKER = card('Test Raider', 'Creature — Human', 'Whenever you cast a spell while ~ is attacking, copy that spell. You may choose new targets for the copy.', { colors: ['R'], pt: ['2', '2'] });
const DOUBLE_PUMP = card('Test Double Pump', 'Instant', 'Target creature gets +1/+1 until end of turn. Target creature gets +1/+1 until end of turn.', { colors: ['G'] });
const LOKI = card('Test Loki', 'Creature — God', "{T}: When you next cast an instant or sorcery spell with mana value less than or equal to ~'s power this turn, copy that spell.", { colors: ['R'], pt: ['1', '1'] });
const GAIN_ONE = card('Test Gain One', 'Instant', 'You gain 2 life.', { cost: '{1}', colors: ['W'] });
const WITNESS = card('Test Witness', 'Enchantment', 'Whenever you cast a spell, you gain 1 life.', { colors: ['W'] });
const ALL = [WITNESS, DOUBLE_PUMP, LOKI, GAIN_ONE, DOUBLER, SMALL_DOUBLER, TRIPLER, ANY_DOUBLER, GAIN, GAIN_COSTLY, PUMP, BEAR, COPIER, ART_COPIER, LIFEGEM, LIFEBIRD, XCOPIER, MIRROR, SINGLE, STORM_ENGINE, OTHER_HAND, FLASHBACK_GAIN, ATTACKER];

describe('design 6.9: every T45 sentence is compiled to data, none left manual', () => {
  it('no manual ability on the T45 test cards', () => {
    for (const d of ALL) expect(noManual(d), d.name).toEqual([]);
  });
});

/** Resolve everything on the stack (the active player passes first, then the other), answering "no" to a question about new targets. */
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
    const d = s.pending;
    if (d && d.kind !== 'priority') s = decline(s);
    else s = pass(s);
  }
  return s;
}
/** Answer whatever question is pending with the "keep everything" answer (new targets: leave them). */
function decline(s: GameState): GameState {
  const d = s.pending as unknown as { kind: string };
  if (d.kind === 'confirm' || d.kind === 'yesNo') return answer(s, { kind: d.kind, yes: false } as never);
  if (d.kind === 'chooseTargets') return answer(s, { kind: 'chooseTargets', targets: [] });
  throw new Error(`unexpected decision ${d.kind}`);
}

describe('CR 603.7b, 707.10: "When you next cast an instant or sorcery spell this turn, copy that spell."', () => {
  const board = (hand: string[], extra: Partial<Record<'battlefield', string[]>> = {}): GameState =>
    scenario([], { defs: ALL, p1: { hand, ...extra } });
  const cast = (s: GameState, name: string): GameState => castAuto(s, name);

  it('the next instant or sorcery spell you cast this turn is copied: the copy resolves too (CR 707.10), so the life is gained twice', () => {
    let s = board(['Test Doubler', 'Test Gain']);
    s = resolveAll(cast(s, 'Test Doubler'));
    expect(life(s, 'p1')).toBe(20);
    s = cast(s, 'Test Gain');
    // the delayed trigger goes on the stack above the spell
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(24);
  });

  it('it triggers once: the second spell of the turn is not copied (CR 603.7b)', () => {
    let s = board(['Test Doubler', 'Test Gain', 'Test Gain']);
    s = resolveAll(cast(s, 'Test Doubler'));
    s = resolveAll(cast(s, 'Test Gain'));
    expect(life(s, 'p1')).toBe(24);
    s = resolveAll(cast(s, 'Test Gain'));
    expect(life(s, 'p1')).toBe(26);
  });

  it('it waits only for this turn: a spell cast the next turn is not copied', () => {
    let s = board(['Test Doubler']);
    s = resolveAll(cast(s, 'Test Doubler'));
    expect(s.delayedTriggers).toHaveLength(1);
    s = advanceTo(s, 3, 'main1'); // p2's turn 2, then p1's turn 3
    expect(s.delayedTriggers).toHaveLength(0);
  });

  it('a spell that is not an instant or sorcery does not use it up (a creature spell: nothing happens, the next sorcery is copied)', () => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Doubler', 'Test Bear', 'Test Gain'] } });
    s = resolveAll(cast(s, 'Test Doubler'));
    s = resolveAll(cast(s, 'Test Bear'));
    expect(s.delayedTriggers).toHaveLength(1);
    s = resolveAll(cast(s, 'Test Gain'));
    expect(life(s, 'p1')).toBe(24);
    expect(s.delayedTriggers).toHaveLength(0);
  });

  it('"with mana value 1 or less": a more expensive spell is not copied and does not use it up', () => {
    let s = scenario(['Plains', 'Plains'], { defs: ALL, p1: { hand: ['Test Small Doubler', 'Test Costly Gain', 'Test Gain'], battlefield: ['Plains', 'Plains'] } });
    s = resolveAll(cast(s, 'Test Small Doubler'));
    s = resolveAll(cast(s, 'Test Costly Gain'));
    expect(life(s, 'p1')).toBe(25);
    expect(s.delayedTriggers).toHaveLength(1);
    s = resolveAll(cast(s, 'Test Gain'));
    expect(life(s, 'p1')).toBe(29);
  });

  it('"copy it twice": two copies', () => {
    let s = board(['Test Tripler', 'Test Gain']);
    s = resolveAll(cast(s, 'Test Tripler'));
    s = resolveAll(cast(s, 'Test Gain'));
    expect(life(s, 'p1')).toBe(26);
  });

  it('"Copy the next spell you cast this turn when you cast it.": any spell, once', () => {
    let s = board(['Test Any Doubler', 'Test Bear', 'Test Gain']);
    s = resolveAll(cast(s, 'Test Any Doubler'));
    s = resolveAll(cast(s, 'Test Gain'));
    expect(life(s, 'p1')).toBe(24);
    expect(s.delayedTriggers).toHaveLength(0);
  });
});

/** Activate ability `key` of the first `name` on the battlefield; `pick` chooses the targets from the offered objects; payment is automatic. */
function activate(s0: GameState, name: string, key = 'p:0:0', pick: (offered: ObjectId[]) => TargetChoice[] = () => [], x?: number): GameState {
  let s = act(s0, { type: 'activate', player: 'p1', source: find(s0, name, 'battlefield'), ability: key, ...(x !== undefined ? { x } : {}) } as never);
  for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: pick((s.pending as unknown as { objects: ObjectId[] }).objects) });
    else if (s.pending.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x ?? 0 });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const objectsOnStack = (s: GameState): ObjectId[] => [...s.zones.stack];
const target = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

describe('CR 707.10, 113.3b-c: "Copy target activated or triggered ability you control."', () => {
  const board = (): GameState => scenario([], { defs: ALL, p1: { battlefield: ['Test Copier', 'Test Lifegem', 'Test Lifebird', 'Test Artifact Copier'] } });

  it('copies an activated ability on the stack: the copy resolves too (CR 707.10), the life is gained twice', () => {
    let s = activate(board(), 'Test Lifegem');
    const original = objectsOnStack(s)[0]!;
    s = activate(s, 'Test Copier', 'p:0:0', (offered) => {
      expect(offered).toContain(original);
      return [target(original)];
    });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(22);
  });

  it('the copier cannot target itself (CR 115.5: not itself)', () => {
    let s = activate(board(), 'Test Lifegem');
    s = activate(s, 'Test Copier', 'p:0:0', (offered) => {
      expect(offered).toHaveLength(1); // only the Lifegem ability
      return [target(offered[0]!)];
    });
    expect(objectsOnStack(s)).toHaveLength(2);
  });

  it('an ability an opponent controls is no target ("you control")', () => {
    let s = scenario([], { defs: ALL, p1: { battlefield: ['Test Copier', 'Test Lifegem'] }, p2: { battlefield: ['Test Lifegem'] } });
    s = activate(s, 'Test Lifegem'); // p1's own ability
    const mine = objectsOnStack(s)[0]!;
    s = pass(s); // p2 gets priority with p1's ability on the stack
    s = act(s, { type: 'activate', player: 'p2', source: find(s, 'Test Lifegem', 'battlefield', 'p2'), ability: 'p:0:0' } as never);
    const theirs = objectsOnStack(s).find((id) => id !== mine)!;
    s = pass(s); // p2 passes: p1 has priority again
    expect(s.pending?.player).toBe('p1');
    s = activate(s, 'Test Copier', 'p:0:0', (offered) => {
      expect(offered).toContain(mine);
      expect(offered).not.toContain(theirs);
      return [target(mine)];
    });
    expect(objectsOnStack(s)).toHaveLength(3); // p1's ability, p2's ability and the copier's ability on top
  });

  it('"from an artifact source": the ability of an artifact can be copied, the ability of a creature cannot', () => {
    let s = activate(board(), 'Test Lifebird'); // a creature source: 3 life
    const bird = objectsOnStack(s)[0]!;
    s = activate(s, 'Test Lifegem'); // an artifact source: 1 life
    const gem = objectsOnStack(s).find((id) => id !== bird)!;
    s = activate(s, 'Test Artifact Copier', 'p:0:0', (offered) => {
      expect(offered).toContain(gem);
      expect(offered).not.toContain(bird);
      return [target(gem)];
    });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(20 + 3 + 1 + 1);
  });

  it('copies a triggered ability on the stack too (CR 113.3c): the trigger is gained twice', () => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Gain'], battlefield: ['Test Copier', 'Test Witness'] } });
    s = castAuto(s, 'Test Gain'); // Test Witness triggers: the trigger is on the stack above the spell
    const trigger = objectsOnStack(s).find((id) => s.objects[id]!.kind === 'ability')!;
    expect(trigger).toBeDefined();
    s = activate(s, 'Test Copier', 'p:0:0', (offered) => {
      expect(offered).toContain(trigger);
      return [target(trigger)];
    });
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(20 + 2 + 1 + 1);
  });

  it('"X times": X copies', () => {
    let s = scenario(['Plains', 'Plains'], { defs: ALL, p1: { battlefield: ['Test X Copier', 'Test Lifegem', 'Plains', 'Plains'] } });
    s = activate(s, 'Test Lifegem');
    const original = objectsOnStack(s)[0]!;
    s = activate(s, 'Test X Copier', 'p:0:0', () => [target(original)], 2);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(20 + 1 + 2);
  });
});

/** Cast `name` from p1's hand, choosing `pick` (from the offered objects and players) for the first target group. */
function castTargeting(s0: GameState, name: string, pick: (d: { objects: ObjectId[]; players: string[] }) => TargetChoice[]): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') });
  for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
    if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: pick(s.pending as unknown as { objects: ObjectId[]; players: string[] }) });
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return s;
}
const powerOf = (s: GameState, id: ObjectId): number => Number(s.objects[id]!.counters['+1/+1'] ?? 0);
const spellsOnStack = (s: GameState): ObjectId[] => s.zones.stack.filter((id) => s.objects[id]!.kind !== 'ability');

describe('CR 115.9c, 707.10: "Whenever you cast an instant or sorcery spell that targets only a single creature you control, copy that spell."', () => {
  const board = (): GameState => scenario([], { defs: ALL, p1: { hand: ['Test Pump'], battlefield: ['Test Mirror', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
  it('a spell that targets only your creature is copied (two spells on the stack)', () => {
    const s0 = board();
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = castTargeting(s0, 'Test Pump', () => [target(mine)]);
    // the trigger is on the stack above the spell; resolve it: the copy joins the spell
    const afterTrigger = pass(pass(s));
    const t = afterTrigger.pending && afterTrigger.pending.kind !== 'priority' ? decline(afterTrigger) : afterTrigger;
    expect(spellsOnStack(t).length).toBe(2);
  });
  it("a spell that targets an opponent's creature is not copied (the target is not a creature you control)", () => {
    const s0 = board();
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = castTargeting(s0, 'Test Pump', () => [target(theirs)]);
    expect(s.zones.stack).toHaveLength(1);
    expect(s.pendingTriggers).toEqual([]);
  });
});

describe('CR 115.9a: "Whenever you cast an instant or sorcery spell with a single target, copy it."', () => {
  it('one target: copied; no target at all: not copied', () => {
    const s0 = scenario([], { defs: ALL, p1: { hand: ['Test Pump', 'Test Gain'], battlefield: ['Test Single', 'Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const one = castTargeting(s0, 'Test Pump', () => [target(bear)]);
    expect(one.zones.stack.length).toBe(2); // the spell and the trigger
    const none = castAuto(s0, 'Test Gain');
    expect(none.zones.stack.length).toBe(1);
  });
});

describe("CR 702.40a: \"copy it for each other instant and sorcery spell you've cast before it this turn\"", () => {
  it('the first spell of the turn gets no copy; the second one copy; the third two (life 2 + 2*2 + 2*3)', () => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Gain', 'Test Gain', 'Test Gain', 'Test Bear'], battlefield: ['Test Storm Engine'] } });
    s = resolveAll(castAuto(s, 'Test Gain'));
    expect(life(s, 'p1')).toBe(22);
    s = resolveAll(castAuto(s, 'Test Bear')); // a creature spell is not counted
    s = resolveAll(castAuto(s, 'Test Gain'));
    expect(life(s, 'p1')).toBe(26);
    s = resolveAll(castAuto(s, 'Test Gain'));
    expect(life(s, 'p1')).toBe(32);
  });
  it('a spell cast in response to the trigger is not counted (the count is fixed when the spell was cast)', () => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Gain', 'Test Gain', 'Test Gain'], battlefield: ['Test Storm Engine'] } });
    s = resolveAll(castAuto(s, 'Test Gain')); // 22
    s = castAuto(s, 'Test Gain'); // the second: the trigger waits on the stack
    s = castAuto(s, 'Test Gain'); // the third, in response: its own trigger (two copies) is above the second one's
    s = resolveAll(s);
    // third: 2 + 2*2 = 6 life; second: 2 + 1*2 = 4 life (it must not count the third); first: 2
    expect(life(s, 'p1')).toBe(20 + 2 + 4 + 6);
  });
});

describe('CR 601.2a: "Whenever you cast a spell from anywhere other than your hand, you may copy it."', () => {
  it('a flashback spell (cast from the graveyard) can be copied; a spell cast from the hand is not', () => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Gain'], graveyard: ['Test Flashback Gain'], battlefield: ['Test Elsewhere'] } });
    const hand = castAuto(s, 'Test Gain');
    expect(hand.zones.stack.length).toBe(1); // no trigger
    s = castAuto(s, 'Test Flashback Gain', { method: 'flashback' });
    expect(s.zones.stack.length).toBe(2); // the spell and the trigger
  });
});

describe('CR 508.1, 603.2: "Whenever you cast a spell while ~ is attacking, copy that spell."', () => {
  it('only while it attacks: not in the first main phase, copied during the declare attackers step', () => {
    let s = scenario([], { defs: ALL, p1: { hand: ['Test Gain', 'Test Gain'], battlefield: ['Test Raider'] } });
    expect(castAuto(s, 'Test Gain').zones.stack.length).toBe(1); // main phase: not attacking
    const raider = find(s, 'Test Raider', 'battlefield');
    for (let i = 0; i < 60 && !(s.turn.step === 'declareAttackers' && s.pending!.kind === 'priority'); i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: raider, defender: 'p2' }] });
      else s = pass(s);
    }
    expect(s.turn.step).toBe('declareAttackers');
    expect(castAuto(s, 'Test Gain').zones.stack.length).toBe(2); // the spell and the trigger
  });
});

describe('CR 115.9c: "targets only" counts DIFFERENT targets (the same creature chosen twice is one target)', () => {
  const board = (): GameState => scenario([], { defs: ALL, p1: { hand: ['Test Double Pump'], battlefield: ['Test Mirror', 'Test Bear', 'Test Bear'] } });
  const cast2 = (s0: GameState, first: ObjectId, second: ObjectId): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Double Pump', 'hand') });
    const picks = [first, second];
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [target(picks.shift()!)] });
      else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    return s;
  };
  it('the same creature twice: the spell has two targets but one different target, so Mirror triggers', () => {
    const s0 = board();
    const [a] = findAll(s0, 'Test Bear', 'battlefield');
    const s = cast2(s0, a!, a!);
    expect(s.zones.stack.length).toBe(2); // the spell and the trigger
  });
  it('two different creatures: no trigger', () => {
    const s0 = board();
    const [a, b] = findAll(s0, 'Test Bear', 'battlefield');
    const s = cast2(s0, a!, b!);
    expect(s.zones.stack.length).toBe(1);
  });
});

describe("CR 202.3, 603.7: \"... with mana value less than or equal to ~'s power this turn\": the power is read as the spell is cast", () => {
  it('a mana value of 1 is copied when the power is 1, the spell of mana value 2 is not; the delayed trigger waits for the first spell that fits', () => {
    let s = scenario(['Plains', 'Plains', 'Plains'], { defs: ALL, p1: { hand: ['Test Costly Gain', 'Test Gain One'], battlefield: ['Test Loki', 'Plains', 'Plains', 'Plains'] } });
    s = activate(s, 'Test Loki');
    s = resolveAll(s);
    expect(s.delayedTriggers).toHaveLength(1);
    s = resolveAll(castAuto(s, 'Test Costly Gain')); // mana value 2 > power 1: not copied, not used up
    expect(life(s, 'p1')).toBe(25);
    expect(s.delayedTriggers).toHaveLength(1);
    s = resolveAll(castAuto(s, 'Test Gain One')); // mana value 1: copied
    expect(life(s, 'p1')).toBe(29);
    expect(s.delayedTriggers).toHaveLength(0);
  });
  it('a power gained before the spell is cast counts (+1/+1 until end of turn makes the mana value 2 spell fit)', () => {
    let s = scenario(['Plains', 'Plains', 'Plains'], { defs: ALL, p1: { hand: ['Test Pump', 'Test Costly Gain'], battlefield: ['Test Loki', 'Plains', 'Plains', 'Plains'] } });
    const loki = find(s, 'Test Loki', 'battlefield');
    s = resolveAll(castTargeting(s, 'Test Pump', () => [target(loki)]));
    s = resolveAll(activate(s, 'Test Loki'));
    s = resolveAll(castAuto(s, 'Test Costly Gain'));
    expect(life(s, 'p1')).toBe(30); // power 2: the spell of mana value 2 fits; 5 life twice
  });
});

describe('CR 113.7a, 608.2h: "from an artifact source" is the source as it last existed', () => {
  it('the ability of an artifact that left the battlefield after the ability was put on the stack can still be copied', () => {
    let s = scenario([], { defs: ALL, p1: { battlefield: ['Test Lifegem', 'Test Artifact Copier'] } });
    s = activate(s, 'Test Lifegem');
    const original = objectsOnStack(s)[0]!;
    const gem = find(s, 'Test Lifegem', 'battlefield');
    // the gem is gone (as it would be if it were sacrificed to its own cost): the ability stays on the stack
    s = { ...s, zones: { ...s.zones, battlefield: s.zones.battlefield.filter((id) => id !== gem) }, lki: { ...s.lki, [gem]: { object: { ...s.objects[gem]!, zone: 'graveyard' }, zone: 'battlefield' } as never } };
    delete (s.objects as Record<string, unknown>)[gem];
    s = activate(s, 'Test Artifact Copier', 'p:0:0', (offered) => {
      expect(offered).toContain(original);
      return [target(original)];
    });
    expect(objectsOnStack(s)).toHaveLength(2);
  });
});
