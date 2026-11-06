/**
 * Commander lane edh-top, round edh-top-6: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler, in 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25
 * (media.wizards.com), read in the session.
 *
 *   CR 101.4, 118.12, 608.2d  "Starting with you, each player may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way." (join forces)
 *   CR 701.23a, 110.2a        "... Each player searches their library for up to X basic land cards, where X is the total ..., puts them onto the battlefield tapped, then shuffles."
 *   CR 115.1, 601.2c, 404.1   "for each opponent, you may put up to one target creature card from that player's graveyard onto the battlefield under your control" (one target per opponent)
 *   CR 118.9, 614.1a          "for each opponent, you may cast up to one target instant or sorcery card from that player's graveyard without paying its mana cost. If a spell cast this way would be put into a graveyard, exile it instead."
 *   CR 115.1, 205.3m          "For each player, choose up to one target creature card in that player's graveyard. Put those cards onto the battlefield under your control. They're Zombies in addition to their other types."
 *   CR 603.2, 115.1, 702.10a  "Whenever ~ or another Pirate you control enters, gain control of target creature until end of turn. Untap that creature. ... it gains haste and becomes a Pirate ..."
 *   CR 603.2c, 102.3, 401.2   "Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries. You may play those cards this turn ..."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, findAll as mfindAll, lifeOf, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const onBattlefield = (s: GameState, p: PlayerId, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === defId);

/** Answers whatever is pending until the stack is empty and priority is back: `numbers` is the amount each payer chooses, in the order asked; `asked` records who was asked. */
function settle(s0: GameState, o: { numbers?: number[]; asked?: PlayerId[]; search?: 'all' | 'none'; pick?: (options: string[]) => string[]; yes?: boolean; targets?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  const numbers = [...(o.numbers ?? [])];
  const targets = [...(o.targets ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    if (p.kind === 'chooseNumber') { o.asked?.push(p.player); s = manswer(s, { kind: 'chooseNumber', n: Math.min(numbers.shift() ?? 0, (p as { max: number }).max) }); }
    else if (p.kind === 'payCost') s = manswer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = manswer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseTargets') s = manswer(s, targets.shift() ?? ({ kind: 'chooseTargets', targets: [] } as DecisionAnswer));
    else if (p.kind === 'chooseObjects') s = manswer(s, { kind: 'chooseObjects', ids: o.pick !== undefined ? o.pick((p as unknown as { options: string[] }).options) : o.search === 'none' ? [] : (p as unknown as { options: string[]; max: number }).options.slice(0, (p as unknown as { max: number }).max) });
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = mpass(s); }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
  }
  return s;
}
const cast = (s: GameState, name: string, p: PlayerId = 'p1'): GameState => mact(s, { type: 'cast', player: p, card: mfind(s, name, 'hand', p) });

describe('CR 101.4, 118.12, 608.2d: join forces, "Starting with you, each player may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way."', () => {
  const STUDY = card('Test Joint Study', 'Sorcery', 'Join forces — Starting with you, each player may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way.');
  const VOYAGE = card('Test Joint Voyage', 'Sorcery', 'Join forces — Starting with you, each player may pay any amount of mana. Each player searches their library for up to X basic land cards, where X is the total amount of mana paid this way, puts them onto the battlefield tapped, then shuffles.');
  const defs = [STUDY, VOYAGE];
  const lands = (n: number) => Array<string>(n).fill('Plains');
  const board = (hand: string, p1Lands = 3) => mpScenario({ defs, zones: { p1: { hand: [hand], battlefield: lands(p1Lands) }, p2: { battlefield: lands(2) }, p3: { battlefield: lands(1) }, p4: { battlefield: [] } } });
  it('are automated', () => { expect(full(STUDY)).toBe(true); expect(full(VOYAGE)).toBe(true); });
  it('CR 101.4: each player is asked in turn order starting with the caster; what they pay together is X for every player (all four draw X)', () => {
    const asked: PlayerId[] = [];
    let s = board('Test Joint Study');
    const before = [1, 2, 3, 4].map((i) => handSize(s, `p${i}` as PlayerId));
    s = settle(cast(s, 'Test Joint Study'), { numbers: [1, 2, 1], asked });
    expect(asked).toEqual(['p1', 'p2', 'p3']); // p4 controls no land: not offered a payment (CR 118.3)
    const after = [1, 2, 3, 4].map((i) => handSize(s, `p${i}` as PlayerId));
    // the spell left p1's hand: p1 draws 4, so +3 net; the others +4
    expect(after.map((n, i) => n - before[i]!)).toEqual([3, 4, 4, 4]);
    // the mana was paid: 1 + 2 + 1 lands tapped
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(4);
  });
  it('CR 101.4: "starting with you" is the caster, not the active player: with p2 casting it on p1\'s turn the order is p2, p3, p4, p1', () => {
    const asked: PlayerId[] = [];
    let s = mpScenario({ defs, zones: { p1: { battlefield: lands(1) }, p2: { hand: ['Test Joint Study'], battlefield: lands(1) }, p3: { battlefield: lands(1) }, p4: { battlefield: lands(1) } } });
    s = mact(s, { type: 'pass', player: 'p1' }); // (the spell is a sorcery: cast it in p2's own main phase)
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's main phase");
    s = settle(cast(s, 'Test Joint Study', 'p2'), { numbers: [1, 0, 0, 1], asked });
    expect(asked).toEqual(['p2', 'p3', 'p4', 'p1']);
  });
  it('CR 101.4: cast by p3 in response during p1\'s turn: the order starts with the caster p3 (p3, p4, p1, p2), not the active player p1', () => {
    const FLASH = card('Test Joint Flash', 'Instant', 'Join forces \u2014 Starting with you, each player may pay any amount of mana. Each player draws X cards, where X is the total amount of mana paid this way.');
    const DUMMY = card('Test Dummy Rite', 'Sorcery', 'You gain 1 life.');
    const asked: PlayerId[] = [];
    let s = mpScenario({ defs: [...defs, FLASH, DUMMY], zones: { p1: { hand: ['Test Dummy Rite'], battlefield: lands(1) }, p2: { battlefield: lands(1) }, p3: { hand: ['Test Joint Flash'], battlefield: lands(1) }, p4: { battlefield: lands(1) } } });
    s = cast(s, 'Test Dummy Rite');
    s = mpass(s); // p1 passes: p2 has priority
    s = mpass(s); // p2 passes: p3 has priority
    expect(s.pending?.player).toBe('p3');
    s = settle(cast(s, 'Test Joint Flash', 'p3'), { numbers: [0, 0, 0, 0], asked });
    expect(asked.slice(0, 4)).toEqual(['p3', 'p4', 'p1', 'p2']);
  });
  it('CR 608.2d: any amount, zero included: nobody pays, nobody draws; and the most a player can pay is the mana they have', () => {
    let s = board('Test Joint Study');
    const before = [1, 2, 3, 4].map((i) => handSize(s, `p${i}` as PlayerId));
    s = settle(cast(s, 'Test Joint Study'), { numbers: [0, 0, 0] });
    expect([1, 2, 3, 4].map((i) => handSize(s, `p${i}` as PlayerId) - before[i - 1]!)).toEqual([-1, 0, 0, 0]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(0);
    // p2 has two lands and asks for 9: the offer is capped at what they can pay
    s = board('Test Joint Study');
    const asked: PlayerId[] = [];
    s = settle(cast(s, 'Test Joint Study'), { numbers: [0, 9, 0], asked });
    expect(handSize(s, 'p3')).toBe(handSize(board('Test Joint Study'), 'p3') + 2);
  });
  it('CR 701.23a, 110.2a: the search version: every player puts up to X basic lands onto the battlefield tapped (X the total), players with fewer lands in the library find fewer', () => {
    let s = board('Test Joint Voyage');
    const lib = (p: PlayerId): number => s.zones.library[p]!.length;
    const l2 = lib('p2');
    s = settle(cast(s, 'Test Joint Voyage'), { numbers: [1, 2, 0], search: 'all' });
    // p1 paid 1, p2 paid 2: X = 3 for everyone
    expect(onBattlefield(s, 'p1', 'Plains').filter((id) => s.objects[id]!.tapped).length).toBe(3 + 1); // 3 found + the one Plains tapped for the payment
    expect(onBattlefield(s, 'p4', 'Plains')).toHaveLength(3);
    expect(onBattlefield(s, 'p4', 'Plains').every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(lib('p2')).toBeLessThan(l2); // the library was searched and shuffled
    expect(onBattlefield(s, 'p3', 'Plains')).toHaveLength(1 + 3);
  });
  it('negative: with nothing paid the search finds nothing (X = 0), and a player may find fewer than X ("up to")', () => {
    let s = board('Test Joint Voyage');
    s = settle(cast(s, 'Test Joint Voyage'), { numbers: [0, 0, 0], search: 'all' });
    expect(onBattlefield(s, 'p4', 'Plains')).toHaveLength(0);
    s = board('Test Joint Voyage');
    s = settle(cast(s, 'Test Joint Voyage'), { numbers: [2, 0, 0], search: 'none' });
    expect(onBattlefield(s, 'p4', 'Plains')).toHaveLength(0);
  });
});

describe('CR 115.1, 601.2c, 404.1, 608.2d: "When this creature enters, for each opponent, you may put up to one target creature card from that player\'s graveyard onto the battlefield under your control."', () => {
  const WALKER = card('Test Grave Walker', 'Creature — Zombie', "When this creature enters, for each opponent, you may put up to one target creature card from that player's graveyard onto the battlefield under your control.", ['2', '2']);
  const BEAR = card('Test Dead Bear', 'Creature — Bear', '', ['2', '2']);
  const BOLT = card('Test Dead Bolt', 'Instant', 'Test Dead Bolt deals 2 damage to each opponent.');
  const defs = [WALKER, BEAR, BOLT];
  const start = () => mpScenario({
    defs,
    zones: {
      p1: { hand: ['Test Grave Walker'], graveyard: ['Test Dead Bear'] },
      p2: { graveyard: ['Test Dead Bear', 'Test Dead Bear', 'Test Dead Bolt'] },
      p3: { graveyard: ['Test Dead Bear'] },
      p4: { graveyard: ['Test Dead Bolt'] },
    },
  });
  const inYard = (s: GameState, p: PlayerId, defId: string): ObjectId[] => (s.zones.graveyard[p] ?? []).filter((id) => s.objects[id]!.defId === defId);
  it('is automated', () => expect(full(WALKER)).toBe(true));
  /** p1 casts the Walker; the trigger's targets are chosen by `pick` (a graveyard card of each player named). */
  function enter(s0: GameState, pick: (s: GameState) => ObjectId[], o: { yes?: boolean; keep?: (s: GameState) => ObjectId[] } = {}): { s: GameState; pending: GameState } {
    let s = cast(s0, 'Test Grave Walker');
    s = mpass(s); // everyone passes: the creature resolves ...
    for (let i = 0; i < 3 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = mpass(s);
    const picked = pick(s);
    const pending = s;
    if (s.pending?.kind === 'chooseTargets') s = manswer(s, { kind: 'chooseTargets', targets: picked.map((id) => ({ kind: 'object' as const, id })) });
    return { s: settle(s, { yes: o.yes ?? true, ...(o.yes === false ? { search: 'none' as const } : {}), ...(o.keep !== undefined ? { pick: (opts: string[]) => opts.filter((id) => o.keep!(s).includes(id)) } : {}) }), pending };
  }
  it('CR 601.2c: one target in each of two opponents\' graveyards; the creatures enter together under p1\'s control and the others stay (the opponent with no target loses nothing)', () => {
    const { s } = enter(start(), (x) => [inYard(x, 'p2', 'Test Dead Bear')[0]!, inYard(x, 'p3', 'Test Dead Bear')[0]!]);
    expect(onBattlefield(s, 'p1', 'Test Dead Bear')).toHaveLength(2);
    expect(inYard(s, 'p2', 'Test Dead Bear')).toHaveLength(1); // p2 had two: one remains
    expect(inYard(s, 'p3', 'Test Dead Bear')).toHaveLength(0);
    expect(inYard(s, 'p1', 'Test Dead Bear')).toHaveLength(1); // your own graveyard is not an opponent's
    expect(inYard(s, 'p4', 'Test Dead Bolt')).toHaveLength(1); // a card that is no creature, in the graveyard of an opponent with no creature card, stays
  });
  it('negative (CR 601.2c): two targets in the same opponent\'s graveyard are refused; so is a target in your own graveyard or a noncreature card', () => {
    let s = cast(start(), 'Test Grave Walker');
    s = mpass(s);
    for (let i = 0; i < 6 && s.pending?.kind === 'priority'; i++) s = mpass(s); // stops at the trigger's target choice
    expect(s.pending?.kind).toBe('chooseTargets');
    const [a, b] = inYard(s, 'p2', 'Test Dead Bear');
    const bad = (ids: ObjectId[]): boolean => {
      try { manswer(s, { kind: 'chooseTargets', targets: ids.map((id) => ({ kind: 'object' as const, id })) }); return false; } catch { return true; }
    };
    expect(bad([a!, b!])).toBe(true); // two from p2
    expect(bad([inYard(s, 'p1', 'Test Dead Bear')[0]!])).toBe(true); // your own graveyard
    expect(bad([inYard(s, 'p2', 'Test Dead Bolt')[0]!])).toBe(true); // an instant
    expect(bad([a!])).toBe(false);
  });
  it('CR 608.2d: a "you may" for each opponent: put the card of one opponent and decline the other\'s; the one put enters, the declined card stays', () => {
    const { s } = enter(start(), (x) => [inYard(x, 'p2', 'Test Dead Bear')[0]!, inYard(x, 'p3', 'Test Dead Bear')[0]!], { keep: (x) => inYard(x, 'p3', 'Test Dead Bear') });
    expect(onBattlefield(s, 'p1', 'Test Dead Bear')).toHaveLength(1);
    expect(inYard(s, 'p3', 'Test Dead Bear')).toHaveLength(0);
    expect(inYard(s, 'p2', 'Test Dead Bear')).toHaveLength(2);
  });
  it('CR 608.2d: "you may": declining puts nothing onto the battlefield', () => {
    const { s } = enter(start(), (x) => [inYard(x, 'p2', 'Test Dead Bear')[0]!], { yes: false });
    expect(onBattlefield(s, 'p1', 'Test Dead Bear')).toHaveLength(0);
    expect(inYard(s, 'p2', 'Test Dead Bear')).toHaveLength(2);
  });
});

describe('CR 118.9, 601.2c, 614.1a: "for each opponent, you may cast up to one target instant or sorcery card from that player\'s graveyard without paying its mana cost. If a spell cast this way would be put into a graveyard, exile it instead."', () => {
  const DRAKE = card('Test Echo Drake', 'Creature — Drake', "When this creature enters, for each opponent, you may cast up to one target instant or sorcery card from that player's graveyard without paying its mana cost. If a spell cast this way would be put into a graveyard, exile it instead.", ['2', '2']);
  const BOLT = card('Test Echo Bolt', 'Instant', 'Test Echo Bolt deals 2 damage to each opponent.');
  const BEAR = card('Test Echo Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [DRAKE, BOLT, BEAR];
  const start = () => mpScenario({ defs, zones: { p1: { hand: ['Test Echo Drake'], graveyard: ['Test Echo Bolt'] }, p2: { graveyard: ['Test Echo Bolt', 'Test Echo Bear'] }, p3: { graveyard: ['Test Echo Bolt'] }, p4: {} } });
  const inZone = (s: GameState, zone: 'graveyard' | 'exile', p: PlayerId, defId: string): ObjectId[] =>
    (zone === 'exile' ? s.zones.exile : s.zones.graveyard[p] ?? []).filter((id) => s.objects[id]!.defId === defId && s.objects[id]!.owner === p);
  it('is automated', () => expect(full(DRAKE)).toBe(true));
  function run(s0: GameState, pickTargets: (s: GameState) => ObjectId[], yes: boolean): GameState {
    let s = cast(s0, 'Test Echo Drake');
    for (let i = 0; i < 8 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = mpass(s);
    if (s.pending?.kind === 'chooseTargets') s = manswer(s, { kind: 'chooseTargets', targets: pickTargets(s).map((id) => ({ kind: 'object' as const, id })) });
    return settle(s, { yes });
  }
  it('CR 118.9: two spells, one from each of two opponents\' graveyards, are cast for free; each deals 2 damage to each opponent, and neither card goes back to a graveyard (it is exiled)', () => {
    const s = run(start(), (x) => [inZone(x, 'graveyard', 'p2', 'Test Echo Bolt')[0]!, inZone(x, 'graveyard', 'p3', 'Test Echo Bolt')[0]!], true);
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([16, 16, 16]);
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(inZone(s, 'graveyard', 'p2', 'Test Echo Bolt')).toHaveLength(0);
    expect(inZone(s, 'exile', 'p2', 'Test Echo Bolt')).toHaveLength(1);
    expect(inZone(s, 'exile', 'p3', 'Test Echo Bolt')).toHaveLength(1);
    expect(inZone(s, 'graveyard', 'p1', 'Test Echo Bolt')).toHaveLength(1); // your own graveyard's card was no target
  });
  it('negative: declining the cast leaves the card in its owner\'s graveyard; a creature card is no legal target', () => {
    const s = run(start(), (x) => [inZone(x, 'graveyard', 'p2', 'Test Echo Bolt')[0]!], false);
    expect(lifeOf(s, 'p2')).toBe(20);
    expect(inZone(s, 'graveyard', 'p2', 'Test Echo Bolt')).toHaveLength(1);
    expect(inZone(s, 'exile', 'p2', 'Test Echo Bolt')).toHaveLength(0);
    let t = cast(start(), 'Test Echo Drake');
    for (let i = 0; i < 8 && t.pending?.kind === 'priority' && t.zones.stack.length > 0; i++) t = mpass(t);
    expect(t.pending?.kind).toBe('chooseTargets');
    const bear = inZone(t, 'graveyard', 'p2', 'Test Echo Bear')[0]!;
    expect(() => manswer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] })).toThrow();
  });
});

describe('CR 115.1, 601.2c, 404.1, 205.3m: "For each player, choose up to one target creature card in that player\'s graveyard. Put those cards onto the battlefield under your control. They\'re Zombies in addition to their other types."', () => {
  const LOAM = card('Test Loam Rite', 'Sorcery', "For each player, choose up to one target creature card in that player's graveyard. Put those cards onto the battlefield under your control. They're Zombies in addition to their other types.");
  const BEAR = card('Test Loam Bear', 'Creature — Bear', '', ['2', '2']);
  const defs = [LOAM, BEAR];
  const start = () => mpScenario({ defs, zones: { p1: { hand: ['Test Loam Rite'], graveyard: ['Test Loam Bear'] }, p2: { graveyard: ['Test Loam Bear', 'Test Loam Bear'] }, p3: { graveyard: ['Test Loam Bear'] }, p4: {} } });
  const yard = (s: GameState, p: PlayerId): ObjectId[] => (s.zones.graveyard[p] ?? []).filter((id) => s.objects[id]!.defId === 'Test Loam Bear');
  it('is automated', () => expect(full(LOAM)).toBe(true));
  function cast1(s0: GameState, pick: (s: GameState) => ObjectId[]): GameState {
    let s = cast(s0, 'Test Loam Rite');
    expect(s.pending?.kind).toBe('chooseTargets');
    s = manswer(s, { kind: 'chooseTargets', targets: pick(s).map((id) => ({ kind: 'object' as const, id })) });
    return settle(s);
  }
  it('CR 601.2c: one card from each of three graveyards (yours too) enters under your control together, and each is a Zombie in addition to Bear (the rest of the card is unchanged)', () => {
    const s = cast1(start(), (x) => [yard(x, 'p1')[0]!, yard(x, 'p2')[0]!, yard(x, 'p3')[0]!]);
    const bears = onBattlefield(s, 'p1', 'Test Loam Bear');
    expect(bears).toHaveLength(3);
    for (const id of bears) {
      const subtypes = getChars(s, id).subtypes;
      expect(subtypes).toContain('Zombie');
      expect(subtypes).toContain('Bear');
    }
    expect(yard(s, 'p2')).toHaveLength(1);
  });
  it('negative: two cards of one graveyard are refused; with no target nothing happens', () => {
    let s = cast(start(), 'Test Loam Rite');
    const [a, b] = yard(s, 'p2');
    expect(() => manswer(s, { kind: 'chooseTargets', targets: [a!, b!].map((id) => ({ kind: 'object' as const, id })) })).toThrow();
    s = cast1(start(), () => []);
    expect(onBattlefield(s, 'p1', 'Test Loam Bear')).toHaveLength(0);
  });
  it('CR 611.2a, 613.1d: the Zombie type stays after the turn ends (no duration), and a creature that was not put onto the battlefield by it is not a Zombie', () => {
    let s = cast1(start(), (x) => [yard(x, 'p2')[0]!]);
    s = passUntil(s, (x) => x.turn.number >= 2 && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'the next turn');
    const [bear] = onBattlefield(s, 'p1', 'Test Loam Bear');
    expect(getChars(s, bear!).subtypes).toContain('Zombie');
    expect(getChars(s, yard(s, 'p2')[0]!).subtypes).not.toContain('Zombie');
  });
});

describe('CR 603.2, 115.1, 611.2a, 702.10a: "Whenever ~ or another Pirate you control enters, gain control of target creature until end of turn. Untap that creature. Until end of turn, it gains haste and becomes a Pirate in addition to its other types."', () => {
  const BOSS = card('Test Press Boss', 'Creature — Orc Pirate', 'Whenever ~ or another Pirate you control enters, gain control of target creature until end of turn. Untap that creature. Until end of turn, it gains haste and becomes a Pirate in addition to its other types.', ['3', '3']);
  const MATE = card('Test Deckhand', 'Creature — Human Pirate', '', ['1', '1']);
  const COW = card('Test Cow', 'Creature — Ox', '', ['2', '2']);
  const defs = [BOSS, MATE, COW];
  it('is automated', () => expect(full(BOSS)).toBe(true));
  const start = () => mpScenario({ defs, zones: { p1: { hand: ['Test Press Boss', 'Test Deckhand', 'Test Cow'] }, p2: { battlefield: [{ name: 'Test Cow', tapped: true } as never] } } });
  function enterAndTake(s0: GameState, name: string, hand = true): GameState {
    let s = hand ? cast(s0, name) : s0;
    s = mpass(s);
    for (let i = 0; i < 8 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = mpass(s);
    if (s.pending?.kind === 'chooseTargets') s = manswer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: mfind(s, 'Test Cow', 'battlefield', 'p2') }] });
    return settle(s);
  }
  it('CR 611.2a, 701.26b, 702.10a, 205.3m: the Boss entering takes the tapped cow: it is p1\'s, untapped, has haste and is a Pirate as well as an Ox, all until end of turn', () => {
    const s = enterAndTake(start(), 'Test Press Boss');
    const cow = onBattlefield(s, 'p1', 'Test Cow')[0]!;
    expect(cow).toBeDefined();
    expect(s.objects[cow]!.tapped).toBe(false);
    expect(hasKeyword(getChars(s, cow), 'haste')).toBe(true);
    expect(getChars(s, cow).subtypes).toEqual(expect.arrayContaining(['Pirate', 'Ox']));
  });
  it('CR 611.2a: the effect ends with the turn it was made in: the cow is p2\'s again, not a Pirate, without haste', () => {
    let s = enterAndTake(start(), 'Test Press Boss');
    s = passUntil(s, (x) => x.turn.number >= 3 && x.turn.step === 'main1' && x.turn.activePlayer === 'p1' && x.pending?.kind === 'priority', "p1's next turn");
    expect(onBattlefield(s, 'p2', 'Test Cow')).toHaveLength(1);
    const cow = onBattlefield(s, 'p2', 'Test Cow')[0]!;
    expect(getChars(s, cow).subtypes).not.toContain('Pirate');
    expect(hasKeyword(getChars(s, cow), 'haste')).toBe(false);
  });
  it('CR 603.2: another Pirate entering triggers it too (the cow is taken); a creature that is no Pirate does not (no target is asked, the cow stays)', () => {
    const board = () => mpScenario({ defs, zones: { p1: { hand: ['Test Deckhand', 'Test Cow'], battlefield: ['Test Press Boss'] }, p2: { battlefield: [{ name: 'Test Cow', tapped: true } as never] } } });
    let s = enterAndTake(board(), 'Test Deckhand');
    expect(onBattlefield(s, 'p1', 'Test Cow')).toHaveLength(1);
    s = cast(board(), 'Test Cow');
    s = mpass(s);
    expect(s.pending?.kind).not.toBe('chooseTargets');
    expect(onBattlefield(s, 'p2', 'Test Cow')).toHaveLength(1);
  });
});

describe('CR 603.2c, 102.3, 401.2, 608.2c: "Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents\' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells."', () => {
  const CHIEF = card('Test Plunder Chief', 'Legendary Creature — Goblin Pirate', "Whenever one or more Pirates you control deal damage to your opponents, exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.", ['1', '1']);
  const CORSAIR = card('Test Plunder Corsair', 'Creature — Human Pirate', '', ['2', '2']);
  const LOOT = card('Test Plunder Loot', 'Creature — Bear', '', ['1', '1']);
  const defs = [CHIEF, CORSAIR, LOOT];
  it('is automated', () => expect(full(CHIEF)).toBe(true));
  const board = () => mpScenario({ defs, zones: { p1: { battlefield: ['Test Plunder Chief', 'Test Plunder Corsair', 'Test Plunder Corsair'] }, p2: { library: ['Test Plunder Loot'] }, p3: { library: ['Test Plunder Loot'] }, p4: { library: ['Test Plunder Loot'] } } });
  function attack(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[]): GameState {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
    s = manswer(s, { kind: 'declareAttackers', attacks });
    for (let i = 0; i < 400 && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareBlockers') s = manswer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'priority') s = mpass(s);
      else throw new Error(`unexpected ${d.kind}: ${d.prompt}`);
    }
    return s;
  }
  const exiledLoot = (s: GameState): PlayerId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Plunder Loot').map((id) => s.objects[id]!.owner).sort() as PlayerId[];
  const castable = (s: GameState, p: PlayerId): ObjectId[] => legalActions(s, p).filter((a) => a.kind === 'cast' && a.object !== undefined && s.objects[a.object]!.zone === 'exile').map((a) => a.object!);
  const twoOpponents = (): GameState => {
    const s0 = board();
    const [a, b] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Plunder Corsair');
    return attack(s0, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p3' }]);
  };
  it('CR 102.3, 603.2c: Pirates damaging two different opponents exile the top card of those two libraries only (not the third opponent\'s, not yours)', () => {
    const s = twoOpponents();
    expect(exiledLoot(s)).toEqual(['p2', 'p3']);
    expect(s.objects[s.zones.library['p4']![0]!]!.defId).toBe('Test Plunder Loot'); // p4 was not dealt damage: its top card is still there
    expect([lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([18, 18, 20]);
  });
  it('CR 609.4b, 601.2: you may cast both exiled cards this turn (the cards of two owners); an opponent may not', () => {
    const s = twoOpponents();
    expect(castable(s, 'p1')).toHaveLength(2);
    expect(castable(s, 'p2')).toHaveLength(0);
    const cast1 = mact(s, { type: 'cast', player: 'p1', card: castable(s, 'p1')[0]! });
    const t = settle(cast1);
    expect(onBattlefield(t, 'p1', 'Test Plunder Loot')).toHaveLength(1);
  });
  it('negative: damage to one opponent from two Pirates is one trigger and one card; a creature that is no Pirate dealing damage exiles nothing', () => {
    const s0 = board();
    const [a, b] = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Plunder Corsair');
    const s = attack(s0, [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }]);
    expect(exiledLoot(s)).toEqual(['p2']);
    const t0 = mpScenario({ defs: [...defs, card('Test Plunder Bear', 'Creature \u2014 Bear', '', ['2', '2'])], zones: { p1: { battlefield: ['Test Plunder Chief', 'Test Plunder Bear'] }, p2: { library: ['Test Plunder Loot'] } } });
    const bear = mfind(t0, 'Test Plunder Bear', 'battlefield', 'p1');
    const t = attack(t0, [{ attacker: bear, defender: 'p2' }]);
    expect(exiledLoot(t)).toEqual([]);
  });
  it('CR 609.4b, 611.2a: the permission ends with the turn: on the next turn the exiled cards can no longer be cast', () => {
    let s = twoOpponents();
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's turn");
    expect(castable(s, 'p1')).toHaveLength(0);
    expect(exiledLoot(s).length).toBeGreaterThanOrEqual(2);
  });
});
