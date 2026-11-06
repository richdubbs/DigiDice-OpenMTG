/**
 * Commander lane edh-c, round edh-c-60 (EDHREC ranks 17,501-18,000): the round's readings played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against
 * the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 609.7a, 615.1, 615.7, 506.4   "The next time an unblocked creature of your choice would deal combat damage to you this turn, prevent all but 1 of that damage." (Forcefield)
 *   CR 609.7a, 614.9, 615.7          "The next time a source of your choice would deal damage this turn, that damage is dealt to ~ instead." (Opal-Eye, Konda's Yojimbo)
 *   CR 614.9, 506.4, 510.2           "All combat damage that would be dealt to you this turn by target unblocked creature is dealt to its controller instead." (Mirror Strike)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, reject } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;

/** Answer the decisions that come up until priority (payments automatic; other choices the first allowed, or `yes`). */
function drive(s0: GameState, o: { targets?: (ObjectId | PlayerId)[]; yes?: boolean; option?: string } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.splice(0, 1).map((id) => (id.startsWith('p') && !id.startsWith('o') ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) } as never);
    else if (p.kind === 'chooseOption') {
      const pick = o.option !== undefined ? p.options.filter((x) => x.label === o.option || x.id === o.option) : p.options.slice(0, p.min);
      s = answer(s, { kind: 'chooseOption', ids: pick.map((x) => x.id) });
    }
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (o.option ?? p.options[0]) as never });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let i = 0; i < 24 && s.zones.stack.length > 0; i++) s = drive(pass(s), o);
  return s;
}
const castBy = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never);
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}, player: PlayerId = 'p1'): GameState => resolveAll(drive(castBy(s, name, player), o), o);
const activate = (s: GameState, source: ObjectId, ability: string, o: Parameters<typeof drive>[1] = {}, player: PlayerId = 'p1'): GameState =>
  resolveAll(drive(act(s, { type: 'activate', player, source, ability } as never), o), o);
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const onBf = (s: GameState, name: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name && (p === undefined || s.objects[id]!.controller === p));
const inGy = (s: GameState, name: string): number => Object.values(s.objects).filter((o) => o.zone === 'graveyard' && s.defs[o.defId]?.name === name).length;
const energy = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.counters['energy'] ?? 0;
const stat = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;
const subtypes = (s: GameState, id: ObjectId): string => [...chars(s, id).subtypes].sort().join(' ');

/** Pass priority (answering decisions) until the next declare-attackers decision. */
function toAttackers(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 120 && s.pending?.kind !== 'declareAttackers'; i++) {
    if (s.result) throw new Error('The game ended');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  expect(s.pending?.kind).toBe('declareAttackers');
  return s;
}
const declareAction = (s: GameState, attacks: [ObjectId, PlayerId][]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: attacks.map(([attacker, defender]) => ({ attacker, defender })) } });
const declare = (s: GameState, attacks: [ObjectId, PlayerId][]): GameState => act(s, declareAction(s, attacks) as never);
function toBlockers(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 80 && s.pending?.kind !== 'declareBlockers'; i++) {
    if (s.turn.step === 'main2') throw new Error('No declare blockers decision came');
    s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  return s;
}
/** Pass until `done`, declaring no blocks and no attackers when asked. */
function runUntil(s0: GameState, done: (s: GameState) => boolean, what: string, max = 400): GameState {
  let s = s0;
  for (let i = 0; i < max; i++) {
    if (done(s)) return s;
    if (s.result) throw new Error(`The game ended while waiting for ${what}`);
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
  }
  throw new Error(`Never reached ${what}`);
}

const FORCE = card('Test Forcefield', 'Artifact', '{0}: The next time an unblocked creature of your choice would deal combat damage to you this turn, prevent all but 1 of that damage.');
const MIRROR = card('Test Mirror Strike', 'Instant', 'All combat damage that would be dealt to you this turn by target unblocked creature is dealt to its controller instead.');
const YOJIMBO = card('Test Yojimbo', 'Creature — Fox Samurai', '{0}: The next time a source of your choice would deal damage this turn, that damage is dealt to this creature instead.', { pt: ['1', '6'] });
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['3', '3'], colors: ['G'] });
const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', { pt: ['4', '4'], colors: ['R'] });
const WALL = card('Test Plain Wall', 'Creature — Wall', '', { pt: ['0', '5'], colors: ['W'] });
const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to any target.');
const SILENCE = card('Test Silence', 'Instant', 'Target player skips their next combat phase this turn.');
const DOV = card('Test Dovin', 'Legendary Planeswalker — Dovin', '-1: Tap all permanents target opponent controls. That player skips their next untap step.', { loyalty: '4' });
const ART = card('Test Artisan', 'Legendary Planeswalker — Nissa', '-1: Reveal the top two cards of your library. Put all land cards from among them onto the battlefield and the rest into your hand.', { loyalty: '4' });
const BATHE = card('Test Bathe', 'Instant', 'Choose a color. Target creature and each other creature that shares a color with it gain protection from the chosen color until end of turn.', { colors: ['W'] });
const RITES = card('Test Rites', 'Sorcery', 'Discard any number of cards. Search your library for up to that many basic land cards, reveal them, put them into your hand, then shuffle.');
const REVENGE = card('Test Revenge', 'Creature — Elemental', "This creature can't be the target of nongreen spells or abilities from nongreen sources.", { pt: ['5', '5'], colors: ['G'] });
const GREENBOLT = card('Test Green Bolt', 'Instant', '~ deals 1 damage to any target.', { colors: ['G'] });
const ZAP = card('Test Zapper', 'Creature — Goblin', '{0}: This creature deals 1 damage to target creature.', { pt: ['1', '1'], colors: ['R'] });
const GREENZAP = card('Test Green Zapper', 'Creature — Elf', '{0}: This creature deals 1 damage to target creature.', { pt: ['1', '1'], colors: ['G'] });
const RED = card('Test Plain Redcap', 'Creature — Goblin', '', { pt: ['2', '2'], colors: ['R'] });
const GREENBEAR = card('Test Plain Greenbear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G'] });
const BEAR_GW = card('Test Plain Gwbear', 'Creature — Bear', '', { pt: ['2', '2'], colors: ['G', 'W'] });
const COLORLESS = card('Test Plain Golem', 'Artifact Creature — Golem', '', { pt: ['2', '2'] });

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [FORCE, MIRROR, YOJIMBO, BEAR, OGRE, WALL, BOLT, SILENCE, DOV, ART, BATHE, RITES, REVENGE, GREENBOLT, ZAP, GREENZAP, RED, GREENBEAR, BEAR_GW, COLORLESS]) expect(noManual(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('every real card of the round plays fully', async () => {
    const { compiledDefs } = await import('../../fixtures');
    for (const d of compiledDefs(['Forcefield', 'Mirror Strike', "Opal-Eye, Konda's Yojimbo", 'Dovin, Architect of Law', 'Moment of Silence', "Nissa, Nature's Artisan", 'Bathe in Light', 'Rites of Spring', "Gaea's Revenge"])) {
      expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
      expect(noManual(d), d.name).toBe(true);
    }
  });
});

/** p1 attacks p2 with the given creatures; p2 (the defender) gets priority in the declare blockers step after `blocks`. */
function afterBlocks(defs: CardDef[], p1: string[], p2: string[], blocks: [string, string][] = [], hand2: string[] = [], hand1: string[] = []): GameState {
  const s0 = mpScenario({ players: 3, defs, zones: { p1: { hand: hand1, battlefield: p1.map((name) => ({ name, since: -1 })) }, p2: { hand: hand2, battlefield: p2.map((name) => ({ name, since: -1 })) } } });
  let s = declare(toAttackers(s0), p1.filter((n) => n.startsWith('Test Plain')).map((n) => [onBf(s0, n)[0]!, 'p2'] as [ObjectId, PlayerId]));
  s = toBlockers(s);
  return answer(s, { kind: 'declareBlockers', blocks: blocks.map(([blocker, attacker]) => ({ blocker: onBf(s0, blocker)[0]!, attacker: onBf(s0, attacker)[0]! })) });
}
/** Pass priority until `p` may act in the declare blockers step. */
const toPriority = (s0: GameState, p: PlayerId): GameState => {
  let s = s0;
  for (let i = 0; i < 6 && !(s.pending?.kind === 'priority' && s.pending.player === p); i++) s = pass(s);
  return s;
};
/** Choose `id` for the pending chooseObjects decision. */
const pick = (s: GameState, id: ObjectId): GameState => {
  expect(s.pending?.kind).toBe('chooseObjects');
  return answer(s, { kind: 'chooseObjects', ids: [id] });
};

describe('CR 609.7a, 615.1, 615.7, 506.4: "The next time an unblocked creature of your choice would deal combat damage to you this turn, prevent all but 1 of that damage." (Forcefield)', () => {
  const run = (blocks: [string, string][] = []) => {
    let s = toPriority(afterBlocks([FORCE, BEAR, OGRE, WALL, BOLT], ['Test Plain Bear', 'Test Plain Ogre'], ['Test Forcefield', 'Test Plain Wall'], blocks, [], ['Test Bolt']), 'p2');
    s = act(s, { type: 'activate', player: 'p2', source: onBf(s, 'Test Forcefield')[0]!, ability: 'p:0:0' } as never);
    for (let i = 0; i < 4 && s.pending?.kind !== 'chooseObjects' && s.zones.stack.length > 0; i++) s = pass(s); // the ability resolves: its controller chooses the creature
    return s;
  };
  it('the chosen unblocked attacker deals only 1; the other unblocked attacker still deals its full damage (the shield is used once)', () => {
    let s = run();
    const ogre = onBf(s, 'Test Plain Ogre')[0]!;
    s = pick(s, ogre);
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(life(s, 'p2')).toBe(20 - 1 - 3); // the Ogre (4) is cut to 1, the Bear (3) hits in full
  });
  it('negative: a blocked attacker is not offered: with the Bear blocked, the Ogre is the only choice (made for Bob) and the blocked Bear deals nothing to the player', () => {
    const s = runUntil(run([['Test Plain Wall', 'Test Plain Bear']]), (x) => x.turn.step === 'main2', 'the second main phase');
    expect(s.log.some((l) => l.text === 'Bob chooses Test Plain Ogre.')).toBe(true);
    expect(life(s, 'p2')).toBe(19); // the Ogre (4) is cut to 1; the Bear was blocked
  });
  it('negative: the shield is for combat damage to you only: a noncombat 3 damage from the chosen creature type of source is not reduced', () => {
    let s = run();
    const ogre = onBf(s, 'Test Plain Ogre')[0]!;
    s = pick(s, ogre);
    s = resolveAll(castBy(toPriority(s, 'p1'), 'Test Bolt', 'p1'), { targets: ['p2'] });
    expect(life(s, 'p2')).toBe(17); // 3 noncombat damage in full (no combat damage has been dealt yet)
  });
});

describe('CR 609.7a, 614.9, 615.7: "The next time a source of your choice would deal damage this turn, that damage is dealt to this creature instead." (Opal-Eye, Konda\'s Yojimbo)', () => {
  const run = () => {
    let s = toPriority(afterBlocks([YOJIMBO, BEAR, OGRE, WALL, BOLT], ['Test Plain Bear', 'Test Plain Ogre'], ['Test Yojimbo'], [], [], ['Test Bolt']), 'p2');
    s = act(s, { type: 'activate', player: 'p2', source: onBf(s, 'Test Yojimbo')[0]!, ability: 'p:0:0' } as never);
    for (let i = 0; i < 4 && s.pending?.kind !== 'chooseObjects' && s.zones.stack.length > 0; i++) s = pass(s);
    return s;
  };
  it('the chosen source\'s damage goes to the creature instead; the other attacker still hits the player (used once)', () => {
    let s = pick(run(), onBf(run(), 'Test Plain Ogre')[0]!);
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(life(s, 'p2')).toBe(17); // only the Bear (3)
    expect(s.objects[onBf(s, 'Test Yojimbo')[0]!]!.damage).toBe(4); // the Ogre's damage
  });
  it('negative: the shield was used up by the Ogre damage: a later 3 damage from another source goes to its own target', () => {
    let s = pick(run(), onBf(run(), 'Test Plain Ogre')[0]!);
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    s = resolveAll(castBy(toPriority(s, 'p1'), 'Test Bolt', 'p1'), { targets: ['p2'] }); // another source
    expect(life(s, 'p2')).toBe(14);
  });
});

describe('CR 614.9, 506.4, 510.2: "All combat damage that would be dealt to you this turn by target unblocked creature is dealt to its controller instead." (Mirror Strike)', () => {
  const run = (blocks: [string, string][] = []) => {
    const s0 = toPriority(afterBlocks([MIRROR, BEAR, OGRE, WALL], ['Test Plain Bear', 'Test Plain Ogre'], ['Test Plain Wall'], blocks, ['Test Mirror Strike']), 'p2');
    return s0;
  };
  it('the targeted unblocked attacker deals its combat damage to its controller; the other attacker hits normally', () => {
    const s0 = run();
    const ogre = onBf(s0, 'Test Plain Ogre')[0]!;
    let s = resolveAll(castBy(s0, 'Test Mirror Strike', 'p2'), { targets: [ogre] });
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(life(s, 'p1')).toBe(16); // the Ogre's 4 to Alice
    expect(life(s, 'p2')).toBe(17); // the Bear's 3 to Bob
  });
  it('negative: a blocked attacker is no legal target (the answer is refused)', () => {
    const s0 = castBy(run([['Test Plain Wall', 'Test Plain Bear']]), 'Test Mirror Strike', 'p2');
    expect(s0.pending?.kind).toBe('chooseTargets');
    reject(s0, { type: 'answer', player: 'p2', decisionId: s0.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: onBf(s0, 'Test Plain Bear')[0]! }] } } as never);
  });
});

describe('CR 614.10, 500.11, 506.1: "Target player skips their next combat phase this turn." (Moment of Silence)', () => {
  /** Plays the turn on, answering nothing (no attackers), and reports whether a declare attackers decision came for Alice before the second main phase. */
  function sawAttackDecision(s0: GameState): boolean {
    let s = s0;
    for (let i = 0; i < 200 && s.turn.step !== 'main2' && s.turn.number === s0.turn.number; i++) {
      if (s.pending?.kind === 'declareAttackers') return true;
      s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    }
    return false;
  }
  const game = () => mpScenario({ players: 3, defs: [SILENCE, BEAR], zones: { p1: { hand: ['Test Silence'], battlefield: [{ name: 'Test Plain Bear', since: -1 }] } } });
  it('cast on the active player in the first main phase, they get no combat phase this turn', () => {
    const s = cast(game(), 'Test Silence', { targets: ['p1'] });
    expect(sawAttackDecision(s)).toBe(false);
  });
  it('negative: without it Alice does get the declare attackers decision', () => {
    expect(sawAttackDecision(game())).toBe(true);
  });
  it('negative (ruling 2004-10-04): cast on another player during Alices turn, Alices combat still happens', () => {
    const s = cast(game(), 'Test Silence', { targets: ['p2'] });
    expect(sawAttackDecision(s)).toBe(true);
  });
});

describe('CR 614.10, 502.1: "Tap all permanents target opponent controls. That player skips their next untap step." (Dovin, Architect of Law)', () => {
  const game = () => mpScenario({ players: 3, defs: [DOV, BEAR, OGRE], zones: { p1: { hand: [], battlefield: [{ name: 'Test Dovin', counters: { loyalty: 4 } }] }, p2: { battlefield: [{ name: 'Test Plain Bear', since: -1 }, { name: 'Test Plain Ogre', since: -1 }] } } });
  it('their permanents are tapped and stay tapped through their next untap step, but untap in the one after', () => {
    const s0 = game();
    let s = activate(s0, onBf(s0, 'Test Dovin')[0]!, 'p:0:0', { targets: ['p2'] });
    const bear = onBf(s, 'Test Plain Bear')[0]!;
    expect(s.objects[bear]!.tapped).toBe(true);
    s = runUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1', 'the second turn'); // Bob's turn: the untap step is skipped
    expect(s.objects[onBf(s, 'Test Plain Bear')[0]!]!.tapped).toBe(true);
    s = runUntil(s, (x) => x.turn.number === 5 && x.turn.step === 'main1', 'Bobs next turn');
    expect(s.objects[onBf(s, 'Test Plain Bear')[0]!]!.tapped).toBe(false);
  });
});

describe('CR 701.20e, 608.2c, 110.2a: "Put all land cards from among them onto the battlefield and the rest into your hand." (Nissa, Nature\'s Artisan)', () => {
  it('the lands of the two revealed cards come onto the battlefield, the other card goes to the hand', () => {
    const s0 = mpScenario({ players: 3, defs: [ART, BEAR], zones: { p1: { battlefield: [{ name: 'Test Artisan', counters: { loyalty: 4 } }], library: ['Plains', 'Test Plain Bear', 'Plains'] } } }); // the first card is drawn for the turn; Nissa reveals the next two
    const s = activate(s0, onBf(s0, 'Test Artisan')[0]!, 'p:0:0');
    const plains = onBf(s, 'Plains', 'p1').length;
    const bears = Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1' && s.defs[o.defId]!.name === 'Test Plain Bear').length;
    expect(plains).toBe(1);
    expect(bears).toBe(1); // the creature among the revealed cards went to the hand
    expect(hand(s, 'p1')).toBe(hand(s0, 'p1') + 1); // only the creature
  });
});

describe('CR 105.1, 608.2c, 611.2c: "Target creature and each other creature that shares a color with it gain protection from the chosen color until end of turn." (Bathe in Light)', () => {
  const game = (target: string) => mpScenario({ players: 3, defs: [BATHE, GREENBEAR, BEAR_GW, RED, COLORLESS], zones: { p1: { hand: ['Test Bathe'], battlefield: ['Test Plain Greenbear', 'Test Plain Gwbear', 'Test Plain Redcap', 'Test Plain Golem'] } }, });
  const pro = (s: GameState, name: string): boolean => JSON.stringify(chars(s, onBf(s, name)[0]!).keywords).includes('color:R');
  it('the green target and every other creature sharing a color with it (the green-white one, even if not yours) get protection from red; the red one does not', () => {
    const s0 = game('Test Plain Greenbear');
    const s = cast(s0, 'Test Bathe', { targets: [onBf(s0, 'Test Plain Greenbear')[0]!], option: 'R' });
    expect(pro(s, 'Test Plain Greenbear')).toBe(true);
    expect(pro(s, 'Test Plain Gwbear')).toBe(true);
    expect(pro(s, 'Test Plain Redcap')).toBe(false);
    expect(pro(s, 'Test Plain Golem')).toBe(false);
  });
  it('ruling 2005-10-01: a colorless target shares a color with nothing: only it gains protection', () => {
    const s0 = game('Test Plain Golem');
    const s = cast(s0, 'Test Bathe', { targets: [onBf(s0, 'Test Plain Golem')[0]!], option: 'R' });
    expect(pro(s, 'Test Plain Golem')).toBe(true);
    expect(pro(s, 'Test Plain Greenbear')).toBe(false);
  });
});

describe('CR 701.9a, 701.23, 608.2c: "Discard any number of cards. Search your library for up to that many basic land cards, reveal them, put them into your hand, then shuffle." (Rites of Spring)', () => {
  it('negative: with nothing to discard (the spell is the only card) nothing is found: no land leaves the library', () => {
    const s0 = mpScenario({ players: 3, defs: [RITES], zones: { p1: { hand: ['Test Rites'] } } });
    const plains = (s: GameState): number => s.zones.hand['p1']!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Plains').length;
    const s = cast(s0, 'Test Rites');
    expect(plains(s)).toBe(plains(s0));
  });
  it('discarding two cards finds two basic lands into the hand', () => {
    const s0 = mpScenario({ players: 3, defs: [RITES, BEAR], zones: { p1: { hand: ['Test Rites', 'Test Plain Bear', 'Test Plain Bear'] } } });
    const s = cast(s0, 'Test Rites');
    expect(Object.values(s.objects).filter((o) => o.zone === 'graveyard' && o.owner === 'p1' && s.defs[o.defId]!.name === 'Test Plain Bear').length).toBe(2);
    expect(Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === 'p1' && s.defs[o.defId]!.name === 'Plains').length).toBe(1 + 2); // the Plains drawn for the turn and the two found
  });
});

describe('CR 115.1, 113.7a, 101.2: "This creature can\'t be the target of nongreen spells or abilities from nongreen sources." (Gaea\'s Revenge)', () => {
  const game = () => mpScenario({ players: 3, defs: [REVENGE, BOLT, GREENBOLT, ZAP, GREENZAP], zones: { p1: { hand: ['Test Bolt', 'Test Green Bolt'], battlefield: [{ name: 'Test Zapper', since: -1 }, { name: 'Test Green Zapper', since: -1 }] }, p2: { battlefield: ['Test Revenge'] } } });
  const refuses = (s0: GameState): unknown => reject(s0, { type: 'answer', player: 'p1', decisionId: s0.pending!.id, answer: { kind: 'chooseTargets', targets: [{ kind: 'object', id: onBf(s0, 'Test Revenge')[0]! }] } } as never);
  it('a red spell cannot target it', () => { const s0 = castBy(game(), 'Test Bolt'); expect(s0.pending?.kind).toBe('chooseTargets'); refuses(s0); });
  it('an ability of a red creature cannot target it', () => {
    const g = game();
    const s0 = act(g, { type: 'activate', player: 'p1', source: onBf(g, 'Test Zapper')[0]!, ability: 'p:0:0' } as never);
    expect(s0.pending?.kind).toBe('chooseTargets');
    refuses(s0);
  });
  it('negative: a green spell and an ability of a green creature can target it', () => {
    const g = game();
    const s1 = cast(g, 'Test Green Bolt', { targets: [onBf(g, 'Test Revenge')[0]!] });
    expect(s1.objects[onBf(s1, 'Test Revenge')[0]!]!.damage).toBe(1);
    const s2 = activate(g, onBf(g, 'Test Green Zapper')[0]!, 'p:0:0', { targets: [onBf(g, 'Test Revenge')[0]!] });
    expect(s2.objects[onBf(s2, 'Test Revenge')[0]!]!.damage).toBe(1);
  });
});

describe('CR 509.1h, 506.4 (Forcefield ruling 2004-10-04): no attacker is unblocked before blockers are declared', () => {
  const declareStep = (defs: CardDef[], p2: string[], hand2: string[]): GameState => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { battlefield: [{ name: 'Test Plain Ogre', since: -1 }] }, p2: { hand: hand2, battlefield: p2.map((name) => ({ name, since: -1 })) } } });
    return toPriority(declare(toAttackers(s0), [[onBf(s0, 'Test Plain Ogre')[0]!, 'p2']]), 'p2');
  };
  it('Forcefield activated in the declare attackers step has no creature to choose: nothing is prevented later', () => {
    let s = declareStep([FORCE, OGRE], ['Test Forcefield'], []);
    expect(s.turn.step).toBe('declareAttackers');
    s = act(s, { type: 'activate', player: 'p2', source: onBf(s, 'Test Forcefield')[0]!, ability: 'p:0:0' } as never);
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = pass(s);
    s = runUntil(s, (x) => x.turn.step === 'main2', 'the second main phase');
    expect(life(s, 'p2')).toBe(16); // the Ogre's 4 in full
  });
  it('Mirror Strike cast in the declare attackers step has no legal target', () => {
    const s = declareStep([MIRROR, OGRE], [], ['Test Mirror Strike']);
    expect(s.turn.step).toBe('declareAttackers');
    expect(() => castBy(s, 'Test Mirror Strike', 'p2')).toThrow(/no legal one/); // no attacker is unblocked yet
  });
});
