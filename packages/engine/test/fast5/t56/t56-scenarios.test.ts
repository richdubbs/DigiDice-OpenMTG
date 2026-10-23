/**
 * FAST5 T56: spell riders played through the engine with synthetic cards (wordings invented, design 6.10): "Then discard N cards unless you discard a <card>",
 * "Then discard a card unless you attacked this turn", "Then it fights target creature an opponent controls", "If that spell is countered this way, exile it
 * instead", "You may cast ~ as though it had flash if you pay {2} more", "gains flashback ... The flashback cost is equal to its mana cost", "discard up to N cards,
 * then draw that many cards", "If you controlled that permanent, draw a card", "If that creature is a <subtype>, it also gets +N/+N".
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, castAuto, find, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

/** Answer the decisions that come up: targets from `targets`, object choices from `picks`, then `answers`; pay costs automatically; stop at priority. */
/** `pick`: which of the offered cards a choice takes (default: the first `min`); the decisions seen are recorded in `seen`. */
const seen: string[] = [];
function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[]; pick?: (options: ObjectId[], min: number, max: number) => ObjectId[] } = {}): GameState {
  let s = s0;
  const groups = [...(opts.targets ?? [])];
  const picks = [...(opts.picks ?? [])];
  const queue = [...(opts.answers ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    seen.push(s.pending.kind);
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (s.pending.kind === 'chooseObjects' && opts.pick) s = answer(s, { kind: 'chooseObjects', ids: opts.pick(s.pending.options, s.pending.min, s.pending.max) });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const cast = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), opts);
/** Cast a spell and let it resolve (both players pass), answering what comes up. */
const castAndResolve = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}): GameState => settle(pass(pass(cast(s0, name, opts))), opts);
const handNames = (s: GameState, p = 'p1'): string[] => zoneNames(s, 'hand', p);
const graveNames = (s: GameState, p = 'p1'): string[] => zoneNames(s, 'graveyard', p);
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);

const ROCK = card('Test Rock', 'Artifact', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '1']);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to any target.');

const firstMin = (options: ObjectId[], min: number): ObjectId[] => options.slice(0, min);

describe('CR 118.12, 608.2d, 701.9a: "Then discard two cards unless you discard an artifact card" (the payer chooses whether, and which card)', () => {
  const THIRST = card('Test Thirst', 'Sorcery', 'Draw two cards. Then discard two cards unless you discard an artifact card.');
  it('is automated', () => expect(automated(THIRST)).toBe(true));
  it('discarding the artifact card pays for it: that one card goes, nothing else', () => {
    const s0 = scenario([], { p1: { hand: ['Test Thirst', 'Test Rock', 'Test Bear'] }, defs: [THIRST, ROCK, BEAR] });
    const s = castAndResolve(s0, 'Test Thirst', { answers: [yes], pick: firstMin });
    expect(graveNames(s).filter((n) => n === 'Test Rock')).toHaveLength(1);
    expect(handNames(s)).toContain('Test Bear');
    expect(s.zones.hand.p1!.length).toBe(3); // Test Bear and two drawn Plains
  });
  it('declining: two cards are discarded, chosen by the player, and the artifact card is not forced out', () => {
    const s0 = scenario([], { p1: { hand: ['Test Thirst', 'Test Rock', 'Test Bear'] }, defs: [THIRST, ROCK, BEAR] });
    const rock = find(s0, 'Test Rock', 'hand', 'p1');
    const bear = find(s0, 'Test Bear', 'hand', 'p1');
    const s = castAndResolve(s0, 'Test Thirst', { answers: [no], pick: (opts) => [bear, ...opts.filter((o) => o !== bear && o !== rock).slice(0, 1)] });
    expect(handNames(s)).toContain('Test Rock');
    expect(handNames(s)).not.toContain('Test Bear');
    expect(s.zones.hand.p1!.length).toBe(2); // Rock + 3 Plains (2 drawn + ... ) minus two discarded
  });
  it('the question says which card pays (an artifact card), and the payer is the one who is asked', () => {
    const s0 = scenario([], { p1: { hand: ['Test Thirst', 'Test Rock'] }, defs: [THIRST, ROCK] });
    const s = pass(pass(cast(s0, 'Test Thirst')));
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending?.player).toBe('p1');
    expect((s.pending as { prompt: string }).prompt).toContain('Discard an artifact card');
  });
  it('with no artifact card in hand there is no question to ask: two cards are discarded', () => {
    seen.length = 0;
    const s0 = scenario([], { p1: { hand: ['Test Thirst', 'Test Bear'] }, defs: [THIRST, BEAR] });
    const s = castAndResolve(s0, 'Test Thirst', { pick: firstMin });
    expect(seen).not.toContain('yesNo');
    expect(s.zones.hand.p1!.length).toBe(1);
  });
});

describe('CR 118.12, 608.2d: "Then discard two cards unless you discard an instant or sorcery card or a creature card with flying"', () => {
  const SCHOLAR = card('Test Scholar', 'Sorcery', 'Draw one card. Then discard two cards unless you discard an instant or sorcery card or a creature card with flying.');
  it('is automated', () => expect(automated(SCHOLAR)).toBe(true));
  for (const [what, good, bad] of [['an instant', 'Test Bolt', 'Test Bear'], ['a creature card with flying', 'Test Bird', 'Test Bear']] as const) {
    it(`discarding ${what} pays; a creature without flying does not`, () => {
      const s0 = scenario([], { p1: { hand: ['Test Scholar', good, bad] }, defs: [SCHOLAR, BOLT, BIRD, BEAR] });
      const paid = castAndResolve(s0, 'Test Scholar', { answers: [yes], pick: (opts) => {
        // only the card that matches is offered, not the creature without flying
        expect(opts).toEqual([find(s0, good, 'hand', 'p1')]);
        return opts;
      } });
      expect(graveNames(paid)).toContain(good);
      expect(handNames(paid)).toContain(bad);
    });
  }
  it('the flying creature card is not an instant or sorcery and the plain creature card is no payment at all', () => {
    seen.length = 0;
    const s0 = scenario([], { p1: { hand: ['Test Scholar', 'Test Bear'] }, defs: [SCHOLAR, BEAR] });
    const s = castAndResolve(s0, 'Test Scholar', { pick: firstMin });
    expect(seen).not.toContain('yesNo');
    expect(s.zones.hand.p1!.length).toBe(0); // Bear + 1 Plains, both discarded
  });
});

describe('CR 701.9a, 608.2c: "Then discard a card unless you attacked this turn"', () => {
  const CHART = card('Test Chart', 'Sorcery', 'Draw one card. Then discard a card unless you attacked this turn.');
  it('is automated', () => expect(automated(CHART)).toBe(true));
  it('without an attack this turn a card is discarded', () => {
    const s0 = scenario([], { p1: { hand: ['Test Chart'] }, defs: [CHART] });
    const s = castAndResolve(s0, 'Test Chart', { pick: firstMin });
    expect(s.zones.hand.p1!.length).toBe(0);
    expect(graveNames(s)).toHaveLength(2); // the spell and the discarded Plains
  });
  it('after attacking with a creature nothing is discarded', () => {
    const s0 = scenario([], { p1: { hand: ['Test Chart'], battlefield: ['Test Bear'] }, defs: [CHART, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    let s = s0;
    for (let i = 0; i < 40 && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
      else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = pass(s);
    }
    expect(s.turn.step).toBe('main2');
    s = castAndResolve(s, 'Test Chart', { pick: firstMin });
    expect(s.zones.hand.p1!.length).toBe(1); // the drawn Plains stays
  });
});

describe('CR 701.14, 608.2c: "Then it fights target creature an opponent controls"', () => {
  const TROLL = card('Test Negotiation', 'Sorcery', 'Put two +1/+1 counters on target creature you control. Then it fights target creature an opponent controls.', undefined, '{0}');
  const PRIMAL = card('Test Primal', 'Sorcery', 'Target creature you control gets +1/+1 until end of turn. Then it fights up to one target creature you don\'t control.');
  const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3']);
  const GIANT = card('Test Giant', 'Creature — Giant', '', ['2', '5']);
  it('are automated', () => {
    expect(automated(TROLL)).toBe(true);
    expect(automated(PRIMAL)).toBe(true);
  });
  it('the counters come first, so the creature fights with its new power (CR 608.2c)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Negotiation'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: [TROLL, BEAR, OGRE] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const s = castAndResolve(s0, 'Test Negotiation', { targets: [[obj(bear)], [obj(ogre)]] });
    expect(battlefieldNames(s, 'p2')).not.toContain('Test Ogre'); // 4 damage kills the 3/3
    expect(battlefieldNames(s, 'p1')).toContain('Test Bear'); // the 4/4 took 3
    expect(s.objects[bear]!.damage).toBe(3);
  });
  it('"up to one": with no second target nothing fights, and the first part still happens (CR 601.2c)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Primal'], battlefield: ['Test Bear'] }, defs: [PRIMAL, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = castAndResolve(s0, 'Test Primal', { targets: [[obj(bear)], []] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Bear');
    expect(getChars(s, bear).toughness).toBe('3');
    expect(s.objects[bear]!.damage).toBe(0);
  });
  it('"up to one" with a target: both creatures deal damage to each other', () => {
    const s0 = scenario([], { p1: { hand: ['Test Primal'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Giant'] }, defs: [PRIMAL, BEAR, GIANT] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const giant = find(s0, 'Test Giant', 'battlefield');
    const s = castAndResolve(s0, 'Test Primal', { targets: [[obj(bear)], [obj(giant)]] });
    expect(s.objects[giant]!.damage).toBe(3); // the 3/3 Bear (2/2 +1/+1) deals 3
    expect(s.objects[bear]!.damage).toBe(2); // and the 2/5 Giant deals 2
  });
});

describe('CR 118.12a, 701.6a, 614.15: "Counter target spell unless its controller pays {3}. If that spell is countered this way, exile it instead of putting it into its owner\'s graveyard"', () => {
  const SYNC = card('Test Syncopate', 'Instant', 'Counter target spell unless its controller pays {3}. If that spell is countered this way, exile it instead of putting it into its owner\'s graveyard.');
  const GAIN = card('Test Gain', 'Instant', 'You gain 2 life.');
  it('is automated', () => expect(automated(SYNC)).toBe(true));
  /** p1 casts Test Gain, keeps priority and casts Test Syncopate on it; both pass so that the counterspell resolves. */
  const setup = (lands: number): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Gain', 'Test Syncopate'], battlefield: Array(lands).fill('Plains') as string[] }, defs: [GAIN, SYNC] });
    let s = cast(s0, 'Test Gain');
    const gain = find(s, 'Test Gain', 'stack');
    s = cast(s, 'Test Syncopate', { targets: [[obj(gain)]] });
    return s;
  };
  it('not paid: the spell is countered and goes to exile, not to the graveyard', () => {
    const s = settle(pass(pass(setup(0))), { answers: [no] });
    expect(exileNames(s)).toContain('Test Gain');
    expect(graveNames(s)).not.toContain('Test Gain');
    expect(graveNames(s)).toContain('Test Syncopate');
    expect(life(s, 'p1')).toBe(20);
  });
  it('paid: the spell is not countered and resolves as usual', () => {
    let s = pass(pass(setup(3)));
    expect(s.pending?.kind).toBe('yesNo');
    s = settle(answer(s, yes));
    s = settle(pass(pass(s)));
    expect(exileNames(s)).not.toContain('Test Gain');
    expect(graveNames(s)).toContain('Test Gain');
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 701.9a, 121.1, 608.2c, 608.2d: "Discard up to two cards, then draw that many cards"', () => {
  const WHEEL = card('Test Wheel', 'Sorcery', 'Discard up to two cards, then draw that many cards.');
  it('is automated', () => expect(automated(WHEEL)).toBe(true));
  it('discard exactly the cards chosen, then draw as many', () => {
    const s0 = scenario([], { p1: { hand: ['Test Wheel', 'Test Bear', 'Test Rock', 'Test Bolt'] }, defs: [WHEEL, BEAR, ROCK, BOLT] });
    const bear = find(s0, 'Test Bear', 'hand', 'p1');
    const rock = find(s0, 'Test Rock', 'hand', 'p1');
    const s = castAndResolve(s0, 'Test Wheel', { picks: [[bear, rock]] });
    expect(graveNames(s)).toEqual(expect.arrayContaining(['Test Bear', 'Test Rock']));
    expect(handNames(s)).toContain('Test Bolt');
    expect(s.zones.hand.p1!.length).toBe(3); // Bolt + two Plains
  });
  it('choosing none discards nothing and draws nothing; one card draws one', () => {
    const s0 = scenario([], { p1: { hand: ['Test Wheel', 'Test Bear'] }, defs: [WHEEL, BEAR] });
    const none = castAndResolve(s0, 'Test Wheel', { picks: [[]] });
    expect(none.zones.hand.p1!.length).toBe(1);
    const one = castAndResolve(s0, 'Test Wheel', { picks: [[find(s0, 'Test Bear', 'hand', 'p1')]] });
    expect(graveNames(one)).toContain('Test Bear');
    expect(one.zones.hand.p1!.length).toBe(1);
  });
  it('with only one card in hand, at most one can be discarded', () => {
    const s0 = scenario([], { p1: { hand: ['Test Wheel', 'Test Bear'] }, defs: [WHEEL, BEAR] });
    const s = castAndResolve(s0, 'Test Wheel', { pick: (o) => o });
    expect(graveNames(s)).toContain('Test Bear');
    expect(s.zones.hand.p1!.length).toBe(1);
  });
});

describe('CR 608.2h, 603.10a: "If you controlled that permanent, draw a card" (last known information)', () => {
  const BOOMERANG = card('Test Boomerang', 'Sorcery', 'Return target nonland permanent to its owner\'s hand. If you controlled that permanent, draw a card.');
  it('is automated', () => expect(automated(BOOMERANG)).toBe(true));
  it('your own permanent: a card is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Boomerang'], battlefield: ['Test Bear'] }, defs: [BOOMERANG, BEAR] });
    const s = castAndResolve(s0, 'Test Boomerang', { targets: [[obj(find(s0, 'Test Bear', 'battlefield'))]] });
    expect(handNames(s)).toContain('Test Bear');
    expect(s.zones.hand.p1!.length).toBe(2);
  });
  it('an opponent\'s permanent: no card is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Boomerang'] }, p2: { battlefield: ['Test Bear'] }, defs: [BOOMERANG, BEAR] });
    const s = castAndResolve(s0, 'Test Boomerang', { targets: [[obj(find(s0, 'Test Bear', 'battlefield'))]] });
    expect(handNames(s, 'p2')).toContain('Test Bear');
    expect(s.zones.hand.p1!.length).toBe(0);
  });
});

describe('CR 608.2h, 603.10a: "Destroy up to one target artifact. If you controlled that permanent, draw a card" (the artifact is in a graveyard by then)', () => {
  const SMASH = card('Test Smash', 'Sorcery', 'Destroy up to one target artifact. If you controlled that permanent, draw a card.');
  it('is automated', () => expect(automated(SMASH)).toBe(true));
  it.each([['p1', 1], ['p2', 0]] as const)('an artifact of %s: %i card(s) drawn', (owner, drawn) => {
    const s0 = scenario([], { p1: { hand: ['Test Smash'], ...(owner === 'p1' ? { battlefield: ['Test Rock'] } : {}) }, ...(owner === 'p2' ? { p2: { battlefield: ['Test Rock'] } } : {}), defs: [SMASH, ROCK] });
    const s = castAndResolve(s0, 'Test Smash', { targets: [[obj(find(s0, 'Test Rock', 'battlefield'))]] });
    expect(graveNames(s, owner)).toContain('Test Rock');
    expect(s.zones.hand.p1!.length).toBe(drawn);
  });
  it('with no target (up to one) nothing is destroyed and nothing is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Smash'] }, defs: [SMASH] });
    const s = castAndResolve(s0, 'Test Smash', { targets: [[]] });
    expect(s.zones.hand.p1!.length).toBe(0);
  });
});

describe('CR 608.2c, 205.3: "If that creature is a Goat, it also gets +3/+0 until end of turn"', () => {
  const GOATNAP = card('Test Goatnap', 'Sorcery', 'Gain control of target creature until end of turn. If that creature is a Goat, it also gets +3/+0 until end of turn.');
  const GOAT = card('Test Goat', 'Creature — Goat', '', ['1', '1']);
  it('is automated', () => expect(automated(GOATNAP)).toBe(true));
  it('a Goat gets the bonus, another creature does not', () => {
    for (const [name, power] of [['Test Goat', '4'], ['Test Bear', '2']] as const) {
      const s0 = scenario([], { p1: { hand: ['Test Goatnap'] }, p2: { battlefield: [name] }, defs: [GOATNAP, GOAT, BEAR] });
      const target = find(s0, name, 'battlefield');
      const s = castAndResolve(s0, 'Test Goatnap', { targets: [[obj(target)]] });
      expect(s.objects[target]!.controller).toBe('p1');
      expect(getChars(s, target).power).toBe(power);
    }
  });
});

describe('CR 702.34a, 118.9, 613.1f: "target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost"', () => {
  const TUTOR = card('Test Tutor', 'Creature — Wizard', 'When ~ enters, target instant or sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.', ['2', '1']);
  const PRICEY = card('Test Pricey', 'Instant', 'You gain 3 life.', undefined, '{2}');
  const flashbackLabels = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && /flashback/.test(a.label)).map((a) => a.label);
  it('is automated', () => expect(automated(TUTOR)).toBe(true));
  const enter = (lands: number): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Tutor'], graveyard: ['Test Pricey'], battlefield: Array(lands).fill('Plains') as string[] }, defs: [TUTOR, PRICEY] });
    const entered = settle(pass(pass(cast(s0, 'Test Tutor'))), { targets: [[obj(find(s0, 'Test Pricey', 'graveyard', 'p1'))]] });
    return settle(pass(pass(entered)));
  };
  it('the card can be cast from the graveyard for its own mana cost, and is then exiled', () => {
    let s = enter(2);
    expect(flashbackLabels(s)).toEqual(['Cast Test Pricey with flashback']);
    const pricey = find(s, 'Test Pricey', 'graveyard', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: pricey, method: 'flashback' }));
    s = settle(pass(pass(s)));
    expect(life(s, 'p1')).toBe(23);
    expect(exileNames(s)).toContain('Test Pricey'); // CR 702.34a
    expect(s.objects[find(s, 'Test Tutor', 'battlefield')]).toBeDefined();
  });
  it('the cost is its mana cost, so with too little mana it is not offered', () => {
    expect(flashbackLabels(enter(1))).toEqual([]);
  });
  it('until end of turn: on the next turn the card has no flashback', () => {
    const s = advanceTo(enter(2), 2, 'main1');
    expect(flashbackLabels(s)).toEqual([]);
  });
});

describe('CR 601.3b, 601.2f: "You may cast this spell as though it had flash if you pay {2} more to cast it"', () => {
  const FLASHY = card('Test Flashy', 'Sorcery', 'You may cast this spell as though it had flash if you pay {2} more to cast it.\nYou gain 2 life.', undefined, '{1}');
  const FLASHBEAR = card('Test Flashbear', 'Creature — Bear', 'You may cast this spell as though it had flash if you pay {2} more to cast it.', ['2', '2'], '{1}');
  const GAIN = card('Test Gain', 'Instant', 'You gain 1 life.');
  const castable = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.label.includes(name));
  const tapped = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.tapped).length;
  it('are automated', () => {
    expect(automated(FLASHY)).toBe(true);
    expect(automated(FLASHBEAR)).toBe(true);
  });
  it('at sorcery timing it costs only its mana cost: nothing extra is asked', () => {
    const s0 = scenario([], { p1: { hand: ['Test Flashy'], battlefield: ['Plains'] }, defs: [FLASHY] });
    expect(castable(s0, 'Test Flashy')).toBe(true);
    const s = settle(pass(pass(cast(s0, 'Test Flashy'))));
    expect(life(s, 'p1')).toBe(22);
  });
  it('with a spell on the stack it can be cast only when {2} more can be paid, and then costs {3}', () => {
    const base = (lands: number): GameState => cast(scenario([], { p1: { hand: ['Test Flashy', 'Test Gain'], battlefield: Array(lands).fill('Plains') as string[] }, defs: [FLASHY, GAIN] }), 'Test Gain');
    expect(base(2).zones.stack).toHaveLength(1);
    expect(castable(base(2), 'Test Flashy')).toBe(false); // {1} + {2} more = 3 lands
    const s3 = base(3);
    expect(castable(s3, 'Test Flashy')).toBe(true);
    const s = cast(s3, 'Test Flashy');
    expect(s.zones.stack).toHaveLength(2);
    expect(tapped(s)).toBe(3);
  });
  it('a creature spell too: at instant speed with the stack non-empty; at sorcery timing it costs {1}', () => {
    const s0 = scenario([], { p1: { hand: ['Test Flashbear', 'Test Gain'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: [FLASHBEAR, GAIN] });
    const during = cast(cast(s0, 'Test Gain'), 'Test Flashbear');
    expect(tapped(during)).toBe(3);
    const normal = cast(s0, 'Test Flashbear');
    expect(tapped(normal)).toBe(1);
  });
  it('without the permission a sorcery cannot be cast with a spell on the stack', () => {
    const PLAIN = card('Test Plain Sorcery', 'Sorcery', 'You gain 2 life.', undefined, '{1}');
    const s = cast(scenario([], { p1: { hand: ['Test Plain Sorcery', 'Test Gain'], battlefield: ['Plains', 'Plains', 'Plains'] }, defs: [PLAIN, GAIN] }), 'Test Gain');
    expect(castable(s, 'Test Plain Sorcery')).toBe(false);
  });
});
