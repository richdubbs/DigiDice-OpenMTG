/**
 * Commander lane edh-c, round edh-c-33 (EDHREC ranks 24,501-25,000): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites
 * checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 701.26a, 608.2c, 608.2d   "Tap any number of untapped creatures you control. You gain N life for each creature tapped this way." / "you may tap any number of ..."
 *   CR 603.4, 508.1, 305.1       "At the beginning of your end step, if ~ didn't attack this turn, ..." / "... if you didn't play a land this turn, ..."
 *   CR 603.4, 508.1, 509.1, 701.24a  "At the beginning of each end step, if ~ attacked or blocked this turn, its owner shuffles it into their library."
 *   CR 608.2d, 400.3             "Return up to two lands you control to their owner's hand."
 *   CR 400.3              "Put target card from an opponent's graveyard on the bottom of their library."
 *   CR 725.1, 508.1b             "~ can't attack unless defending player is the monarch."
 *   CR 509.1a, 509.1b            "As long as ~ is a creature, it can block an additional creature each combat."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { attackWith, card, cast, full, named, pt, resolveAll, settle } from '../cmd3/helpers';
import { declareAttackers, tweak, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';

const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const tappedOf = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped;
const inLib = (s: GameState, p: string, def: string): number => (s.zones.library[p] ?? []).filter((id) => s.objects[id]!.defId === def).length;
const counters = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;

/** Pass priority (declaring no attackers and no blockers, ordering triggers as offered) until the end step has begun and a player has priority. */
function toEnd(s0: GameState): GameState {
  let s = s0;
  for (let g = 0; g < 80; g++) {
    if (s.turn.step === 'end' && s.pending?.kind === 'priority' && s.zones.stack.length === 0) return s;
    const d = s.pending;
    if (d === null) throw new Error('no decision');
    if (d.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: (d as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else s = act(s, { type: 'pass', player: d.player });
  }
  throw new Error('never reached the end step');
}
/** The same after attackers were declared (stops in the end step too). */
const finish = (s: GameState): GameState => toEnd(s);

const GUARD = card('Test Elf', 'Creature — Elf', '', ['1', '1']);

// ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.26a, 608.2c: "Tap any number of untapped creatures you control. You gain N life for each creature tapped this way."', () => {
  const HYMN = card('Test Rally Hymn', 'Sorcery', 'Tap any number of untapped creatures you control. You gain 4 life for each creature tapped this way.');
  const board = (): GameState => scenario([], {
    defs: [HYMN, GUARD], p1: { hand: ['Test Rally Hymn'], battlefield: [{ name: 'Test Elf' }, { name: 'Test Elf' }, { name: 'Test Elf' }, { name: 'Test Elf', tapped: true }] }, p2: { battlefield: ['Test Elf'] },
  });
  const untapped = (s: GameState): ObjectId[] => named(s, 'Test Elf').filter((id) => s.objects[id]!.controller === 'p1' && !s.objects[id]!.tapped);
  it('is automated', () => expect(full(HYMN)).toBe(true));
  it('offers only YOUR untapped creatures (3 of 5 creatures) and gains 4 life for each one tapped', () => {
    const s0 = board();
    const mine = untapped(s0);
    const s = resolveAll(cast(s0, 'Test Rally Hymn', { objects: mine.slice(0, 2) }), { objects: mine.slice(0, 2) });
    expect(lifeOf(s, 'p1')).toBe(20 + 8);
    expect(mine.slice(0, 2).every((id) => tappedOf(s, id))).toBe(true);
    expect(tappedOf(s, mine[2]!)).toBe(false);
  });
  it('negative: tapping none gains nothing; the opponent\'s creature is never offered', () => {
    const s0 = board();
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rally Hymn', 'hand', 'p1') } as never);
    s = settle(s);
    s = resolveAll(s, { objects: [] });
    expect(lifeOf(s, 'p1')).toBe(20);
    const opp = find(s0, 'Test Elf', 'battlefield', 'p2');
    expect(s.objects[opp]!.tapped).toBe(false);
  });
});

describe('CR 701.26a, 608.2d: "Whenever ~ attacks, you may tap any number of untapped creatures you control. ~ gets +1/+1 until end of turn for each creature tapped this way."', () => {
  const STRIKER = card('Test Siege Rider', 'Creature — Human', 'Whenever this creature attacks, you may tap any number of untapped creatures you control. This creature gets +1/+1 until end of turn for each creature tapped this way.', ['2', '2']);
  const board = (): GameState => scenario([], { defs: [STRIKER, GUARD], p1: { battlefield: ['Test Siege Rider', 'Test Elf', 'Test Elf', { name: 'Test Elf', tapped: true }] } });
  it('is automated', () => expect(full(STRIKER)).toBe(true));
  it('each creature tapped adds +1/+1; the attacker (tapped by attacking) and an already tapped creature are not counted', () => {
    const s0 = board();
    const rider = find(s0, 'Test Siege Rider', 'battlefield', 'p1');
    const elves = named(s0, 'Test Elf').filter((id) => !s0.objects[id]!.tapped);
    const s = resolveAll(attackWith(s0, [rider]), { objects: elves });
    expect(pt(s, rider)).toBe('4/4');
    expect(elves.every((id) => tappedOf(s, id))).toBe(true);
  });
  it('negative: tapping none leaves it 2/2', () => {
    const s0 = board();
    const rider = find(s0, 'Test Siege Rider', 'battlefield', 'p1');
    expect(pt(resolveAll(attackWith(s0, [rider]), { objects: [] }), rider)).toBe('2/2');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.4, 508.1: "At the beginning of your end step, if ~ didn\'t attack this turn, put a +1/+1 counter on it."', () => {
  const STUDENT = card('Test Quiet Monk', 'Creature — Human Monk', 'At the beginning of your end step, if this creature didn\'t attack this turn, put a +1/+1 counter on it.', ['1', '1']);
  const board = (): GameState => scenario([], { defs: [STUDENT], p1: { battlefield: ['Test Quiet Monk'] }, p2: { battlefield: [] } });
  it('is automated', () => expect(full(STUDENT)).toBe(true));
  it('gets a counter at the end step when it stayed home', () => {
    const s0 = board();
    const monk = find(s0, 'Test Quiet Monk', 'battlefield', 'p1');
    const s = resolveAll(toEnd(s0));
    expect(counters(s, monk)).toBe(1);
  });
  it('negative: no counter when it attacked this turn', () => {
    const s0 = board();
    const monk = find(s0, 'Test Quiet Monk', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[monk]]);
    s = resolveAll(finish(s));
    expect(counters(s, monk)).toBe(0);
  });
});

describe('CR 603.4, 305.1: "At the beginning of your end step, if you didn\'t play a land this turn, you may draw a card."', () => {
  const ATLAS = card('Test Idle Map', 'Artifact', 'At the beginning of your end step, if you didn\'t play a land this turn, you may draw a card.');
  const board = (): GameState => scenario([], { defs: [ATLAS], p1: { hand: ['Plains'], battlefield: ['Test Idle Map'] } });
  const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
  it('is automated', () => expect(full(ATLAS)).toBe(true));
  it('draws when no land was played', () => {
    const s0 = board();
    const s = resolveAll(toEnd(s0), { yes: true });
    expect(handSize(s)).toBe(handSize(s0) + 1);
  });
  it('negative: no draw when a land was played this turn', () => {
    const s0 = board();
    const played = act(s0, { type: 'playLand', player: 'p1', card: find(s0, 'Plains', 'hand', 'p1') } as never);
    const s = resolveAll(toEnd(played), { yes: true });
    expect(handSize(s)).toBe(handSize(played));
  });
});

describe('CR 603.4, 508.1, 509.1, 701.24a: "At the beginning of each end step, if ~ attacked or blocked this turn, its owner shuffles it into their library."', () => {
  const HELLION = card('Test Fickle Hellion', 'Creature — Hellion', 'At the beginning of each end step, if this creature attacked or blocked this turn, its owner shuffles it into their library.', ['2', '2']);
  const FLEETING = card('Test Fleeting Hellion', 'Creature — Hellion', 'At the beginning of the end step, this creature\'s owner shuffles it into their library.', ['2', '2']);
  const board = (): GameState => scenario([], { defs: [HELLION, FLEETING, GUARD], p1: { battlefield: ['Test Fickle Hellion', 'Test Fleeting Hellion'] }, p2: { battlefield: ['Test Elf'] } });
  it('is automated', () => { expect(full(HELLION)).toBe(true); expect(full(FLEETING)).toBe(true); });
  it('shuffled into its owner\'s library after it attacked', () => {
    const s0 = board();
    const h = find(s0, 'Test Fickle Hellion', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(s0), [[h]]);
    s = resolveAll(finish(s));
    expect(s.zones.battlefield.includes(h)).toBe(false);
    expect(inLib(s, 'p1', 'Test Fickle Hellion')).toBe(1);
  });
  it('negative: stays on the battlefield when it neither attacked nor blocked (the other, unconditional one is shuffled away)', () => {
    const s0 = board();
    const s = resolveAll(toEnd(s0));
    expect(named(s, 'Test Fickle Hellion').length).toBe(1);
    expect(named(s, 'Test Fleeting Hellion').length).toBe(0);
    expect(inLib(s, 'p1', 'Test Fleeting Hellion')).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.24a, 400.7 (CR 701.24c): the library is shuffled even if the creature is no longer on the battlefield', () => {
  const HELL = card('Test Escape Hellion', 'Creature — Hellion', 'At the beginning of the end step, this creature\'s owner shuffles it into their library.\nSacrifice this creature: You gain 1 life.', ['2', '2']);
  const toTrigger = (): GameState => {
    let s = scenario([], { defs: [HELL], p1: { battlefield: ['Test Escape Hellion'] } });
    for (let g = 0; g < 80 && !(s.turn.step === 'end' && s.zones.stack.length > 0); g++) {
      const d = s.pending!;
      s = d.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : act(s, { type: 'pass', player: d.player });
    }
    return s;
  };
  const shuffles = (s: GameState): boolean => s.log.some((l) => /shuffles their library/.test(l.text));
  it('is automated', () => expect(full(HELL)).toBe(true));
  it('on the battlefield as it resolves: it goes into its owner\'s library and the library is shuffled', () => {
    let s = toTrigger();
    for (let g = 0; g < 6 && s.zones.stack.length > 0; g++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(named(s, 'Test Escape Hellion').length).toBe(0);
    expect(inLib(s, 'p1', 'Test Escape Hellion')).toBe(1);
    expect(shuffles(s)).toBe(true);
  });
  it('sacrificed in response, it is not put into the library but the library is still shuffled (CR 701.24c)', () => {
    let s = toTrigger();
    s = act(s, (legal(s, 'p1', 'activate')[0] as unknown as { action: never }).action);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let g = 0; g < 8 && s.zones.stack.length > 0; g++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(inLib(s, 'p1', 'Test Escape Hellion')).toBe(0);
    expect(s.zones.graveyard['p1']!.length).toBe(1);
    expect(shuffles(s)).toBe(true);
  });
});

describe('CR 701.24a, 400.3, 603.6c: "When ~ is put into a graveyard from the battlefield, its owner shuffles it into their library." ', () => {
  const CAKE = card('Test Elf Cake', 'Artifact — Food', 'Sacrifice this artifact: You gain 1 life.\nWhen this artifact is put into a graveyard from the battlefield, its owner shuffles it into their library.');
  it('is automated', () => expect(full(CAKE)).toBe(true));
  it('sacrificed, it goes from the graveyard into its owner\'s library and that library is shuffled', () => {
    let s = scenario([], { defs: [CAKE], p1: { battlefield: ['Test Elf Cake'] } });
    s = act(s, (legal(s, 'p1', 'activate')[0] as unknown as { action: never }).action);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let g = 0; g < 12 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); g++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : settle(s);
    expect(inLib(s, 'p1', 'Test Elf Cake')).toBe(1);
    expect(s.zones.graveyard['p1']!.length).toBe(0);
    expect(s.log.some((l) => /shuffles their library/.test(l.text))).toBe(true);
  });
});

describe('CR 608.2d, 400.3: "When ~ enters, return up to two lands you control to their owner\'s hand."', () => {
  const STOMPER = card('Test Wary Stomper', 'Creature — Beast', 'When this creature enters, return up to two lands you control to their owner\'s hand.', ['3', '3']);
  const board = (): GameState => scenario([], { defs: [STOMPER], p1: { hand: ['Test Wary Stomper'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Plains'] } });
  const lands = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.controller === 'p1');
  it('is automated', () => expect(full(STOMPER)).toBe(true));
  it('returns the two lands chosen (and no more than two are accepted)', () => {
    const s0 = board();
    const mine = lands(s0);
    const s = resolveAll(cast(s0, 'Test Wary Stomper'), { objects: mine.slice(0, 2) });
    expect(lands(s).length).toBe(1);
    expect(s.zones.hand['p1']!.filter((id) => s.objects[id]!.defId === 'Plains').length).toBe(2);
  });
  it('negative: up to - it may return none, and an opponent\'s land is never offered', () => {
    const s0 = board();
    const s = resolveAll(cast(s0, 'Test Wary Stomper'), { objects: [] });
    expect(lands(s).length).toBe(3);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.defId === 'Plains').length).toBe(1);
  });
});

describe('CR 400.3: "When ~ enters, put target card from an opponent\'s graveyard on the bottom of their library."', () => {
  const COLOS = card('Test Dune Goat', 'Creature — Goat', 'When this creature enters, put target card from an opponent\'s graveyard on the bottom of their library.', ['2', '2']);
  const board = (): GameState => scenario([], { defs: [COLOS, GUARD], p1: { hand: ['Test Dune Goat'], graveyard: ['Plains'] }, p2: { graveyard: ['Test Elf'] } });
  it('is automated', () => expect(full(COLOS)).toBe(true));
  it('the chosen card goes to the bottom of ITS OWNER\'S (the opponent\'s) library', () => {
    const s0 = board();
    const elf = find(s0, 'Test Elf', 'graveyard', 'p2');
    const s = resolveAll(cast(s0, 'Test Dune Goat', { targets: [{ kind: 'object', id: elf }] }), { targets: [{ kind: 'object', id: elf }] });
    expect(s.zones.graveyard['p2']!.length).toBe(0);
    const lib = s.zones.library['p2']!;
    expect(s.objects[lib[lib.length - 1]!]!.defId).toBe('Test Elf');
  });
  it('negative: your own graveyard card is not a legal target (only the opponent\'s card is offered)', () => {
    const s0 = board();
    const own = find(s0, 'Plains', 'graveyard', 'p1');
    let s = cast(s0, 'Test Dune Goat');
    for (let g = 0; g < 6 && s.pending?.kind === 'priority'; g++) s = pass(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    const opts = JSON.stringify(s.pending);
    expect(opts.includes(own)).toBe(false);
    expect(opts.includes(find(s0, 'Test Elf', 'graveyard', 'p2'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------------------------------------------
describe('CR 725.1, 508.1b: "~ can\'t attack unless defending player is the monarch."', () => {
  const HIRELING = card('Test Crown Thief', 'Creature — Human', 'This creature can\'t attack unless defending player is the monarch.', ['3', '3']);
  /** 'attacked' when the declaration was accepted; 'illegal' when the attack was refused; 'no-decision' when the creature could not attack at all (no declaration is offered). */
  const attackResult = (monarch: string | null): 'attacked' | 'illegal' | 'no-decision' => {
    let s = tweak(scenario([], { defs: [HIRELING], p1: { battlefield: ['Test Crown Thief'] } }), (t) => { if (monarch !== null) t.designations.monarch = monarch; });
    for (let g = 0; g < 40; g++) {
      if (s.pending?.kind === 'declareAttackers') {
        const id = find(s, 'Test Crown Thief', 'battlefield', 'p1');
        const r = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: id, defender: 'p2' }] } });
        return r.error ? 'illegal' : 'attacked';
      }
      if (s.turn.step === 'endCombat') return 'no-decision';
      s = act(s, { type: 'pass', player: s.pending!.player });
    }
    throw new Error('stuck');
  };
  it('is automated', () => expect(full(HIRELING)).toBe(true));
  it('may attack the player who is the monarch', () => expect(attackResult('p2')).toBe('attacked'));
  it('may attack a planeswalker controlled by the monarch (its defending player is its controller, CR 506.2), but not one controlled by a player who is not the monarch (ruling 2016-08-23)', () => {
    const WALKER = compileCard({ name: 'Test Crown Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Test', oracle_text: '+1: You gain 1 life.', colors: [], loyalty: '3' } as OracleCard);
    const tryWalker = (monarch: string): 'attacked' | 'illegal' | 'no-decision' => {
      let s = tweak(scenario([], { defs: [HIRELING, WALKER], p1: { battlefield: ['Test Crown Thief'] }, p2: { battlefield: [{ name: 'Test Crown Walker', counters: { loyalty: 3 } }] } }), (t) => { t.designations.monarch = monarch; });
      const pw = find(s, 'Test Crown Walker', 'battlefield', 'p2');
      for (let g = 0; g < 40; g++) {
        if (s.pending?.kind === 'declareAttackers') {
          const id = find(s, 'Test Crown Thief', 'battlefield', 'p1');
          return applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: id, defender: pw }] } }).error ? 'illegal' : 'attacked';
        }
        if (s.turn.step === 'endCombat') return 'no-decision';
        s = act(s, { type: 'pass', player: s.pending!.player });
      }
      throw new Error('stuck');
    };
    expect(tryWalker('p2')).toBe('attacked');
    expect(tryWalker('p1')).not.toBe('attacked');
  });
  it('negative: cannot attack when its controller is the monarch, or when nobody is', () => {
    expect(attackResult('p1')).not.toBe('attacked');
    expect(attackResult(null)).not.toBe('attacked');
  });
});

describe('CR 509.1a, 509.1b: "As long as ~ is a creature, it can block an additional creature each combat."', () => {
  const TOTEM = card('Test War Totem', 'Artifact Creature — Construct', 'As long as this artifact is a creature, it can block an additional creature each combat.', ['2', '4']);
  const PLAIN = card('Test Plain Totem', 'Artifact Creature — Construct', '', ['2', '4']);
  const RAIDER = card('Test Raider', 'Creature — Human', '', ['1', '1']);
  const blockTwo = (blockerName: string): string | undefined => {
    const s0 = tweak(scenario([], { defs: [TOTEM, PLAIN, RAIDER], p1: { battlefield: ['Test Raider', { name: 'Test Raider' }] }, p2: { battlefield: [blockerName] } }), () => undefined);
    const raiders = named(s0, 'Test Raider');
    const s = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), raiders.map((r) => [r] as [ObjectId])));
    const blocker = find(s, blockerName, 'battlefield', 'p2');
    return applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: raiders.map((attacker) => ({ blocker, attacker })) } }).error?.message;
  };
  it('is automated', () => expect(full(TOTEM)).toBe(true));
  it('blocks two attackers while it is a creature', () => expect(blockTwo('Test War Totem')).toBeUndefined());
  it('negative: the same body without the ability cannot block two attackers', () => expect(blockTwo('Test Plain Totem')).toBeDefined());
});
