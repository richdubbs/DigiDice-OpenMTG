/**
 * Commander lane edh-mana-keywords, round edh-mana-keywords-7: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them.
 *
 *   CR 702.151a-b, 301.5c  Reconfigure {cost}: attach this permanent to another target creature you control (sorcery speed); unattach it (only while attached, sorcery
 *                          speed); attached, it is not a creature
 *   CR 702.165a, 702.165c-d  Backup N: counters on target creature; another creature also gains the abilities printed below the keyword until end of turn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, isTapped, life, pool, scenario } from '../../m3/scenario';
import { attackWith, card, cast, counters, full, pt, resolveAll, settle, type Picks } from '../cmd3/helpers';
import { hasKeyword } from '../../../src/rules/characteristics';

const isCreature = (s: GameState, id: ObjectId): boolean => getChars(s, id)!.types.includes('Creature');
const offered = (s: GameState, name: string, player = 'p1'): number => {
  const source = find(s, name, 'battlefield', player);
  return legalActions(s, player).filter((l) => l.kind === 'activate' && l.object === source && l.isMana !== true).length;
};
const activate = (s: GameState, name: string, index: number, target?: ObjectId): GameState => {
  const source = find(s, name, 'battlefield', 'p1');
  const a = legalActions(s, 'p1').filter((l) => l.kind === 'activate' && l.object === source && l.isMana !== true)[index];
  if (!a) throw new Error(`no activation ${index} of ${name}`);
  let r = settle(act(s, a.action), { targets: target === undefined ? [] : [{ kind: 'object', id: target }] });
  for (let i = 0; i < 6 && r.zones.stack.length > 0; i++) r = settle(act(r, { type: 'pass', player: r.pending!.player }));
  return r;
};

// ---- Reconfigure: attach, stop being a creature, unattach ----------------------------------------------------------------------------------------------------
const BLADE = card('Test Reblade', 'Artifact Creature — Equipment Fox', 'Equipped creature gets +2/+2.\nReconfigure {0}', ['1', '1']);
const BEAR = card('Test Reconbear', 'Creature — Bear', '', ['2', '2']);
const FOE = card('Test Reconfoe', 'Creature — Bear', '', ['2', '2']);
const LONE = card('Test Reconlone', 'Artifact Creature — Equipment Fox', 'Reconfigure {0}', ['1', '1']);
const KILL = card('Test Rekill', 'Instant', 'Destroy target creature.');
const DEFS = [BLADE, BEAR, FOE, LONE];

describe('CR 702.151a-b, 301.5c: reconfigure', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Reblade', 'Test Reconbear'] }, p2: { battlefield: ['Test Reconfoe'] } });
  const attached = (): GameState => {
    const s0 = board();
    return activate(s0, 'Test Reblade', 0, find(s0, 'Test Reconbear', 'battlefield', 'p1'));
  };
  it('the cards are fully automated', () => {
    expect(full(BLADE), JSON.stringify(BLADE.automation)).toBe(true);
    expect(full(LONE), JSON.stringify(LONE.automation)).toBe(true);
  });
  it('unattached, it is a creature and the unattach ability is not offered (only the attach one)', () => {
    const s = board();
    expect(isCreature(s, find(s, 'Test Reblade', 'battlefield', 'p1'))).toBe(true);
    expect(offered(s, 'Test Reblade')).toBe(1);
  });
  it('attaching to another creature you control makes it stop being a creature and equips (+2/+2)', () => {
    const s = attached();
    const blade = find(s, 'Test Reblade', 'battlefield', 'p1');
    const bear = find(s, 'Test Reconbear', 'battlefield', 'p1');
    expect(s.objects[blade]!.attachedTo).toBe(bear);
    expect(isCreature(s, blade)).toBe(false);
    // Lizard Blades ruling 2022-02-18: it also loses the creature subtypes it had (CR 205.1b); it is still an Equipment
    expect(getChars(s, blade)!.subtypes).not.toContain('Fox');
    expect(getChars(s, blade)!.subtypes).toContain('Equipment');
    expect(pt(s, bear)).toBe('4/4');
  });
  it('attached, both abilities are offered (attach to another creature, unattach); unattaching makes it a creature again', () => {
    const s0 = attached();
    expect(offered(s0, 'Test Reblade')).toBe(2);
    const s = activate(s0, 'Test Reblade', 1);
    const blade = find(s, 'Test Reblade', 'battlefield', 'p1');
    expect(s.objects[blade]!.attachedTo).toBeUndefined();
    expect(isCreature(s, blade)).toBe(true);
    expect(pt(s, find(s, 'Test Reconbear', 'battlefield', 'p1'))).toBe('2/2');
  });
  it('negative: it cannot be attached to an opponent\'s creature or to itself (no legal target but your other creature)', () => {
    const s0 = board();
    const source = find(s0, 'Test Reblade', 'battlefield', 'p1');
    const a = legalActions(s0, 'p1').find((l) => l.kind === 'activate' && l.object === source && l.isMana !== true)!;
    const s1 = act(s0, a.action);
    const d = s1.pending as { kind: string; options?: { id: ObjectId }[]; specs?: { options?: ObjectId[] }[] } | undefined;
    const legal = JSON.stringify(d);
    expect(legal).toContain(find(s0, 'Test Reconbear', 'battlefield', 'p1'));
    expect(legal).not.toContain(find(s0, 'Test Reconfoe', 'battlefield', 'p2'));
    expect(legal).not.toContain(source);
  });
  it('negative: with no other creature of yours the attach ability has no target and stays a creature', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Reconlone'] } });
    expect(offered(s, 'Test Reconlone')).toBe(0);
    expect(isCreature(s, find(s, 'Test Reconlone', 'battlefield', 'p1'))).toBe(true);
  });
  it('the host leaving the battlefield unattaches it: it is a creature again (CR 704.5n)', () => {
    const withKill = scenario([], { defs: [...DEFS, KILL], p1: { battlefield: ['Test Reblade', 'Test Reconbear'], hand: ['Test Rekill'] } });
    const att = activate(withKill, 'Test Reblade', 0, find(withKill, 'Test Reconbear', 'battlefield', 'p1'));
    const k = resolveAll(cast(att, 'Test Rekill', { targets: [{ kind: 'object', id: find(att, 'Test Reconbear', 'battlefield', 'p1') }] }));
    const blade = find(k, 'Test Reblade', 'battlefield', 'p1');
    expect(k.objects[blade]!.attachedTo).toBeUndefined();
    expect(isCreature(k, blade)).toBe(true);
  });
});

// ---- Backup: counters, and the abilities below the keyword for another creature until end of turn -------------------------------------------------------------
const BACKER = card('Test Backer', 'Creature — Human', 'Backup 1\nFlying\nWhenever this creature attacks, you gain 1 life.', ['2', '2']);
const FRIEND = card('Test Backfriend', 'Creature — Human', '', ['1', '1']);

describe('CR 702.165a: backup', () => {
  /** Cast the backer and let it resolve until its enters trigger asks for a target; `pick` names it from the state then. */
  const backed = (pick: (s: GameState) => ObjectId, rest: { drain?: boolean } = {}): GameState => {
    const s0 = scenario([], { defs: [BACKER, FRIEND], p1: { hand: ['Test Backer'], battlefield: ['Test Backfriend'] } });
    let s = cast(s0, 'Test Backer');
    for (let i = 0; i < 8 && s.pending?.kind !== 'chooseTargets'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.pending?.kind).toBe('chooseTargets');
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: pick(s) }] }));
    return rest.drain === false ? s : resolveAll(s);
  };
  it('the card is fully automated', () => {
    expect(full(BACKER), JSON.stringify(BACKER.automation)).toBe(true);
  });
  it('another creature gets the counter and the abilities below the keyword until end of turn; the backer itself does not change', () => {
    const s = backed((x) => find(x, 'Test Backfriend', 'battlefield', 'p1'));
    const friend = find(s, 'Test Backfriend', 'battlefield', 'p1');
    const backer = find(s, 'Test Backer', 'battlefield', 'p1');
    expect(counters(s, friend, '+1/+1')).toBe(1);
    expect(pt(s, friend)).toBe('2/2');
    expect(hasKeyword(getChars(s, friend)!, 'flying')).toBe(true);
    expect(counters(s, backer, '+1/+1')).toBe(0);
  });
  it("the granted trigger works for the creature that has it (\"this creature\" is that creature) and the grant ends with the turn", () => {
    const s = backed((x) => find(x, 'Test Backfriend', 'battlefield', 'p1'));
    const friend = find(s, 'Test Backfriend', 'battlefield', 'p1');
    const before = life(s, 'p1');
    const a = resolveAll(attackWith(s, [friend]));
    expect(life(a, 'p1')).toBe(before + 1);
    const next = advanceTo(a, a.turn.number + 1, 'upkeep');
    expect(hasKeyword(getChars(next, find(next, 'Test Backfriend', 'battlefield', 'p1'))!, 'flying')).toBe(false);
    expect(counters(next, find(next, 'Test Backfriend', 'battlefield', 'p1'), '+1/+1')).toBe(1);
  });
  it('negative: backup on the backer itself puts the counter on it and grants nothing more (no flying beyond its own, no second trigger)', () => {
    const s = backed((x) => find(x, 'Test Backer', 'battlefield', 'p1'));
    const backer = find(s, 'Test Backer', 'battlefield', 'p1');
    const friend = find(s, 'Test Backfriend', 'battlefield', 'p1');
    expect(counters(s, backer, '+1/+1')).toBe(1);
    expect(counters(s, friend, '+1/+1')).toBe(0);
    expect(hasKeyword(getChars(s, friend)!, 'flying')).toBe(false);
  });
});

// ---- Demonstrate: copy it, then an opponent copies it too ------------------------------------------------------------------------------------------------------
const DEMO = card('Test Demo', 'Sorcery', 'Demonstrate\nYou gain 2 life.');

describe('CR 702.144a: demonstrate', () => {
  const run = (picks: Picks): GameState => {
    const s0 = scenario([], { defs: [DEMO], p1: { hand: ['Test Demo'] } });
    return resolveAll(cast(s0, 'Test Demo', picks), picks);
  };
  it('the card is fully automated', () => {
    expect(full(DEMO), JSON.stringify(DEMO.automation)).toBe(true);
  });
  it('you copy it (you gain 2 more) and the chosen opponent copies it too (that opponent gains 2)', () => {
    const s = run({ yes: true });
    expect(life(s, 'p1')).toBe(24);
    expect(life(s, 'p2')).toBe(22);
  });
  it('negative: declining the copy means no copy and no opponent copy (only the spell itself resolves)', () => {
    const s = run({ yes: false });
    expect(life(s, 'p1')).toBe(22);
    expect(life(s, 'p2')).toBe(20);
  });
});

// ---- "At the beginning of each of your main phases, add {G}{G}." (a Siege that chose Khans) ----------------------------------------------------------------------
const SIEGE = card('Test Siegeline', 'Enchantment', "As this enchantment enters, choose Khans or Dragons.\n• Khans — At the beginning of each of your main phases, add {G}{G}.\n• Dragons — Whenever a creature you control with flying enters, you may have it fight target creature you don't control.");

describe('CR 505.1a, 603.2, 106.4: "At the beginning of each of your main phases, add {G}{G}."', () => {
  const chosen = (option: string): GameState => {
    const s0 = scenario([], { defs: [SIEGE], p1: { hand: ['Test Siegeline'] } });
    return resolveAll(cast(s0, 'Test Siegeline', { option }), { option });
  };
  it('the card is fully automated', () => {
    expect(full(SIEGE), JSON.stringify(SIEGE.automation)).toBe(true);
  });
  it('choosing Khans: {G}{G} at the beginning of your precombat and of your postcombat main phase, each phase', () => {
    const s0 = chosen('Khans');
    const one = resolveAll(advanceTo(s0, s0.turn.number + 2, 'main1'));
    expect(pool(one, 'p1')).toBe('GG');
    const two = resolveAll(advanceTo(one, one.turn.number, 'main2'));
    expect(pool(two, 'p1')).toBe('GG');
  });
  it("negative: choosing Dragons adds no mana at the beginning of a main phase", () => {
    const s0 = chosen('Dragons');
    const one = resolveAll(advanceTo(s0, s0.turn.number + 2, 'main1'));
    expect(pool(one, 'p1')).toBe('');
  });
});

// ---- "Each instant and sorcery card in your graveyard has flashback. The flashback cost is equal to that card's mana cost." ---------------------------------------
const LIERLIKE = card('Test Lierlike', 'Creature — Human Wizard', "Each instant and sorcery card in your graveyard has flashback. The flashback cost is equal to that card's mana cost.", ['1', '1']);
const ZAP = card('Test Zapfast', 'Instant', 'You gain 3 life.', undefined, '{1}');
const BEAR2 = card('Test Yardbear', 'Creature — Bear', '', ['2', '2'], '{1}');
const SPRING2 = card('Test Reconspring', 'Artifact', '{T}: Add {C}.');
const FREEBIE = compileCard({ name: 'Test Nocost Instant', layout: 'normal', mana_cost: '', type_line: 'Instant', oracle_text: 'You gain 1 life.', colors: [] } as OracleCard);

describe('CR 702.34a, 118.9, 613.1f: each instant and sorcery card in your graveyard has flashback (cost = its mana cost)', () => {
  const board = (): GameState => scenario([], { defs: [LIERLIKE, ZAP, BEAR2, SPRING2, FREEBIE], p1: { battlefield: ['Test Lierlike', 'Test Reconspring'], graveyard: ['Test Zapfast', 'Test Yardbear', 'Test Nocost Instant'] }, p2: { graveyard: ['Test Zapfast'] } });
  const castable = (s: GameState, name: string, owner: string): boolean => {
    const id = find(s, name, 'graveyard', owner);
    return legalActions(s, 'p1').some((l) => l.kind === 'cast' && l.object === id);
  };
  it('the card is fully automated', () => {
    expect(full(LIERLIKE), JSON.stringify(LIERLIKE.automation)).toBe(true);
  });
  it('your instant in your graveyard can be cast with flashback for its mana cost, and is exiled afterwards', () => {
    const s0 = board();
    expect(castable(s0, 'Test Zapfast', 'p1')).toBe(true);
    const id = find(s0, 'Test Zapfast', 'graveyard', 'p1');
    const cast0 = legalActions(s0, 'p1').find((l) => l.kind === 'cast' && l.object === id)!;
    const s = resolveAll(settle(act(s0, cast0.action)));
    expect(life(s, 'p1')).toBe(23);
    expect(s.zones.exile.some((x) => s.objects[x]?.defId === 'Test Zapfast')).toBe(true);
    expect((s.zones.graveyard['p1'] ?? []).some((x) => s.objects[x]?.defId === 'Test Zapfast')).toBe(false);
  });
  it("negative: a creature card in your graveyard and an opponent's graveyard card are not castable", () => {
    const s0 = board();
    expect(castable(s0, 'Test Yardbear', 'p1')).toBe(false);
    expect(castable(s0, 'Test Zapfast', 'p2')).toBe(false);
  });
  it('negative: a card with no mana cost gains flashback but has no flashback cost (Lier ruling 2025-06-06): it can not be cast this way', () => {
    expect(castable(board(), 'Test Nocost Instant', 'p1')).toBe(false);
  });
});

// ---- "Whenever a player casts their first multicolored spell each turn, each other player draws a card." (others than the player who cast it) -----------------------
const CHRONO = card('Test Chronicle', 'Artifact Creature — Construct', 'Whenever a player casts their first multicolored spell each turn, each other player draws a card.', ['1', '1']);
const gold = (name: string, type: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: '', colors: ['W', 'U'] } as OracleCard);
const GOLD1 = gold('Test Goldspell', 'Instant');
const GOLD2 = gold('Test Goldspell Two', 'Instant');
const FILLER = card('Test Filler', 'Creature — Bear', '', ['1', '1']);

describe('CR 603.2, 601.2i: "each other player" of a trigger on a spell being cast is every player but the one who cast it', () => {
  const handSize = (s: GameState, p: string): number => (s.zones.hand[p] ?? []).length;
  const base = (): GameState => scenario([], { defs: [CHRONO, GOLD1, GOLD2, FILLER], p1: { battlefield: ['Test Chronicle'], hand: ['Test Goldspell', 'Test Goldspell Two'], library: ['Test Filler', 'Test Filler', 'Test Filler'] }, p2: { hand: ['Test Goldspell'], library: ['Test Filler', 'Test Filler', 'Test Filler'] } });
  const castBy = (s: GameState, p: string, name: string): GameState => {
    const id = find(s, name, 'hand', p);
    const a = legalActions(s, p).find((l) => l.kind === 'cast' && l.object === id)!;
    return resolveAll(settle(act(s, a.action)));
  };
  it('the card is fully automated', () => {
    expect(full(CHRONO), JSON.stringify(CHRONO.automation)).toBe(true);
  });
  it('you cast your first multicolored spell: the other player draws, you do not (the controller is not "the other")', () => {
    const s = castBy(base(), 'p1', 'Test Goldspell');
    expect(handSize(s, 'p2')).toBe(2);
    expect(handSize(s, 'p1')).toBe(1);
  });
  it('an opponent casts one: you draw (the others than the opponent), the opponent does not', () => {
    const s0 = base();
    const passed = act(s0, { type: 'pass', player: 'p1' });
    const s = castBy(passed, 'p2', 'Test Goldspell');
    expect(handSize(s, 'p1')).toBe(3);
    expect(handSize(s, 'p2')).toBe(0);
  });
  it('negative: the second multicolored spell of the same player in a turn draws nothing', () => {
    const s1 = castBy(base(), 'p1', 'Test Goldspell');
    const s = castBy(s1, 'p1', 'Test Goldspell Two');
    expect(handSize(s, 'p2')).toBe(2);
  });
});

// ---- "destroy up to three target noncreature permanents. For each permanent put into a graveyard this way, its controller creates a 3/3 ..." ------------------------
const TERA = card('Test Terrafall', 'Creature — Elephant', "When this creature enters, you may destroy up to three target noncreature permanents. For each permanent put into a graveyard this way, its controller creates a 3/3 green Elephant creature token.", ['6', '6']);
const ROCK1 = card('Test Yardrock', 'Artifact', '');
const ROCK2 = card('Test Foerock', 'Artifact', '');
const HARD = card('Test Hardrock', 'Artifact', 'Indestructible');
const EXILER = card('Test Exilerule', 'Enchantment', 'If a card would be put into a graveyard from anywhere, exile it instead.');

describe('CR 701.8a, 614.6, 608.2c: "For each permanent put into a graveyard this way, its controller creates ..."', () => {
  const run = (mine: string[], theirs: string[], pick: string[], extra: string[] = []): GameState => {
    const s0 = scenario([], { defs: [TERA, ROCK1, ROCK2, HARD, EXILER], p1: { hand: ['Test Terrafall'], battlefield: mine }, p2: { battlefield: theirs } });
    let s = cast(s0, 'Test Terrafall');
    for (let i = 0; i < 8 && s.pending?.kind !== 'chooseTargets'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    const ids = pick.map((n) => find(s0, n, 'battlefield', n === 'Test Foerock' || n === 'Test Hardrock2' ? 'p2' : 'p1'));
    void extra;
    s = settle(answer(s, { kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) }));
    return resolveAll(s, { yes: true });
  };
  const elephants = (s: GameState, p: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p).length;
  it('the card is fully automated', () => {
    expect(full(TERA), JSON.stringify(TERA.automation)).toBe(true);
  });
  it('each permanent destroyed gives its own controller a 3/3 (mine to me, theirs to them)', () => {
    const s = run(['Test Yardrock'], ['Test Foerock'], ['Test Yardrock', 'Test Foerock']);
    expect(elephants(s, 'p1')).toBe(1);
    expect(elephants(s, 'p2')).toBe(1);
  });
  it('negative: an indestructible permanent is not destroyed, so its controller gets nothing', () => {
    const s = run(['Test Yardrock', 'Test Hardrock'], [], ['Test Yardrock', 'Test Hardrock']);
    expect(elephants(s, 'p1')).toBe(1);
  });
  it('negative: a permanent a replacement effect exiles instead is not "put into a graveyard this way": no token for it', () => {
    const s = run(['Test Yardrock', 'Test Exilerule'], ['Test Foerock'], ['Test Yardrock', 'Test Foerock']);
    expect(elephants(s, 'p1')).toBe(0);
    expect(elephants(s, 'p2')).toBe(0);
  });
});

// ---- "Activate only if you control three or more lands with the same name." (a mana ability and a plain ability) ---------------------------------------------------
const SCEPTRE = card('Test Sceptrelike', 'Artifact', '{T}: Add three mana of any one color. Activate only if you control three or more lands with the same name.');
const ATLAS = card('Test Atlaslike', 'Artifact', '{0}, {T}: You gain 2 life. Activate only if you control three or more lands with the same name.');

describe('CR 201.2, 602.5b: "Activate only if you control three or more lands with the same name."', () => {
  const manaOffered = (s: GameState, name: string): boolean => { const id = find(s, name, 'battlefield', 'p1'); return legalActions(s, 'p1').some((l) => l.kind === 'activate' && l.object === id); };
  const lands = (names: string[], extra: string[] = []): GameState => scenario(['Forest', 'Island', 'Swamp'], { defs: [SCEPTRE, ATLAS], p1: { battlefield: [...extra, ...names] }, p2: { battlefield: ['Forest', 'Forest', 'Forest'] } });
  it('the cards are fully automated', () => {
    expect(full(SCEPTRE), JSON.stringify(SCEPTRE.automation)).toBe(true);
    expect(full(ATLAS), JSON.stringify(ATLAS.automation)).toBe(true);
  });
  it('three Forests: both abilities are offered and the Atlas resolves', () => {
    const s = lands(['Forest', 'Forest', 'Forest'], ['Test Sceptrelike', 'Test Atlaslike']);
    expect(manaOffered(s, 'Test Sceptrelike')).toBe(true);
    expect(manaOffered(s, 'Test Atlaslike')).toBe(true);
    expect(life(activate(s, 'Test Atlaslike', 0), 'p1')).toBe(22);
  });
  it('negative: two Forests and an Island (no three alike), or three different lands, offer neither', () => {
    for (const names of [['Forest', 'Forest', 'Island'], ['Forest', 'Island', 'Swamp']]) {
      const s = lands(names, ['Test Sceptrelike', 'Test Atlaslike']);
      expect(manaOffered(s, 'Test Sceptrelike')).toBe(false);
      expect(manaOffered(s, 'Test Atlaslike')).toBe(false);
    }
  });
  it("negative: the opponent's three Forests do not count (you control the lands)", () => {
    const s = lands(['Forest', 'Island', 'Swamp'], ['Test Sceptrelike']);
    expect(manaOffered(s, 'Test Sceptrelike')).toBe(false);
  });
});

// ---- "{T}: Add {W}{U}{B}{R}{G}. This mana can't be spent to pay generic mana costs." (Jegantha) ---------------------------------------------------------------------
const WELL = card('Test Wellspring', 'Creature — Elemental', "{T}: Add {W}{U}{B}{R}{G}. This mana can't be spent to pay generic mana costs.", ['1', '1']);
const costed = (name: string, cost: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: cost, type_line: 'Instant', oracle_text: 'You gain 1 life.', colors: ['G'] } as OracleCard);
const PAY_G = costed('Test Pay G', '{G}');
const PAY_1 = costed('Test Pay One', '{1}');
const PAY_1G = costed('Test Pay One G', '{1}{G}');
const PAY_ALL = costed('Test Pay All', '{W}{U}{B}{R}{G}');
const PAY_HYB = costed('Test Pay Hybrid', '{2/W}');
const PAY_HYB2 = costed('Test Pay Hybrid Two', '{2/W}{2/W}');

describe('CR 106.6, 107.4b: "This mana can\'t be spent to pay generic mana costs."', () => {
  const castable = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((l) => l.kind === 'cast' && l.object === find(s, name, 'hand', 'p1'));
  const board = (extra: string[]): GameState => scenario(['Forest'], { defs: [WELL, PAY_G, PAY_1, PAY_1G, PAY_ALL, PAY_HYB, PAY_HYB2], p1: { battlefield: ['Test Wellspring', ...extra], hand: ['Test Pay G', 'Test Pay One', 'Test Pay One G', 'Test Pay All', 'Test Pay Hybrid', 'Test Pay Hybrid Two'] } });
  it('the card is fully automated', () => {
    expect(full(WELL), JSON.stringify(WELL.automation)).toBe(true);
  });
  it('alone it pays colored costs (a {G}, all five colors, the {W} of a {2/W} hybrid) but never a generic one ({1}, or the {1} of {1}{G})', () => {
    const s = board([]);
    expect(castable(s, 'Test Pay G')).toBe(true);
    expect(castable(s, 'Test Pay All')).toBe(true);
    expect(castable(s, 'Test Pay Hybrid')).toBe(true);
    expect(castable(s, 'Test Pay One')).toBe(false);
    expect(castable(s, 'Test Pay One G')).toBe(false);
    expect(castable(s, 'Test Pay Hybrid Two')).toBe(false); // the second {2/W} would need its generic half (review finding: the hybrid case)
  });
  it('with a Forest beside it the Forest pays the generic part and the Wellspring the colored part of {1}{G}; {1} alone is the Forest\'s', () => {
    const s = board(['Forest']);
    expect(castable(s, 'Test Pay One G')).toBe(true);
    expect(castable(s, 'Test Pay One')).toBe(true);
    // paid for real: the Forest's {G} is generic mana for the {1}, the Wellspring's {G} pays the {G}
    const id = find(s, 'Test Pay One G', 'hand', 'p1');
    const a = legalActions(s, 'p1').find((l) => l.kind === 'cast' && l.object === id)!;
    const after = resolveAll(settle(act(s, a.action)));
    expect(life(after, 'p1')).toBe(21);
    expect(isTapped(after, find(after, 'Forest', 'battlefield', 'p1'))).toBe(true);
    expect(isTapped(after, find(after, 'Test Wellspring', 'battlefield', 'p1'))).toBe(true);
  });
});
