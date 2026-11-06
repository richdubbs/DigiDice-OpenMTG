/**
 * Commander lane edh-next, round edh-next-14 (EDHREC ranks 11,251-12,500, third pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler, in 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive Rules
 * text of 2026-09-25 (media.wizards.com).
 *
 *   CR 120.3, 608.2h, 107.1  "~ deals 2 damage to you for each Treasure you control."
 *   CR 119.3, 107.1a, 604.3  "Each player loses half their life, rounded up." and "~'s power and toughness are each equal to 20 minus the highest life total among players."
 *   CR 110.2, 122.6, 400.7   "When enchanted creature dies, return that card to the battlefield under your control with a +1/+1 counter on it."
 *   CR 509.1b, 611.2a        "That creature gains haste until end of turn and can't be blocked by Walls this turn."
 *   CR 701.23a, 701.24a, 101.4 "each opponent may search ... put it onto the battlefield. Then each player who searched their library this way shuffles." / "each player may search their library for a card and put that card into their hand"
 *   CR 603.1, 205.2a         "Whenever you cast an instant, sorcery, or Wizard spell, ..."
 *   CR 201.2, 603.4          "Whenever you cast an instant or sorcery spell that has the same name as a card in your graveyard, you may put a quest counter on this enchantment."
 *   CR 708.2a, 708.3, 700.6  "return it to the battlefield face down under your control" / "target attacking historic creature gets +1/+1 and gains indestructible until end of turn"
 */
import { describe, expect, it } from 'vitest';
import { getChars, hasKeyword, legalActions, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil, reject } from '../../m12/rules/helpers';
import { card, full, pt, tokens } from '../cmd3/helpers';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.defId).filter((n) => n !== 'Plains');
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


const pendingOf = (s: GameState) => s.pending;
const castIt = (s: GameState, player: PlayerId, name: string): GameState => mact(s, { type: 'cast', player, card: mfind(s, name, 'hand', player) });
const counterOf = (s: GameState, p: PlayerId, kind: string): number => ((s.players.find((x) => x.id === p) as unknown as { counters?: Record<string, number> }).counters ?? {})[kind] ?? 0;
const blocksAnswer = (s: GameState, blocks: [ObjectId, ObjectId][]): GameState => manswer(s, { kind: 'declareBlockers', blocks: blocks.map(([blocker, attacker]) => ({ blocker, attacker })) } as DecisionAnswer);


const kw = (s: GameState, id: ObjectId, name: string): boolean => hasKeyword(getChars(s, id)!, name);
const cardAt = (name: string, type: string, text: string, ptv?: [string, string], cost = '{0}') => card(name, type, text, ptv, cost);
const castable = (s: GameState, p: PlayerId, name: string): boolean => legalActions(s, p).some((l) => l.kind === 'cast' && s.defs[s.objects[l.object!]!.defId]!.name === name);
const plains = (n: number): string[] => Array.from({ length: n }, () => 'Plains');
const objsOf = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);


const libSize = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
const setLife = (s: GameState, p: PlayerId, n: number): void => { s.players.find((x) => x.id === p)!.life = n; };
const playersAt = (s: GameState, p: PlayerId, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.controller === p);

// ---- Black Market Tycoon ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 120.3, 608.2h, 107.1: "~ deals 2 damage to you for each Treasure you control." (eff.edhn14.damage.twoForEach)', () => {
  const BURN = cardAt('Test Treasure Burn', 'Sorcery', 'Test Treasure Burn deals 2 damage to you for each Treasure you control.');
  const BIT = cardAt('Test Gold Bit', 'Artifact — Treasure', '');
  const defs = [BURN, BIT];
  it('is automated', () => expect(full(BURN)).toBe(true));
  it('two damage for each Treasure I control (three Treasures: six damage), counted as the spell resolves; an opponent\'s Treasures are not counted (the negative case)', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Treasure Burn'], battlefield: ['Test Gold Bit', 'Test Gold Bit', 'Test Gold Bit'] }, p2: { battlefield: ['Test Gold Bit', 'Test Gold Bit'] } } }), 'p1');
    const life0 = lifeOf(s, 'p1');
    s = run(castIt(s, 'p1', 'Test Treasure Burn'));
    expect(life0 - lifeOf(s, 'p1')).toBe(6);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('with no Treasure there is no damage', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Treasure Burn'] }, p2: { battlefield: ['Test Gold Bit'] } } }), 'p1');
    const life0 = lifeOf(s, 'p1');
    s = run(castIt(s, 'p1', 'Test Treasure Burn'));
    expect(lifeOf(s, 'p1')).toBe(life0);
  });
});

// ---- Scourge of the Skyclaves ----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 119.3, 107.1a, 604.3: "Each player loses half their life, rounded up." (eff.edhn14.eachPlayerLoseHalfLife) and "20 minus the highest life total among players"', () => {
  const HALF = cardAt('Test Half Rite', 'Sorcery', 'Each player loses half their life, rounded up.');
  const DEMON = cardAt('Test Size Demon', 'Creature — Demon', "Test Size Demon's power and toughness are each equal to 20 minus the highest life total among players.", ['0', '0']);
  const defs = [HALF, DEMON];
  it('are automated', () => { expect(full(HALF)).toBe(true); expect(full(DEMON)).toBe(true); });
  it('every player loses half of THEIR OWN life total rounded up: 19 -> 9, 20 -> 10, 7 -> 3, 5 -> 2', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Half Rite'] } }, setup: (st) => { setLife(st, 'p1', 19); setLife(st, 'p2', 20); setLife(st, 'p3', 7); setLife(st, 'p4', 5); } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Half Rite'));
    expect(['p1', 'p2', 'p3', 'p4'].map((p) => lifeOf(s, p))).toEqual([9, 10, 3, 2]);
  });
  it('the size is 20 minus the HIGHEST life total among all players, and follows it: 8/8 while the highest is 12, 2/2 after that player gains to 18', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { battlefield: ['Test Size Demon'] } }, setup: (st) => { setLife(st, 'p1', 9); setLife(st, 'p2', 12); setLife(st, 'p3', 5); setLife(st, 'p4', 11); } }), 'p1');
    const demon = bf(s, 'Test Size Demon', 'p1')[0]!;
    expect(pt(s, demon)).toBe('8/8');
    setLife(s, 'p3', 18);
    expect(pt(s, demon)).toBe('2/2');
  });
});

// ---- Unholy Indenture ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 110.2, 122.6, 400.7: "When enchanted creature dies, return that card to the battlefield under your control with a +1/+1 counter on it." (eff.edhn14.return.bf.underYourControl.counters; ruling 2019-07-12)', () => {
  const AURA = cardAt('Test Return Aura', 'Enchantment — Aura', 'Enchant creature\nWhen enchanted creature dies, return that card to the battlefield under your control with a +1/+1 counter on it.');
  const KILL = cardAt('Test Kill Rite', 'Instant', 'Destroy target creature.');
  const BEAR = cardAt('Test Bear G', 'Creature — Bear', '', ['2', '2']);
  const defs = [AURA, KILL, BEAR];
  const game = (): GameState => toMain(mpScenario({
    defs, zones: { p1: { hand: ['Test Kill Rite'], battlefield: ['Test Return Aura'] }, p2: { battlefield: ['Test Bear G', 'Test Bear G'] } },
    setup: (st) => {
      const aura = st.zones.battlefield.find((id) => st.objects[id]!.defId === 'Test Return Aura')!;
      const bear = st.zones.battlefield.find((id) => st.objects[id]!.defId === 'Test Bear G')!;
      st.objects[aura]!.attachedTo = bear;
    },
  }), 'p1');
  it('is automated', () => expect(full(AURA)).toBe(true));
  it('the enchanted creature of another player dies: it returns under MY control with a +1/+1 counter (a new object, the Aura went to the graveyard)', () => {
    let s = game();
    const bear = s.objects[bf(s, 'Test Return Aura', 'p1')[0]!]!.attachedTo!;
    s = run(castIt(s, 'p1', 'Test Kill Rite'), { targets: [bear] });
    const mine = playersAt(s, 'p1', 'Test Bear G');
    expect(mine).toHaveLength(1);
    expect(s.objects[mine[0]!]!.counters['+1/+1']).toBe(1);
    expect(s.objects[mine[0]!]!.owner).toBe('p2');
    expect(pt(s, mine[0]!)).toBe('3/3');
    expect(yard(s, 'p1')).toContain('Test Return Aura');
  });
  it('the negative case: another creature that dies without the Aura stays in the graveyard', () => {
    let s = game();
    const aura = bf(s, 'Test Return Aura', 'p1')[0]!;
    const other = bf(s, 'Test Bear G', 'p2').find((id) => id !== s.objects[aura]!.attachedTo)!;
    s = run(castIt(s, 'p1', 'Test Kill Rite'), { targets: [other] });
    expect(playersAt(s, 'p1', 'Test Bear G')).toHaveLength(0);
    expect(yard(s, 'p2')).toContain('Test Bear G');
  });
});

// ---- Kick in the Door ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 509.1b, 611.2a, 613.1f: "That creature gains haste until end of turn and can\'t be blocked by Walls this turn." (eff.edhn14.grant.cantbeblockedBy)', () => {
  const RITE = cardAt('Test Door Rite', 'Sorcery', "Put a +1/+1 counter on target creature. That creature gains haste until end of turn and can't be blocked by Walls this turn.");
  const BEAR = cardAt('Test Bear H', 'Creature — Bear', '', ['2', '2']);
  const WALL = cardAt('Test Wall H', 'Creature — Wall', 'Defender', ['0', '4']);
  const defs = [RITE, BEAR, WALL];
  it('is automated', () => expect(full(RITE)).toBe(true));
  it('the target gets the counter and haste, a Wall cannot block it, and a creature that is not a Wall still can', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Door Rite'], battlefield: ['Test Bear H'] }, p2: { battlefield: ['Test Wall H', 'Test Bear H'] } } }), 'p1');
    const mine = bf(s, 'Test Bear H', 'p1')[0]!;
    s = run(castIt(s, 'p1', 'Test Door Rite'), { targets: [mine] });
    expect(s.objects[mine]!.counters['+1/+1']).toBe(1);
    expect(kw(s, mine, 'haste')).toBe(true);
    s = declareAttackers(toDeclareAttackers(s), [[mine, 'p2']]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the declare blockers decision');
    const wall = bf(s, 'Test Wall H', 'p2')[0]!;
    const bear = bf(s, 'Test Bear H', 'p2')[0]!;
    expect(reject(s, { kind: 'declareBlockers', blocks: [{ blocker: wall, attacker: mine }] } as never)).toBeDefined();
    const ok = manswer(s, { kind: 'declareBlockers', blocks: [{ blocker: bear, attacker: mine }] } as never);
    expect(ok.turn).toBeDefined(); // accepted (manswer throws on a refused answer)
  });
});

// ---- Boldwyr Heavyweights and Noble Benefactor -----------------------------------------------------------------------------------------------------------------------------
describe('CR 101.4, 701.23a, 701.24a, 608.2d: "each opponent may search their library for a creature card and put it onto the battlefield. Then each player who searched their library this way shuffles." (eff.edhn14.eachPlayerWhoSearchedTheirLibrary.shuffles; ruling 2008-04-01)', () => {
  const HEAVY = cardAt('Test Heavy Giant', 'Creature — Giant', 'When this creature enters, each opponent may search their library for a creature card and put it onto the battlefield. Then each player who searched their library this way shuffles.', ['4', '4']);
  const BEAR = cardAt('Test Bear I', 'Creature — Bear', '', ['2', '2']);
  const defs = [HEAVY, BEAR];
  const game = (): GameState => toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Heavy Giant'], library: ['Test Bear I'] }, p2: { library: ['Test Bear I'] }, p3: { library: ['Test Bear I'] }, p4: { library: ['Test Bear I'] } } }), 'p1');
  it('is automated', () => expect(full(HEAVY)).toBe(true));
  it('each OPPONENT chooses for themselves: the ones who say yes put a creature onto the battlefield under their own control, the one who says no does not; I (the caster) search nothing', () => {
    let s = game();
    s = run(castIt(s, 'p1', 'Test Heavy Giant'), { yes: (_p, who) => who !== 'p3', objects: (o) => o.slice(0, 1) });
    expect(bf(s, 'Test Bear I', 'p1')).toHaveLength(0);
    expect(bf(s, 'Test Bear I', 'p2')).toHaveLength(1);
    expect(bf(s, 'Test Bear I', 'p4')).toHaveLength(1);
    expect(bf(s, 'Test Bear I', 'p3')).toHaveLength(0);
  });
  it('a player who declines does not shuffle: the libraries of the players who searched are shuffled (log), the library of the decliner is not', () => {
    let s = game();
    s = run(castIt(s, 'p1', 'Test Heavy Giant'), { yes: (_p, who) => who === 'p2', objects: (o) => o.slice(0, 1) });
    const shuffled = s.log.filter((l) => / shuffles their library/.test(l.text)).map((l) => l.text);
    expect(shuffled).toEqual(['Bob shuffles their library.']);
  });
});
describe('CR 101.4, 701.23a, 400.3: "each player may search their library for a card and put that card into their hand" (eff.edhn14.eachPlayerMay.search.anyCard.hand; ruling 2008-04-01)', () => {
  const BENE = cardAt('Test Gift Cleric', 'Creature — Cleric', 'When this creature dies, each player may search their library for a card and put that card into their hand. Then each player who searched their library this way shuffles.', ['1', '1']);
  const KILL = cardAt('Test Kill Rite B', 'Instant', 'Destroy target creature.');
  const BEAR = cardAt('Test Bear J', 'Creature — Bear', '', ['2', '2']);
  const defs = [BENE, KILL, BEAR];
  it('is automated', () => expect(full(BENE)).toBe(true));
  it('when it dies EVERY player (me too) may fetch any card into THEIR OWN hand; the one who says no gets nothing', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Kill Rite B'], battlefield: ['Test Gift Cleric'], library: ['Test Bear J'] }, p2: { library: ['Test Bear J'] }, p3: { library: ['Test Bear J'] }, p4: { library: ['Test Bear J'] } } }), 'p1');
    const cleric = bf(s, 'Test Gift Cleric', 'p1')[0]!;
    s = run(castIt(s, 'p1', 'Test Kill Rite B'), { targets: [cleric], yes: (_p, who) => who !== 'p3', objects: (o) => o.slice(0, 1) });
    const bears = (p: PlayerId): number => s.zones.hand[p]!.filter((id) => s.objects[id]!.defId === 'Test Bear J').length;
    expect([bears('p1'), bears('p2'), bears('p3'), bears('p4')]).toEqual([1, 1, 0, 1]);
  });
});

// ---- Windrider Wizard and Rockslide Sorcerer -------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.1, 205.2a, 601.2i: "Whenever you cast an instant, sorcery, or Wizard spell, ..." (list-of-three-flat; rulings 2020-09-25)', () => {
  const WINDER = cardAt('Test Wind Wizard', 'Creature — Human Wizard', 'Whenever you cast an instant, sorcery, or Wizard spell, you may draw a card. If you do, discard a card.', ['1', '1']);
  const PINGER = cardAt('Test Rock Wizard', 'Creature — Human Wizard', 'Whenever you cast an instant, sorcery, or Wizard spell, this creature deals 1 damage to any target.', ['1', '1']);
  const WIZ = cardAt('Test Apprentice K', 'Creature — Human Wizard', '', ['1', '1']);
  const BEAR = cardAt('Test Bear K', 'Creature — Bear', '', ['2', '2']);
  const SPARK = cardAt('Test Spark K', 'Instant', '');
  const RUNE = cardAt('Test Rune K', 'Artifact', '');
  const defs = [WINDER, PINGER, WIZ, BEAR, SPARK, RUNE];
  it('are automated', () => { expect(full(WINDER)).toBe(true); expect(full(PINGER)).toBe(true); });
  it('Windrider: an instant, a Wizard creature spell each draw then discard (the library shrinks by one each time, the hand keeps its size); a Bear and an artifact do not trigger (the negative case)', () => {
    const base = (): GameState => toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Spark K', 'Test Apprentice K', 'Test Bear K', 'Test Rune K'], battlefield: ['Test Wind Wizard'] } } }), 'p1');
    for (const [name, triggers] of [['Test Spark K', true], ['Test Apprentice K', true], ['Test Bear K', false], ['Test Rune K', false]] as const) {
      let s = base();
      const lib0 = libSize(s, 'p1');
      const hand0 = s.zones.hand.p1!.length;
      s = run(castIt(s, 'p1', name));
      expect(libSize(s, 'p1'), name).toBe(triggers ? lib0 - 1 : lib0);
      expect(s.zones.hand.p1!.length, name).toBe(hand0 - 1); // the cast spell leaves the hand; the draw and the discard cancel out
    }
  });
  it('Windrider: "you may" - declining draws nothing and discards nothing ("if you do")', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Spark K'], battlefield: ['Test Wind Wizard'] } } }), 'p1');
    const lib0 = libSize(s, 'p1');
    s = run(castIt(s, 'p1', 'Test Spark K'), { yes: false });
    expect(libSize(s, 'p1')).toBe(lib0);
    expect(yard(s, 'p1')).toEqual(['Test Spark K']);
  });
  it('Rockslide: a Wizard creature spell and an instant each deal 1 damage to the target; a Bear spell deals none', () => {
    for (const [name, dmg] of [['Test Apprentice K', 1], ['Test Spark K', 1], ['Test Bear K', 0]] as const) {
      let s = toMain(mpScenario({ defs, zones: { p1: { hand: [name], battlefield: ['Test Rock Wizard'] } } }), 'p1');
      s = run(castIt(s, 'p1', name), { playerTargets: ['p2'] });
      expect(20 - lifeOf(s, 'p2'), name).toBe(dmg);
    }
  });
});

// ---- Pyromancer Ascension --------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 201.2, 603.1: "Whenever you cast an instant or sorcery spell that has the same name as a card in your graveyard, you may put a quest counter on this enchantment." (ruling 2017-03-14)', () => {
  const TABLET = cardAt('Test Quest Tablet', 'Enchantment', 'Whenever you cast an instant or sorcery spell that has the same name as a card in your graveyard, you may put a quest counter on this enchantment.');
  const SPARK = cardAt('Test Spark L', 'Instant', '');
  const OTHER = cardAt('Test Flash L', 'Instant', '');
  const defs = [TABLET, SPARK, OTHER];
  it('is automated', () => expect(full(TABLET)).toBe(true));
  it('casting a spell with the name of a card in MY graveyard puts a quest counter; a spell of another name, or the same name only in an OPPONENT\'s graveyard, does not (the negative cases)', () => {
    const quest = (s: GameState): number => s.objects[bf(s, 'Test Quest Tablet', 'p1')[0]!]!.counters['quest'] ?? 0;
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Spark L'], graveyard: ['Test Spark L'], battlefield: ['Test Quest Tablet'] } } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Spark L'));
    expect(quest(s)).toBe(1);
    s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Flash L'], graveyard: ['Test Spark L'], battlefield: ['Test Quest Tablet'] } } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Flash L'));
    expect(quest(s)).toBe(0);
    s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Spark L'], battlefield: ['Test Quest Tablet'] }, p2: { graveyard: ['Test Spark L'] } } }), 'p1');
    s = run(castIt(s, 'p1', 'Test Spark L'));
    expect(quest(s)).toBe(0);
  });
});

// ---- Ashcloud Phoenix ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 708.2a, 708.3, 110.2, 400.7: "When this creature dies, return it to the battlefield face down under your control." (eff.edhn14.return.toBattlefield.faceDown.yourControl; ruling 2014-09-20)', () => {
  const BIRD = cardAt('Test Ash Bird', 'Creature — Phoenix', 'Flying\nWhen this creature dies, return it to the battlefield face down under your control.', ['4', '1']);
  const KILL = cardAt('Test Kill Rite C', 'Instant', 'Destroy target creature.');
  const BEAR = cardAt('Test Bear M', 'Creature — Bear', '', ['2', '2']);
  const defs = [BIRD, KILL, BEAR];
  it('is automated', () => expect(full(BIRD)).toBe(true));
  it('it dies and comes back as a face-down 2/2 under the control of the player whose trigger it was (its controller, not the player who killed it); an ordinary creature stays dead (the negative case)', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { hand: ['Test Kill Rite C', 'Test Kill Rite C'] }, p2: { battlefield: ['Test Ash Bird', 'Test Bear M'] } } }), 'p1');
    const bird = bf(s, 'Test Ash Bird', 'p2')[0]!;
    const bear = bf(s, 'Test Bear M', 'p2')[0]!;
    s = run(castIt(s, 'p1', 'Test Kill Rite C'), { targets: [bird] });
    const back = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown);
    expect(back).toHaveLength(1);
    expect(s.objects[back[0]!]!.controller).toBe('p2');
    expect(s.objects[back[0]!]!.defId).toBe('Test Ash Bird');
    expect(pt(s, back[0]!)).toBe('2/2');
    s = run(castIt(s, 'p1', 'Test Kill Rite C'), { targets: [bear] });
    expect(bf(s, 'Test Bear M', 'p2')).toHaveLength(0);
    expect(yard(s, 'p2')).toContain('Test Bear M');
  });
});

// ---- Tegan Jovanka ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 700.6, 508.1, 611.2a: "Whenever you attack, target attacking historic creature gets +1/+1 and gains indestructible until end of turn." (historic-attacking-order)', () => {
  const AIDE = cardAt('Test Brave Aide', 'Creature — Human', 'Whenever you attack, target attacking historic creature gets +1/+1 and gains indestructible until end of turn.', ['1', '1']);
  const HERO = cardAt('Test Hero N', 'Legendary Creature — Human', '', ['2', '2']);
  const GOLEM = cardAt('Test Golem N', 'Artifact Creature — Golem', '', ['2', '2']);
  const BEAR = cardAt('Test Bear N', 'Creature — Bear', '', ['2', '2']);
  const defs = [AIDE, HERO, GOLEM, BEAR];
  it('is automated', () => expect(full(AIDE)).toBe(true));
  it('only an attacking legendary, artifact or Saga creature is a legal target: the attacking Bear and the legendary creature that stays home are not', () => {
    let s = toMain(mpScenario({ defs, zones: { p1: { battlefield: ['Test Brave Aide', 'Test Hero N', 'Test Golem N', 'Test Bear N'] } } }), 'p1');
    const [hero, golem, bear] = ['Test Hero N', 'Test Golem N', 'Test Bear N'].map((n) => bf(s, n, 'p1')[0]!);
    s = declareAttackers(toDeclareAttackers(s), [[golem!, 'p2'], [bear!, 'p2']]);
    const p = s.pending as unknown as { kind: string; objects?: ObjectId[]; options?: ObjectId[] };
    expect(p.kind).toBe('chooseTargets');
    const legal = p.objects ?? p.options ?? [];
    expect(legal).toEqual([golem]);
    expect(legal).not.toContain(hero);
    s = run(s, { targets: [golem!] });
    expect(pt(s, golem!)).toBe('3/3');
    expect(kw(s, golem!, 'indestructible')).toBe(true);
    expect(pt(s, bear!)).toBe('2/2');
  });
});
