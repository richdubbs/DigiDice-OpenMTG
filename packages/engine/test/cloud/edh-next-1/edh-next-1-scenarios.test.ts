/**
 * Commander lane edh-next, round edh-next-1: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler, in
 * 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com).
 *
 *   CR 111.2, 608.2d, 603.2           "Whenever a Slug deals combat damage to a player, its controller may create a 1/1 colorless Slug creature token."
 *   CR 111.2, 508.4, 608.2d           "Whenever a Samurai attacks, you may have its controller create a 1/1 white Samurai creature token that's tapped and attacking."
 *   CR 701.20a, 608.2c                "Reveal the top four cards of your library. Put a land card from among them onto the battlefield and the rest into your graveyard."
 *   CR 303.4, 205.1a, 613.1f          "Enchanted creature loses all abilities and is a Goat creature with base power and toughness 0/1."
 *   CR 205.4a, 613.4c, 613.1f         "Enchanted creature is legendary, gets +2/+2, and has trample and haste."
 *   CR 613.4c, 301.5                  "Equipped creature has first strike and gets +1/+0 for each instant and sorcery card in your graveyard."
 *   CR 504.1, 121.1, 701.9a           "At the beginning of each player's draw step, that player draws an additional card, then discards a card."
 *   CR 701.9a, 608.2h                 "At the beginning of your upkeep, target opponent discards a card for each Shrine you control."
 *   CR 102.3, 608.2h, 603.10a         "Whenever a creature with a bounty counter on it dies, each of its controller's opponents draws a card and gains 2 life."
 *   CR 301.5, 604.1                   "Equipped creature has double strike as long as two or more Equipment are attached to it."
 *   CR 614.1c, 122.6                  "~ enters tapped and with three coin counters on it."
 *   CR 601.2f, 611.3a                 "Noncreature spells you cast cost {1} less to cast as long as there are three or more Lesson cards in your graveyard."
 *   CR 509.1b, 611.3a                 "As long as you have the city's blessing, Detectives you control can't be blocked."
 *   CR 101.4, 608.2d, 110.2a          "Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield."
 *   CR 608.2d, 110.2a                 "At the beginning of each player's upkeep, that player may put an artifact, creature, or land card from their hand onto the battlefield."
 */
import { describe, expect, it } from 'vitest';
import { getChars, hasKeyword, legalActions, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil, reject } from '../../m12/rules/helpers';
import { card, full, pt, tokens } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId);
const yard = (s: GameState, p: PlayerId): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const bf = (s: GameState, defId: string, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && (p === undefined || s.objects[id]!.controller === p));

interface Script {
  targets?: ObjectId[];
  playerTargets?: PlayerId[];
  yes?: boolean | ((prompt: string, who: PlayerId) => boolean);
  objects?: (options: ObjectId[], prompt: string, state: GameState, who: PlayerId) => ObjectId[];
  numbers?: number[];
  /** Keeps passing priority (and declares no blockers) until this holds, as well as emptying the stack. */
  until?: (state: GameState) => boolean;
}
/** Answers whatever is asked, from the script, and passes priority until the stack is empty (or `until` holds). */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const targets = [...(sc.targets ?? [])];
  const players = [...(sc.playerTargets ?? [])];
  const numbers = [...(sc.numbers ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    let a: DecisionAnswer | undefined;
    const d = p as unknown as { min?: number; max?: number; prompt: string; player: PlayerId };
    if (p.kind === 'chooseTargets') {
      const t = p as unknown as { objects?: ObjectId[]; min?: number };
      a = { kind: 'chooseTargets', targets: targets.length > 0 ? [{ kind: 'object', id: targets.shift()! }] : players.length > 0 ? [{ kind: 'player', id: players.shift()! }] : (t.objects ?? []).slice(0, t.min ?? 0).map((id) => ({ kind: 'object' as const, id })) } as DecisionAnswer;
    } else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: typeof sc.yes === 'function' ? sc.yes(d.prompt, d.player) : sc.yes ?? true };
    else if (p.kind === 'chooseObjects') {
      const o = (p as unknown as { options: ObjectId[] }).options;
      a = { kind: 'chooseObjects', ids: sc.objects !== undefined ? sc.objects(o, d.prompt, s, d.player) : o.slice(0, d.min ?? 0) };
    } else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p as unknown as { options: { id: string }[] }).options[0]!.id] };
    else if (p.kind === 'chooseNumber') a = { kind: 'chooseNumber', n: numbers.shift() ?? d.min ?? 0 } as DecisionAnswer;
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'declareBlockers') a = { kind: 'declareBlockers', blocks: [] };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0 && (sc.until === undefined || sc.until(s))) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
/** Passes priority to the main phase of the given turn's active player. */
const toMain = (s: GameState, player: PlayerId): GameState => passUntil(s, (x) => x.turn.activePlayer === player && x.turn.step === 'main1' && x.pending?.kind === 'priority', `${player}'s main phase`);
const attack = (s: GameState, id: ObjectId, defender: PlayerId): GameState => declareAttackers(toDeclareAttackers(s), [[id, defender]]);
const afterDamage = (s: GameState): boolean => s.turn.step === 'endCombat' || s.turn.step === 'main2';

describe('CR 111.2, 608.2d, 603.2: "Whenever a Slug deals combat damage to a player, its controller may create a 1/1 colorless Slug creature token."', () => {
  const HIVE = card('Test Hive Slug', 'Creature — Slug', 'Whenever a Slug deals combat damage to a player, its controller may create a 1/1 colorless Slug creature token.', ['1', '1']);
  const PLAIN = card('Test Plain Slug', 'Creature — Slug', '', ['2', '2']);
  const defs = [HIVE, PLAIN];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Hive Slug'] }, p2: { battlefield: ['Test Plain Slug'] } } });
  const opponentAttacks = (yes: boolean): GameState => {
    let s = toMain(start(), 'p2');
    s = attack(s, mfind(s, 'Test Plain Slug', 'battlefield', 'p2'), 'p3');
    return run(s, { yes, until: afterDamage });
  };
  it('is automated', () => expect(full(HIVE)).toBe(true));
  it('CR 111.2: the creature\'s CONTROLLER creates the token (p2\'s Slug hit p3), never the source\'s controller p1 or the player who was damaged', () => {
    const s = opponentAttacks(true);
    expect(tokens(s, 'p2')).toHaveLength(1);
    expect(tokens(s, 'p1')).toHaveLength(0);
    expect(tokens(s, 'p3')).toHaveLength(0);
  });
  it('negative (CR 608.2d): "may": the controller declines, no token', () => {
    const s = opponentAttacks(false);
    expect(tokens(s, 'p2')).toHaveLength(0);
  });
  it('the controller of the source itself attacking also creates it for itself', () => {
    let s = attack(start(), mfind(start(), 'Test Hive Slug', 'battlefield', 'p1'), 'p2');
    s = run(s, { yes: true, until: afterDamage });
    expect(tokens(s, 'p1')).toHaveLength(1);
  });
});

describe('CR 111.2, 508.4, 608.2d: "Whenever a Samurai attacks, you may have its controller create a 1/1 white Samurai creature token that\'s tapped and attacking."', () => {
  const BANNER = card('Test Rally Banner', 'Creature — Samurai', "Whenever a Samurai attacks, you may have its controller create a 1/1 white Samurai creature token that's tapped and attacking.", ['1', '1']);
  const PLAIN = card('Test Plain Samurai', 'Creature — Samurai', '', ['2', '2']);
  const defs = [BANNER, PLAIN];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Rally Banner'] }, p2: { battlefield: ['Test Plain Samurai'] } } });
  it('is automated', () => expect(full(BANNER)).toBe(true));
  it('CR 111.2, 508.4: the attacking Samurai\'s CONTROLLER (p2) gets the token, tapped and attacking; p1 (whose ability it is) gets nothing', () => {
    let s = toMain(start(), 'p2');
    s = run(attack(s, mfind(s, 'Test Plain Samurai', 'battlefield', 'p2'), 'p3'), { yes: true });
    expect(tokens(s, 'p2')).toHaveLength(1);
    expect(tokens(s, 'p1')).toHaveLength(0);
    const t = tokens(s, 'p2')[0]!;
    expect(s.objects[t]!.tapped).toBe(true);
    expect(s.combat!.attackers.map((a) => a.id)).toContain(t);
  });
  it('negative (CR 608.2d): the ability\'s controller (p1) may decline: no token', () => {
    let s = toMain(start(), 'p2');
    s = run(attack(s, mfind(s, 'Test Plain Samurai', 'battlefield', 'p2'), 'p3'), { yes: false });
    expect(tokens(s, 'p2')).toHaveLength(0);
  });
  it('the question is asked of p1, who controls the ability, not of the attacking player', () => {
    let s = toMain(start(), 'p2');
    s = attack(s, mfind(s, 'Test Plain Samurai', 'battlefield', 'p2'), 'p3');
    const asked: PlayerId[] = [];
    run(s, { yes: (_p, who) => { asked.push(who); return true; } });
    expect(asked).toEqual(['p1']);
  });
  it('CR 508.4 (ruling 2020-11-10): the token\'s controller (p2) chooses which player it attacks, and it was never declared as an attacker', () => {
    let s = toMain(start(), 'p2');
    s = attack(s, mfind(s, 'Test Plain Samurai', 'battlefield', 'p2'), 'p3');
    // p1 answers "yes"; then p2 (not p1) is asked what the token attacks
    while (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = mpass(s);
    s = manswer(s, { kind: 'yesNo', yes: true });
    expect(s.pending!.kind).toBe('chooseOption');
    expect(s.pending!.player).toBe('p2');
    s = manswer(s, { kind: 'chooseOption', ids: ['p4'] });
    const t = tokens(s, 'p2')[0]!;
    expect(s.combat!.attackers.find((a) => a.id === t)!.defendingPlayer).toBe('p4');
  });
});

describe('CR 701.20a, 608.2c: "Reveal the top four cards of your library. Put a land card from among them onto the battlefield and the rest into your graveyard."', () => {
  const RITE = card('Test Dig Rite', 'Sorcery', 'Reveal the top four cards of your library. Put a land card from among them onto the battlefield and the rest into your graveyard.');
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [RITE, OX];
  const start = (library: string[]): GameState => mpScenario({ defs, zones: { p1: { hand: ['Test Dig Rite'], library: ['Test Pasture Ox', ...library] } } }); // (the first card is p1's draw for the turn: 4 players, the starting player draws, CR 103.8)
  const cast = (s: GameState): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Dig Rite', 'hand', 'p1') }));
  it('is automated', () => expect(full(RITE)).toBe(true));
  it('CR 701.20e: one land of the four goes onto the battlefield (untapped) and the three others go to the graveyard', () => {
    const s = cast(start(['Test Pasture Ox', 'Plains', 'Test Pasture Ox', 'Test Pasture Ox']));
    expect(bf(s, 'Plains', 'p1')).toHaveLength(1);
    expect(s.objects[bf(s, 'Plains', 'p1')[0]!]!.tapped).toBe(false);
    expect(yard(s, 'p1').filter((n) => n === 'Test Pasture Ox')).toHaveLength(3);
  });
  it('negative: with two lands among the four only ONE enters; the other is "the rest" and goes to the graveyard', () => {
    const s = cast(start(['Plains', 'Plains', 'Test Pasture Ox', 'Test Pasture Ox']));
    expect(bf(s, 'Plains', 'p1')).toHaveLength(1);
    expect(yard(s, 'p1').filter((n) => n === 'Plains')).toHaveLength(1);
    expect(yard(s, 'p1').filter((n) => n === 'Test Pasture Ox')).toHaveLength(2);
  });
  it('negative: with no land among them nothing enters and all four go to the graveyard; the fifth card stays in the library', () => {
    const s = cast(start(['Test Pasture Ox', 'Test Pasture Ox', 'Test Pasture Ox', 'Test Pasture Ox']));
    expect(bf(s, 'Plains', 'p1')).toHaveLength(0);
    expect(yard(s, 'p1').filter((n) => n === 'Test Pasture Ox')).toHaveLength(4);
    expect(s.zones.library['p1']!.length).toBeGreaterThan(0);
  });
});

describe('CR 303.4, 205.1a, 613.1f: "Enchanted creature loses all abilities and is a Goat creature with base power and toughness 0/1."', () => {
  const CURSE = card('Test Bog Curse', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature loses all abilities and is a Goat creature with base power and toughness 0/1.');
  const KNIGHT = card('Test Sky Knight', 'Artifact Creature — Knight', 'Flying', ['3', '3']);
  const defs = [CURSE, KNIGHT];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Bog Curse'] }, p2: { battlefield: ['Test Sky Knight', 'Test Sky Knight'] } },
    setup: (s) => { s.objects[mfind(s, 'Test Bog Curse', 'battlefield', 'p1')]!.attachedTo = mfind(s, 'Test Sky Knight', 'battlefield', 'p2'); } });
  it('is automated', () => expect(full(CURSE)).toBe(true));
  it('CR 205.1a: the enchanted creature is only a Goat creature (not an artifact, not a Knight) with base 0/1 and no flying', () => {
    const s = start();
    const [a, b] = bf(s, 'Test Sky Knight', 'p2');
    const enchanted = s.objects[mfind(s, 'Test Bog Curse', 'battlefield', 'p1')]!.attachedTo as ObjectId;
    const other = enchanted === a ? b! : a!;
    const c = getChars(s, enchanted)!;
    expect(c.types).toEqual(['Creature']);
    expect(c.subtypes).toEqual(['Goat']);
    expect(pt(s, enchanted)).toBe('0/1');
    expect(hasKeyword(c, 'flying')).toBe(false);
    // negative: the other Knight is untouched
    expect(pt(s, other)).toBe('3/3');
    expect(getChars(s, other)!.types).toEqual(['Artifact', 'Creature']);
    expect(hasKeyword(getChars(s, other)!, 'flying')).toBe(true);
  });
});

describe('CR 205.4a, 613.4c, 613.1f: "Enchanted creature is legendary, gets +2/+2, and has trample and haste."', () => {
  const WINGS = card('Test Crown Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature is legendary, gets +2/+2, and has trample and haste.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [WINGS, BEAR];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Crown Aura', 'Test Plain Bear'] }, p2: { battlefield: ['Test Plain Bear'] } },
    setup: (s) => { s.objects[mfind(s, 'Test Crown Aura', 'battlefield', 'p1')]!.attachedTo = mfind(s, 'Test Plain Bear', 'battlefield', 'p1'); } });
  it('is automated', () => expect(full(WINGS)).toBe(true));
  it('the enchanted creature is legendary, 4/4 with trample and haste; other creatures (here p2\'s Bear) are not', () => {
    const s = start();
    const mine = mfind(s, 'Test Plain Bear', 'battlefield', 'p1');
    const theirs = mfind(s, 'Test Plain Bear', 'battlefield', 'p2');
    const c = getChars(s, mine)!;
    expect(c.supertypes).toContain('Legendary');
    expect(pt(s, mine)).toBe('4/4');
    expect(hasKeyword(c, 'trample') && hasKeyword(c, 'haste')).toBe(true);
    const o = getChars(s, theirs)!;
    expect(o.supertypes).not.toContain('Legendary');
    expect(pt(s, theirs)).toBe('2/2');
    expect(hasKeyword(o, 'trample')).toBe(false);
  });
  it('negative: unattached, the Aura changes nothing', () => {
    const s = start();
    const aura = mfind(s, 'Test Crown Aura', 'battlefield', 'p1');
    const t = JSON.parse(JSON.stringify(s)) as GameState;
    t.objects[aura]!.attachedTo = undefined;
    expect(pt(t, mfind(t, 'Test Plain Bear', 'battlefield', 'p1'))).toBe('2/2');
  });
});

describe('CR 613.4c, 613.1f, 301.5: "Equipped creature has first strike and gets +1/+0 for each instant and sorcery card in your graveyard."', () => {
  const BLADE = card('Test Spirit Blade', 'Artifact — Equipment', 'Equipped creature has first strike and gets +1/+0 for each instant and sorcery card in your graveyard.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const ZAP = card('Test Zap', 'Instant', '');
  const RITE = card('Test Quiet Rite', 'Sorcery', '');
  const defs = [BLADE, BEAR, ZAP, RITE];
  const start = (p2yard: string[] = []): GameState => mpScenario({ defs,
    zones: { p1: { battlefield: ['Test Spirit Blade', 'Test Plain Bear'], graveyard: ['Test Zap', 'Test Quiet Rite', 'Test Plain Bear'] }, p2: { graveyard: p2yard } },
    setup: (s) => { s.objects[mfind(s, 'Test Spirit Blade', 'battlefield', 'p1')]!.attachedTo = mfind(s, 'Test Plain Bear', 'battlefield', 'p1'); } });
  it('is automated', () => expect(full(BLADE)).toBe(true));
  it('the equipped creature has first strike and +1/+0 for each instant and sorcery card in YOUR graveyard (two: 4/2); the creature card there is not counted', () => {
    const s = start();
    const bear = mfind(s, 'Test Plain Bear', 'battlefield', 'p1');
    expect(pt(s, bear)).toBe('4/2');
    expect(hasKeyword(getChars(s, bear)!, 'first strike')).toBe(true);
  });
  it('negative: instants in an opponent\'s graveyard are not counted', () => {
    const s = start(['Test Zap', 'Test Zap']);
    expect(pt(s, mfind(s, 'Test Plain Bear', 'battlefield', 'p1'))).toBe('4/2');
  });
});

describe('CR 504.1, 121.1, 701.9a: "At the beginning of each player\'s draw step, that player draws an additional card, then discards a card."', () => {
  const LEDGER = card('Test Hoard Ledger', 'Artifact', "At the beginning of each player's draw step, that player draws an additional card, then discards a card.");
  const defs = [LEDGER];
  // (cast at the first main phase: on the battlefield from the start it would trigger at p1's own draw step while the scenario is set up)
  const start = (): GameState => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Hoard Ledger'] } } });
    return run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Hoard Ledger', 'hand', 'p1') }));
  };
  const toP2Main = (s: GameState): GameState => run(s, { until: (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' });
  it('is automated', () => expect(full(LEDGER)).toBe(true));
  it('CR 504.1: at p2\'s draw step p2 (not the Ledger\'s controller p1) draws two cards and discards one, so ends with one card in hand and one in the graveyard', () => {
    const before = start();
    const p1Hand = hand(before, 'p1').length;
    const s = toP2Main(before);
    expect(hand(s, 'p2')).toHaveLength(1);
    expect(yard(s, 'p2')).toHaveLength(1);
    expect(hand(s, 'p1')).toHaveLength(p1Hand);
    expect(yard(s, 'p1')).toHaveLength(0);
  });
  it('negative: the other players (p3, p4) are not drawing or discarding at p2\'s draw step', () => {
    const s = toP2Main(start());
    expect(hand(s, 'p3')).toHaveLength(0);
    expect(hand(s, 'p4')).toHaveLength(0);
    expect(yard(s, 'p3')).toHaveLength(0);
  });
});

describe('CR 701.9a, 608.2h: "{0}: Target opponent discards a card for each Shrine you control."', () => {
  const HALL = card('Test Whisper Shrine', 'Enchantment — Shrine', '{0}: Target opponent discards a card for each Shrine you control.');
  const QUIET = card('Test Quiet Shrine', 'Enchantment — Shrine', '');
  const WALL = card('Test Stone Wall', 'Enchantment', '');
  const defs = [HALL, QUIET, WALL];
  const start = (battlefield: string[]): GameState => mpScenario({ defs, zones: { p1: { battlefield }, p2: { hand: ['Plains', 'Plains', 'Plains', 'Plains'] }, p3: { hand: ['Plains', 'Plains'] } } });
  const activate = (s: GameState): GameState => {
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && s.objects[x.object!]?.defId === 'Test Whisper Shrine');
    if (a === undefined) throw new Error('no activation');
    return run(mact(s, a.action), { playerTargets: ['p2'] });
  };
  it('is automated', () => expect(full(HALL)).toBe(true));
  it('the target opponent (p2) discards one card for each Shrine p1 controls (three: the source and two more); p3 is untouched', () => {
    const s = activate(start(['Test Whisper Shrine', 'Test Quiet Shrine', 'Test Quiet Shrine', 'Test Stone Wall']));
    expect(hand(s, 'p2')).toHaveLength(1);
    expect(yard(s, 'p2')).toHaveLength(3);
    expect(hand(s, 'p3')).toHaveLength(2);
  });
  it('negative: only the source Shrine: one discard; Shrines an opponent controls are not counted', () => {
    const s0 = mpScenario({ defs, zones: { p1: { battlefield: ['Test Whisper Shrine'] }, p2: { hand: ['Plains', 'Plains', 'Plains'], battlefield: ['Test Quiet Shrine', 'Test Quiet Shrine'] } } });
    const s = activate(s0);
    expect(yard(s, 'p2')).toHaveLength(1);
    expect(hand(s, 'p2')).toHaveLength(2);
  });
});

describe('CR 102.3, 608.2h, 603.10a: "Whenever a creature with a bounty counter on it dies, each of its controller\'s opponents draws a card and gains 2 life."', () => {
  const POST = card('Test Bounty Post', 'Artifact', 'Whenever a creature with a bounty counter on it dies, each of its controller\'s opponents draws a card and gains 2 life.');
  const DOOM = card('Test Doom Rite', 'Sorcery', 'Destroy target creature.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [POST, DOOM, BEAR];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Bounty Post'], hand: ['Test Doom Rite'] },
    p2: { battlefield: [{ name: 'Test Plain Bear', counters: { bounty: 1 } }, 'Test Plain Bear'] } } });
  const kill = (s: GameState, bear: ObjectId): GameState => run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Doom Rite', 'hand', 'p1') }), { targets: [bear] });
  const bountyBear = (s: GameState): ObjectId => bf(s, 'Test Plain Bear', 'p2').find((id) => (s.objects[id]!.counters['bounty'] ?? 0) > 0)!;
  const plainBear = (s: GameState): ObjectId => bf(s, 'Test Plain Bear', 'p2').find((id) => (s.objects[id]!.counters['bounty'] ?? 0) === 0)!;
  it('is automated', () => expect(full(POST)).toBe(true));
  it('every player but the creature\'s controller (p1, p3, p4) draws a card and gains 2 life; its controller p2 does neither', () => {
    const before = start();
    const hands = Object.fromEntries((['p1', 'p2', 'p3', 'p4'] as PlayerId[]).map((p) => [p, hand(before, p).length - (p === 'p1' ? 1 : 0)])); // p1's hand loses the spell it casts
    const s = kill(before, bountyBear(before));
    for (const p of ['p1', 'p3', 'p4'] as PlayerId[]) { expect(lifeOf(s, p)).toBe(22); expect(hand(s, p)).toHaveLength(hands[p]! + 1); }
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(hand(s, 'p2')).toHaveLength(hands['p2']!);
  });
  it('negative: a creature without a bounty counter dying triggers nothing', () => {
    const before = start();
    const s = kill(before, plainBear(before));
    for (const p of ['p1', 'p2', 'p3', 'p4'] as PlayerId[]) expect(lifeOf(s, p)).toBe(20);
  });
});

describe('CR 301.5, 604.1: "Equipped creature has double strike as long as two or more Equipment are attached to it."', () => {
  const FIST = card('Test Iron Fist', 'Artifact — Equipment', 'Equipped creature has double strike as long as two or more Equipment are attached to it.');
  const BLADE = card('Test Plain Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+0.');
  const BOOTS = card('Test Mud Boots', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+0.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [FIST, BLADE, BOOTS, BEAR];
  const attached = (...pairs: [string, number][]): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Iron Fist', 'Test Plain Blade', 'Test Mud Boots', 'Test Plain Bear', 'Test Plain Bear'] } },
    setup: (s) => {
      const bears = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Plain Bear');
      for (const [name, bear] of pairs) s.objects[mfind(s, name, 'battlefield', 'p1')]!.attachedTo = bears[bear]!;
    } });
  const strike = (s: GameState, bear: number): boolean => hasKeyword(getChars(s, s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Plain Bear')[bear]!)!, 'double strike');
  it('is automated', () => expect(full(FIST)).toBe(true));
  it('two Equipment (the Fist and another) on one creature: double strike', () => expect(strike(attached(['Test Iron Fist', 0], ['Test Plain Blade', 0]), 0)).toBe(true));
  it('negative: only the Fist attached: no double strike', () => expect(strike(attached(['Test Iron Fist', 0]), 0)).toBe(false));
  it('negative: the other Equipment is attached to ANOTHER creature: neither has double strike', () => {
    const s = attached(['Test Iron Fist', 0], ['Test Plain Blade', 1]);
    expect(strike(s, 0)).toBe(false);
    expect(strike(s, 1)).toBe(false);
  });
  it('negative: an Aura on the creature is not an Equipment', () => expect(strike(attached(['Test Iron Fist', 0], ['Test Mud Boots', 0]), 0)).toBe(false));
});

describe('CR 614.1c, 122.6, 110.5b: "~ enters tapped and with three coin counters on it."', () => {
  const PURSE = card('Test Coin Purse', 'Artifact', 'This artifact enters tapped and with three coin counters on it.');
  const defs = [PURSE];
  it('is automated', () => expect(full(PURSE)).toBe(true));
  it('it enters the battlefield tapped with three coin counters', () => {
    let s = mpScenario({ defs, zones: { p1: { hand: ['Test Coin Purse'] } } });
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Coin Purse', 'hand', 'p1') }));
    const id = bf(s, 'Test Coin Purse', 'p1')[0]!;
    expect(s.objects[id]!.tapped).toBe(true);
    expect(s.objects[id]!.counters['coin']).toBe(3);
  });
  it('negative: put onto the battlefield from the graveyard it enters the same way (a replacement of entering, not of being cast)', () => {
    const DIG = card('Test Dig Up', 'Sorcery', 'Put target artifact card from your graveyard onto the battlefield.');
    let s = mpScenario({ defs: [PURSE, DIG], zones: { p1: { hand: ['Test Dig Up'], graveyard: ['Test Coin Purse'] } } });
    s = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Dig Up', 'hand', 'p1') }), { targets: [mfind(s, 'Test Coin Purse', 'graveyard', 'p1')] });
    const id = bf(s, 'Test Coin Purse', 'p1')[0]!;
    expect(s.objects[id]!.tapped).toBe(true);
    expect(s.objects[id]!.counters['coin']).toBe(3);
  });
});

describe('CR 601.2f, 611.3a: "Noncreature spells you cast cost {1} less to cast as long as there are three or more Lesson cards in your graveyard."', () => {
  const HALL = card('Test Lesson Hall', 'Enchantment', 'Noncreature spells you cast cost {1} less to cast as long as there are three or more Lesson cards in your graveyard.');
  const RITE = card('Test Cheap Rite', 'Sorcery', 'You gain 1 life.', undefined, '{1}{W}');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2'], '{1}{W}');
  const LESSON = card('Test Old Lesson', 'Sorcery — Lesson', 'You gain 1 life.');
  const defs = [HALL, RITE, BEAR, LESSON];
  const start = (mine: number, theirs = 0): GameState => mpScenario({ defs, zones: {
    p1: { battlefield: ['Test Lesson Hall', 'Plains'], hand: ['Test Cheap Rite', 'Test Plain Bear'], graveyard: Array(mine).fill('Test Old Lesson') }, p2: { graveyard: Array(theirs).fill('Test Old Lesson') } } });
  const canCast = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((a) => a.kind === 'cast' && s.objects[a.object!]?.defId === name);
  it('is automated', () => expect(full(HALL)).toBe(true));
  it('with three Lesson cards in your graveyard the {1}{W} sorcery costs {W}: castable with one Plains', () => expect(canCast(start(3), 'Test Cheap Rite')).toBe(true));
  it('negative: with only two Lesson cards it still costs {1}{W}, not castable with one land', () => expect(canCast(start(2), 'Test Cheap Rite')).toBe(false));
  it('negative: Lesson cards in an opponent\'s graveyard are not counted', () => expect(canCast(start(2, 5), 'Test Cheap Rite')).toBe(false));
  it('negative: a creature spell is not a noncreature spell: the {1}{W} Bear stays at two mana', () => expect(canCast(start(3), 'Test Plain Bear')).toBe(false));
});

describe('CR 509.1b, 611.3a, 702.131b: "As long as you have the city\'s blessing, Detectives you control can\'t be blocked."', () => {
  const SLEUTH = card('Test City Sleuth', 'Creature — Detective', "Ascend\nAs long as you have the city's blessing, Detectives you control can't be blocked.", ['2', '2']);
  const GUARD = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [SLEUTH, GUARD];
  const start = (permanents: number): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test City Sleuth', ...Array(permanents - 1).fill('Plains')] }, p2: { battlefield: ['Test Plain Bear'] } } });
  /** Attacks p2 with the Detective: is p2 given a declare blockers decision in which the Bear may block it? */
  const bearMayBlock = (s: GameState): boolean => {
    const sleuth = mfind(s, 'Test City Sleuth', 'battlefield', 'p1');
    let t = attack(s, sleuth, 'p2');
    for (let i = 0; i < 40 && t.pending?.kind === 'priority' && t.turn.step !== 'declareBlockers'; i++) t = mpass(t);
    if (t.pending?.kind !== 'declareBlockers') return false; // no decision at all: nothing can block
    const d = t.pending;
    const blocker = mfind(t, 'Test Plain Bear', 'battlefield', 'p2');
    const r = manswerResult(t, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareBlockers', blocks: [{ blocker, attacker: sleuth }] } });
    return r;
  };
  const manswerResult = (t: GameState, a: Parameters<typeof reject>[1]): boolean => { try { reject(t, a); return false; } catch { return true; } };
  it('is automated', () => expect(full(SLEUTH)).toBe(true));
  it('with ten permanents (the city\'s blessing) the Detective can\'t be blocked: the Bear may not block it', () => expect(bearMayBlock(start(10))).toBe(false));
  it('negative: with nine permanents there is no blessing and the Bear may block', () => expect(bearMayBlock(start(9))).toBe(true));
});

describe('CR 101.4, 608.2d, 110.2a: "Each player may put an artifact, creature, or land card from their hand onto the battlefield."', () => {
  const BARGAIN = card('Test Grand Bargain', 'Sorcery', 'Each player may put an artifact, creature, or land card from their hand onto the battlefield.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const RITE = card('Test Quiet Rite', 'Sorcery', '');
  const defs = [BARGAIN, BEAR, RITE];
  const offered: string[][] = [];
  const play = (yes = true): GameState => {
    offered.length = 0;
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Grand Bargain', 'Test Plain Bear', 'Test Quiet Rite'] }, p2: { hand: ['Plains', 'Test Quiet Rite'] }, p3: { hand: ['Test Quiet Rite'] } } });
    return run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Grand Bargain', 'hand', 'p1') }), {
      objects: (o, _p, s) => { offered.push(o.map((id) => s.objects[id]!.defId)); return yes ? o.slice(0, 1) : []; } });
  };
  it('is automated', () => expect(full(BARGAIN)).toBe(true));
  it('each player puts one eligible card from their own hand onto the battlefield under their control: p1 the Bear, p2 the Plains; p3 and p4 have none and nothing happens to them', () => {
    const s = play();
    expect(bf(s, 'Test Plain Bear', 'p1')).toHaveLength(1);
    expect(bf(s, 'Plains', 'p2')).toHaveLength(1);
    expect(hand(s, 'p3')).toEqual(['Test Quiet Rite']);
  });
  it('negative: a sorcery card is never offered, and "may" lets a player put nothing', () => {
    play();
    expect(offered.flat()).not.toContain('Test Quiet Rite');
    const s = play(false);
    expect(bf(s, 'Test Plain Bear', 'p1')).toHaveLength(0);
    expect(hand(s, 'p2')).toContain('Plains');
  });
});

describe('CR 608.2d, 110.2a: "At the beginning of each player\'s upkeep, that player may put an artifact, creature, or land card from their hand onto the battlefield."', () => {
  const GATE = card('Test Open Gate', 'Enchantment', "At the beginning of each player's upkeep, that player may put an artifact, creature, or land card from their hand onto the battlefield.");
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const RITE = card('Test Quiet Rite', 'Sorcery', '');
  const defs = [GATE, BEAR, RITE];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Open Gate'], hand: ['Test Plain Bear'] }, p2: { hand: ['Test Quiet Rite', 'Test Plain Bear'] } } });
  it('is automated', () => expect(full(GATE)).toBe(true));
  it('at p2\'s upkeep p2 (not the Gate\'s controller) chooses a card from p2\'s hand: only the Bear is offered, and it enters under p2\'s control; p1\'s hand is untouched', () => {
    const offered: string[][] = [];
    const s = run(start(), { until: (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'draw', objects: (o, _p, st, who) => { offered.push(o.map((id) => st.objects[id]!.defId)); expect(who).toBe('p2'); return o.slice(0, 1); } });
    expect(offered).toEqual([['Test Plain Bear']]);
    expect(bf(s, 'Test Plain Bear', 'p2')).toHaveLength(1);
    expect(hand(s, 'p1')).toContain('Test Plain Bear');
    expect(hand(s, 'p2')).toContain('Test Quiet Rite');
    expect(hand(s, 'p2')).not.toContain('Test Plain Bear');
  });
  it('negative ("may"): p2 declines and nothing enters', () => {
    const s = run(start(), { until: (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'draw', objects: () => [] });
    expect(bf(s, 'Test Plain Bear', 'p2')).toHaveLength(0);
  });
});

describe('CR 608.2h, 701.9a, 101.4: "Each opponent discards a card for each creature they control." (the reading of the discard-for-each template for a group: each player counts their own)', () => {
  const RECKONING = card('Test Hard Reckoning', 'Sorcery', 'Each opponent discards a card for each creature they control.');
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [RECKONING, BEAR];
  it('each opponent discards as many cards as THEY control creatures (p2: two, p3: none, p4: one); the caster\'s own creatures count for nobody', () => {
    const s0 = mpScenario({ defs, zones: { p1: { hand: ['Test Hard Reckoning'], battlefield: ['Test Plain Bear', 'Test Plain Bear', 'Test Plain Bear'] },
      p2: { battlefield: ['Test Plain Bear', 'Test Plain Bear'], hand: ['Plains', 'Plains', 'Plains'] }, p3: { hand: ['Plains', 'Plains'] }, p4: { battlefield: ['Test Plain Bear'], hand: ['Plains', 'Plains'] } } });
    const s = run(mact(s0, { type: 'cast', player: 'p1', card: mfind(s0, 'Test Hard Reckoning', 'hand', 'p1') }));
    expect(yard(s, 'p2')).toHaveLength(2);
    expect(yard(s, 'p3')).toHaveLength(0);
    expect(yard(s, 'p4')).toHaveLength(1);
  });
});
