/**
 * Round edh-d-102 (must-finish, EDHREC band 5,001-10,000, group graveyard-exile-cast): the new readings played through the engine with synthetic cards (invented names,
 * design 6.10), each test named after the rule it checks, with its negative case.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, cast, drive, find, lands, next, resolveTop, scenario, until } from '../../m6/dfc/support';
import { castWith, no, resolveAll, yes } from '../../m6/costs/support';
import { legal, passBoth } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';
import { mutate as mutateCast, table as mutateTable, DOOM, ELVES, OVER } from '../../m6/mutate/support';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
}
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const isMiracle = (s: GameState): boolean => s.pending?.kind === 'chooseOption' && /miracle/.test((s.pending as { prompt: string }).prompt);
/** Steps the game to p1's next draw-step miracle offer, or to p1's next first main phase when none comes. */
function toMiracleOrMain(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 400; i++) {
    if (isMiracle(s)) return s;
    if (s.turn.activePlayer === 'p1' && s.turn.number > 1 && s.turn.step === 'main1' && s.pending?.kind === 'priority') return s;
    s = s.pending?.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) }) : next(s);
  }
  return s;
}

// --- Aminatou, Veil Piercer: "Each enchantment card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}." ---
const VEIL = card('Test Veil Seer', 'Creature — Human Wizard', 'Each enchantment card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}.', { pt: ['2', '2'], cost: '{1}{W}' });
const BIG = card('Test Bright Halo', 'Enchantment', 'When ~ enters, you gain 3 life.', { cost: '{5}{W}' });
const SMALL = card('Test Small Halo', 'Enchantment', 'When ~ enters, you gain 1 life.', { cost: '{2}{W}' });
const XEN = card('Test Wide Halo', 'Enchantment', 'When ~ enters, you gain 2 life.', { cost: '{X}{W}' });
const HYB = card('Test Twin Halo', 'Enchantment', 'When ~ enters, you gain 2 life.', { cost: '{4}{W/U}{W/U}' });
const OX = card('Test Plain Ox', 'Creature — Ox', 'Vigilance', { pt: ['2', '2'], cost: '{5}{W}' });

describe('Aminatou, Veil Piercer: a granted miracle whose cost is the mana cost reduced by {4} (CR 702.94a, 118.9, 613.1f)', () => {
  const board = (top: string): GameState => scenario(['Plains'], { defs: [VEIL, BIG, SMALL, XEN, OX, HYB], p1: { library: [top, 'Test Plain Ox'], battlefield: ['Test Veil Seer', ...lands('Plains', 4)] } });

  it('CR 702.94a, 118.9: the first card drawn, an enchantment, is revealed and cast for its mana cost less {4} ({5}{W} -> {1}{W})', () => {
    let s = toMiracleOrMain(board('Test Bright Halo'));
    expect(isMiracle(s)).toBe(true);
    expect(s.turn.step).toBe('draw');
    expect(JSON.stringify(s.pending)).toContain('{1}{W}');
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    s = drive(s);
    expect(s.zones.stack.length).toBe(1); // the miracle trigger (CR 603.3)
    s = resolveTop(s);
    expect(s.pending).toMatchObject({ kind: 'yesNo' });
    s = answer(s, { kind: 'yesNo', yes: true });
    s = drive(s);
    expect(names(s, s.zones.stack)).toEqual(['Test Bright Halo']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped && names(s, [id])[0] === 'Plains')).toHaveLength(2); // {1}{W}, not {5}{W}
  });

  it('CR 118.9, 107.4: only generic mana is reduced, never below none ({2}{W} -> {W})', () => {
    const s = toMiracleOrMain(board('Test Small Halo'));
    expect(isMiracle(s)).toBe(true);
    const p = JSON.stringify(s.pending);
    expect(p).toContain('miracle {W}');
  });

  it('CR 601.2f: hybrid symbols stay as they are ({4}{W/U}{W/U} -> {W/U}{W/U})', () => {
    const s = toMiracleOrMain(board('Test Twin Halo'));
    expect(isMiracle(s)).toBe(true);
    expect(JSON.stringify(s.pending)).toContain('miracle {W/U}{W/U}');
    let t = drive(answer(s, { kind: 'chooseOption', ids: ['0'] }));
    t = resolveTop(t);
    t = drive(answer(t, { kind: 'yesNo', yes: true }));
    expect(names(t, t.zones.stack)).toEqual(['Test Twin Halo']); // cast for two hybrid mana
  });

  it('negative: a creature card drawn first has no miracle; an enchantment with {X} in its cost is not offered (fail closed)', () => {
    expect(isMiracle(toMiracleOrMain(board('Test Plain Ox')))).toBe(false);
    expect(isMiracle(toMiracleOrMain(board('Test Wide Halo')))).toBe(false);
  });

  it('negative: without the grantor the enchantment offers no miracle', () => {
    const s0 = scenario(['Plains'], { defs: [VEIL, BIG, SMALL, XEN, OX], p1: { library: ['Test Bright Halo', 'Test Plain Ox'], battlefield: lands('Plains', 4) } });
    const s = toMiracleOrMain(s0);
    expect(isMiracle(s)).toBe(false);
    expect(find(s, 'Test Bright Halo', 'hand')).toBeDefined();
  });
});

// --- Blightwing Bandit: "Whenever you cast your first spell during each opponent's turn, look at the top card of that player's library, then exile it face down. You may
// play that card for as long as it remains exiled, and mana of any type can be spent to cast it." ---
const BANDIT = card('Test Wing Thief', 'Creature — Faerie Rogue', "Flying, deathtouch\nWhenever you cast your first spell during each opponent's turn, look at the top card of that player's library, then exile it face down. You may play that card for as long as it remains exiled, and mana of any type can be spent to cast it.", { pt: ['2', '2'], cost: '{3}{B}' });
const QUICK = card('Test Quick Sip', 'Instant', 'You gain 1 life.', { cost: '{0}' });
const QUICK2 = card('Test Quick Gulp', 'Instant', 'You gain 2 life.', { cost: '{0}' });
const SEA = card('Test Sea Bolt', 'Instant', 'You gain 4 life.', { cost: '{U}{U}' });

describe('Blightwing Bandit: "that player" of a cast trigger limited to each opponent\'s turn is the active player (CR 102.1, 603.2, 608.2c)', () => {
  const board = (): GameState => scenario(['Mountain'], { defs: [BANDIT, QUICK, QUICK2, SEA], p1: { hand: ['Test Quick Sip', 'Test Quick Gulp'], battlefield: ['Test Wing Thief', ...lands('Mountain', 2)], library: ['Test Quick Gulp', 'Test Quick Gulp'] }, p2: { library: ['Test Sea Bolt', 'Test Quick Gulp'] } });
  const p2Upkeep = (s: GameState): GameState => until(s, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'upkeep' && t.pending?.kind === 'priority' && t.pending.player === 'p1');
  const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  const toP1 = (s: GameState): GameState => (s.pending?.kind === 'priority' && s.pending.player === 'p2' ? next(s) : s); // the active player passes (CR 117.3b)

  it('CR 102.1, 608.2c: the first spell p1 casts on p2\'s turn exiles the top card of p2\'s library face down; p1 may cast it with mana of any type (CR 609.4b)', () => {
    let s = p2Upkeep(board());
    const ownLibrary = s.zones.library.p1!.length;
    s = cast(s, 'Test Quick Sip');
    expect(s.zones.stack.length).toBe(2); // the trigger above the spell (CR 603.3)
    s = resolveTop(s);
    const bolt = s.zones.exile.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Sea Bolt');
    expect(bolt).toBeDefined(); // p2's top card, not p1's
    expect(s.objects[bolt!]!.faceDown).toBe(true);
    expect(s.objects[bolt!]!.owner).toBe('p2');
    expect(s.zones.library.p1!.length).toBe(ownLibrary);
    s = toP1(resolveTop(s));
    const before = life(s, 'p1');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object === bolt);
    expect(la).toBeDefined(); // {U}{U} paid with the two Mountains' red mana
    s = drive(act(s, la!.action));
    s = resolveTop(s);
    expect(life(s, 'p1')).toBe(before + 4);
    expect(s.objects[bolt!]?.zone ?? 'gone').not.toBe('exile');
  });

  it('negative: the second spell of that turn does not trigger, and neither does a spell on p1\'s own turn', () => {
    let s = p2Upkeep(board());
    s = cast(s, 'Test Quick Sip');
    s = resolveTop(s);
    s = toP1(resolveTop(s));
    s = cast(s, 'Test Quick Gulp');
    expect(s.zones.stack.length).toBe(1); // no trigger (not the first spell this turn)
    const own = scenario(['Mountain'], { defs: [BANDIT, QUICK, QUICK2, SEA], p1: { hand: ['Test Quick Sip'], battlefield: ['Test Wing Thief'] }, p2: { library: ['Test Sea Bolt'] } });
    const t = until(own, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p1');
    expect(cast(t, 'Test Quick Sip').zones.stack.length).toBe(1);
  });
});

// --- Auspicious Starrix: "Whenever this creature mutates, exile cards from the top of your library until you exile X permanent cards, where X is the number of times this
// creature has mutated. Put those permanent cards onto the battlefield." ---
const STARELK = card('Test Star Elk', 'Creature — Elk Beast', 'Mutate {0}\nWhenever this creature mutates, exile cards from the top of your library until you exile X permanent cards, where X is the number of times this creature has mutated. Put those permanent cards onto the battlefield.', { pt: ['6', '6'], cost: '{G}' });
const PLAINMUT = card('Test Plain Mutant', 'Creature — Beast', 'Mutate {0}', { pt: ['1', '1'], cost: '{G}' });
const SPELL1 = card('Test Spark Note', 'Instant', 'You gain 1 life.', { cost: '{R}' });
const ROCK = card('Test Grey Rock', 'Artifact', '{T}: You gain 1 life.', { cost: '{1}' });
const WALL = card('Test Moss Wall', 'Creature — Wall', 'Defender', { pt: ['0', '4'], cost: '{1}{G}' });
const RING = card('Test Rust Ring', 'Enchantment — Aura', 'Enchant planeswalker\nEnchanted planeswalker gets +1/+1.', { cost: '{1}' });

describe('Auspicious Starrix: exile until X permanent cards are exiled, X the times it has mutated; those cards onto the battlefield (CR 702.140d, 406.1, 107.3, 608.2c)', () => {
  const lib = ['Test Spark Note', 'Test Grey Rock', 'Test Spark Note', 'Test Moss Wall', 'Test Grey Rock', 'Test Spark Note'];
  const exiledNames = (s: GameState): string[] => names(s, s.zones.exile);
  const mine = (s: GameState, name: string): number => s.zones.battlefield.filter((x) => names(s, [x])[0] === name && s.objects[x]!.controller === 'p1').length;
  const start = (library: string[]): GameState => {
    const s0 = mutateTable([ELVES], { hand: ['Test Star Elk', 'Test Plain Mutant', 'Test Doom'], defs: [STARELK, PLAINMUT, SPELL1, ROCK, WALL, RING, DOOM] });
    const s = structuredClone(s0);
    s.zones.library.p1 = [];
    for (const n of library) {
      const id = `o${s.counters.object++}`;
      s.objects[id] = { ...structuredClone(s.objects[s.zones.hand.p1![0]!]!), id, cardId: `c${s.counters.card++}`, defId: n, zone: 'library', timestamp: s.counters.timestamp++ };
      s.zones.library.p1.push(id);
    }
    return s;
  };

  it('first mutate (X = 1): cards are exiled until one permanent card is; it enters, the instant above it stays in exile', () => {
    const s0 = start(lib);
    const s = resolveTop(resolveTop(mutateCast(s0, find(s0, ELVES, 'battlefield'), 'Test Star Elk'), [OVER]));
    expect(mine(s, 'Test Grey Rock')).toBe(1);
    expect(exiledNames(s)).toEqual(['Test Spark Note']);
    expect(s.zones.library.p1!.length).toBe(4);
  });

  it('second mutate (X = 2): two more permanent cards, the non-permanent ones in between stay exiled (CR 107.3: X counts both merges)', () => {
    const s0 = start(lib);
    let s = resolveTop(resolveTop(mutateCast(s0, find(s0, ELVES, 'battlefield'), 'Test Star Elk'), [OVER]));
    const merged = s.zones.battlefield.find((x) => (s.objects[x]!.components ?? []).length > 0)!;
    s = resolveTop(resolveTop(mutateCast(s, merged, 'Test Plain Mutant'), [{ kind: 'chooseOption', ids: ['under'] }]));
    expect(mine(s, 'Test Grey Rock')).toBe(2);
    expect(mine(s, 'Test Moss Wall')).toBe(1);
    expect(exiledNames(s).sort()).toEqual(['Test Spark Note', 'Test Spark Note']);
    expect(s.zones.library.p1!.length).toBe(1);
  });

  it('negative: fewer permanent cards than X: the whole library is exiled and the permanent cards found enter; an Aura with nothing to enchant stays in exile', () => {
    const s0 = start(['Test Spark Note', 'Test Rust Ring', 'Test Spark Note']);
    const s = resolveTop(resolveTop(mutateCast(s0, find(s0, ELVES, 'battlefield'), 'Test Star Elk'), [OVER]));
    expect(s.zones.library.p1!.length).toBe(1); // stopped at the Aura (one permanent card)
    expect(exiledNames(s).sort()).toEqual(['Test Rust Ring', 'Test Spark Note']); // CR 303.4g: it can't enter, it stays in exile
    const s1 = start(['Test Spark Note', 'Test Spark Note']);
    const t = resolveTop(resolveTop(mutateCast(s1, find(s1, ELVES, 'battlefield'), 'Test Star Elk'), [OVER]));
    expect(t.zones.library.p1!.length).toBe(0);
    expect(exiledNames(t)).toEqual(['Test Spark Note', 'Test Spark Note']);
  });

  it('CR 608.2h (review): the creature destroyed with the trigger on the stack: X is the times it had mutated as it last existed', () => {
    const s0 = start(lib);
    let s = resolveTop(mutateCast(s0, find(s0, ELVES, 'battlefield'), 'Test Star Elk'), [OVER]); // the mutating spell resolved; the trigger waits
    expect(s.zones.stack.length).toBe(1);
    const merged = s.zones.battlefield.find((x) => (s.objects[x]!.components ?? []).length > 0)!;
    s = toP1x(s);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom', 'hand') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: merged }] }]);
    s = resolveTop(s); // Doom
    expect(s.zones.battlefield).not.toContain(merged); // gone before its trigger resolves
    expect(s.zones.stack.length).toBe(1);
    s = resolveTop(toP1x(s)); // the mutate trigger
    expect(mine(s, 'Test Grey Rock')).toBe(1);
  });

  it('negative: cast as an ordinary creature spell it never mutates: nothing is exiled', () => {
    const s0 = start(lib);
    const s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Star Elk', 'hand') }));
    const t = resolveTop(s);
    expect(t.zones.exile.length).toBe(0);
  });
});

// --- Wastescape Battlemage: "Kicker {G} and/or {1}{U}. When you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent
// controls. When you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand." ---
const WMAGE = card('Test Waste Adept', 'Creature — Eldrazi Wizard', "Kicker {G} and/or {1}{U}\nWhen you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.\nWhen you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand.", { pt: ['2', '2'], cost: '{1}' });
const OPPROCK = card('Test Foe Idol', 'Artifact', '{T}: You gain 1 life.', { cost: '{1}' });
const OPPBEAR = card('Test Foe Bear', 'Creature — Bear', 'Vigilance', { pt: ['2', '2'], cost: '{1}{G}' });

describe('Wastescape Battlemage: a cast trigger of the spell itself, "if it was kicked with its {G} kicker" (CR 702.33f, 603.4, 113.6k, 601.2i)', () => {
  const board = (): GameState => scenario(['Forest', 'Island'], { defs: [WMAGE, OPPROCK, OPPBEAR], p1: { hand: ['Test Waste Adept'], battlefield: [...lands('Forest', 3), ...lands('Island', 3)] }, p2: { battlefield: ['Test Foe Idol', 'Test Foe Bear'] } });
  const tgt = (s: GameState, name: string) => ({ kind: 'chooseTargets' as const, targets: [{ kind: 'object' as const, id: find(s, name, 'battlefield', 'p2') }] });
  const onStack = (s: GameState): number => s.zones.stack.length;

  it('kicked with its {G} kicker only: the first trigger goes on the stack above the spell and exiles the artifact; the {1}{U} one does not trigger', () => {
    const s0 = board();
    let s = castWith(s0, 'Test Waste Adept', [yes, no]);
    s = drive(s, [tgt(s0, 'Test Foe Idol')]);
    expect(onStack(s)).toBe(2); // the spell and one trigger
    s = resolveAll(s);
    expect(names(s, s.zones.exile)).toContain('Test Foe Idol');
    expect(find(s, 'Test Foe Bear', 'battlefield', 'p2')).toBeDefined();
    expect(find(s, 'Test Waste Adept', 'battlefield')).toBeDefined();
  });

  it('kicked with its {1}{U} kicker only: the creature returns to its owner\'s hand, the artifact stays', () => {
    const s0 = board();
    let s = castWith(s0, 'Test Waste Adept', [no, yes]);
    s = drive(s, [tgt(s0, 'Test Foe Bear')]);
    expect(onStack(s)).toBe(2);
    s = resolveAll(s);
    expect(names(s, s.zones.hand.p2!)).toContain('Test Foe Bear');
    expect(find(s, 'Test Foe Idol', 'battlefield', 'p2')).toBeDefined();
  });

  it('negative: not kicked: neither trigger (CR 603.4); both kickers: both trigger', () => {
    const s = castWith(board(), 'Test Waste Adept', [no, no]);
    expect(onStack(s)).toBe(1);
    const s0 = board();
    let t = castWith(s0, 'Test Waste Adept', [yes, yes]);
    t = drive(t, [tgt(s0, 'Test Foe Idol'), tgt(s0, 'Test Foe Bear')]);
    if (t.pending?.kind === 'chooseTargets') t = drive(t, [tgt(s0, 'Test Foe Bear')]);
    expect(onStack(t)).toBe(3);
  });
});

// --- Altar of the Wretched // Wretched Bonemass: "This creature has flying as long as an exiled card used to craft it has flying. The same is true for first strike, ...,
// protection, reach, trample, and vigilance." ---
const BONE = compileCard({
  name: 'Test Bone Altar // Test Bone Heap', layout: 'transform', mana_cost: '', type_line: 'Artifact // Creature — Skeleton Horror', oracle_text: '', colors: [], keywords: [],
  card_faces: [
    { name: 'Test Bone Altar', mana_cost: '{2}{B}', type_line: 'Artifact', oracle_text: 'Craft with one or more creatures {0}' },
    { name: 'Test Bone Heap', mana_cost: '', type_line: 'Creature — Skeleton Horror', oracle_text: "Test Bone Heap's power and toughness are each equal to the total power of the exiled cards used to craft it.\nThis creature has flying as long as an exiled card used to craft it has flying. The same is true for first strike, double strike, deathtouch, haste, hexproof, indestructible, lifelink, menace, protection, reach, trample, and vigilance." },
  ],
} as unknown as OracleCard);
const HAWK = card('Test Sky Hawk', 'Creature — Bird', 'Flying', { pt: ['2', '1'], cost: '{1}{W}' });
const WARDED = card('Test Red Warden', 'Creature — Knight', 'Protection from red\nWard {2}', { pt: ['3', '3'], cost: '{2}{W}' });
const OAF2 = card('Test Dull Oaf', 'Creature — Ogre', '', { pt: ['4', '4'], cost: '{3}' });

describe('Wretched Bonemass: the listed keywords of the exiled cards used to craft it, while they stay exiled (CR 702.167c, 613.1f, 611.3a, 702.16a)', () => {
  function drive2(s0: GameState, materials: string[] = []): GameState {
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: materials.length > 0 ? materials.length : p.min });
      else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: materials.length > 0 ? materials.filter((x) => p.options.includes(x)) : p.options.slice(0, p.min) });
      else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
      else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return s;
  }
  function crafted(graveyard: string[], materials: string[]): GameState {
    const s0 = scenario([], { defs: [BONE, HAWK, WARDED, OAF2], p1: { battlefield: ['Test Bone Altar // Test Bone Heap'], graveyard } });
    const alt = find(s0, 'Test Bone Altar // Test Bone Heap', 'battlefield', 'p1');
    const a = legal(s0, 'p1', 'activate').find((x) => x.object === alt && !x.isMana)!;
    let s = drive2(act(s0, a.action), materials.map((n) => find(s0, n, 'graveyard', 'p1')));
    for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive2(passBoth(s));
    return s;
  }
  const heap = (s: GameState) => getChars(s, find(s, 'Test Bone Altar // Test Bone Heap', 'battlefield', 'p1'));
  const kws = (s: GameState): string[] => heap(s).keywords.map((k) => (k.quality ? `${k.keyword}:${k.quality}` : k.keyword)).sort();

  it('crafted with a flier and a creature with protection from red and ward: flying and protection from red (its quality kept), not ward (not listed); P/T the total power', () => {
    const s = crafted(['Test Sky Hawk', 'Test Red Warden', 'Test Dull Oaf'], ['Test Sky Hawk', 'Test Red Warden']);
    expect(kws(s)).toEqual(['flying', 'protection:color:R']);
    expect(Number(heap(s).power)).toBe(5);
  });

  it('negative: crafted with a creature without any listed keyword: none', () => {
    const s = crafted(['Test Dull Oaf'], ['Test Dull Oaf']);
    expect(kws(s)).toEqual([]);
  });

  it('CR 611.3a, 702.167c: a card that leaves exile is no longer used to craft it: flying is lost', () => {
    let s = crafted(['Test Sky Hawk', 'Test Dull Oaf'], ['Test Sky Hawk', 'Test Dull Oaf']);
    expect(kws(s)).toEqual(['flying']);
    const hawk = s.zones.exile.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Sky Hawk')!;
    s = structuredClone(s);
    s.zones.exile = s.zones.exile.filter((x) => x !== hawk);
    s.objects[hawk]!.zone = 'graveyard';
    s.zones.graveyard.p1!.push(hawk);
    expect(kws(s)).toEqual([]);
  });
});

// --- Soulfire Eruption: "Choose any number of target creatures, planeswalkers, and/or players. For each of them, exile the top card of your library, then Soulfire Eruption deals
// damage equal to that card's mana value to that permanent or player. You may play the exiled cards until the end of your next turn." ---
const ERUPT = card('Test Soul Burst', 'Sorcery', "Choose any number of target creatures, planeswalkers, and/or players. For each of them, exile the top card of your library, then Test Soul Burst deals damage equal to that card's mana value to that permanent or player. You may play the exiled cards until the end of your next turn.", { cost: '{R}' });
const MV3 = card('Test Heavy Idol', 'Artifact', '{T}: You gain 1 life.', { cost: '{3}' });
const MV1 = card('Test Light Idol', 'Artifact', '{T}: You gain 1 life.', { cost: '{1}' });
const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', { pt: ['5', '5'], cost: '{4}' });

describe('Soulfire Eruption: for each target, one at a time, exile the top card and deal damage equal to its mana value; the exiled cards may be played (CR 608.2f, 120.3, 202.3)', () => {
  const board = (): GameState => scenario(['Mountain'], { defs: [ERUPT, MV3, MV1, OGRE], p1: { hand: ['Test Soul Burst'], battlefield: lands('Mountain', 6), library: ['Test Heavy Idol', 'Test Light Idol', 'Test Light Idol'] }, p2: { battlefield: ['Test Big Ogre'] } });
  const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  const toMain = (s: GameState): GameState => until(s, (t) => t.turn.activePlayer === 'p1' && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0 && t.turn.number > s.turn.number);

  it('CR 608.2f: two targets of one player, in the order chosen: the player is dealt 3 (the first card), the creature 1 (the second); both cards may be played', () => {
    const s0 = board();
    const ogre = find(s0, 'Test Big Ogre', 'battlefield', 'p2');
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Soul Burst', 'hand') }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }, { kind: 'object', id: ogre }] }]);
    const before = life(s, 'p2');
    const libBefore = s.zones.library.p1!.length;
    s = resolveTop(s);
    if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as { items: { id: string }[] }).items.map((i) => i.id) });
    s = drive(s);
    const dealtPlayer = before - life(s, 'p2');
    const dealtOgre = s.objects[ogre]!.damage;
    expect([dealtPlayer, dealtOgre].sort()).toEqual([1, 3]); // one card each, in order: 3 then 1
    expect(names(s, s.zones.exile).sort()).toEqual(['Test Heavy Idol', 'Test Light Idol']);
    expect(s.zones.library.p1!.length).toBe(libBefore - 2);
    const heavy = s.zones.exile.find((x) => names(s, [x])[0] === 'Test Heavy Idol')!;
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === heavy)).toBe(true); // CR 611.2a: until the end of your next turn
  });

  it('negative: no target chosen: nothing is exiled and no damage is dealt', () => {
    const s0 = board();
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Soul Burst', 'hand') }), [{ kind: 'chooseTargets', targets: [] }]);
    s = drive(resolveTop(s));
    expect(s.zones.exile.length).toBe(0);
    expect(life(s, 'p2')).toBe(life(s0, 'p2'));
  });

  it('CR 611.2a: the permission lasts through your next turn and ends after it', () => {
    const s0 = board();
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Soul Burst', 'hand') }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    s = drive(resolveTop(s));
    const heavy = s.zones.exile.find((x) => names(s, [x])[0] === 'Test Heavy Idol')!;
    s = toMain(s); // p1's next turn
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === heavy)).toBe(true);
    s = toMain(s); // the turn after
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === heavy)).toBe(false);
  });
});

// --- Shadow of the Grave: "Return to your hand all cards in your graveyard that you cycled or discarded this turn." ---
const SHADOW = card('Test Grave Echo', 'Instant', 'Return to your hand all cards in your graveyard that you cycled or discarded this turn.', { cost: '{0}' });
const RUMMAGE = card('Test Quick Rummage', 'Instant', 'Discard a card.', { cost: '{0}' });
const CYCLER = card('Test Cycling Rock', 'Artifact', 'Cycling {0}', { cost: '{5}' });
const FODDER = card('Test Old Bone', 'Creature — Skeleton', '', { pt: ['1', '1'], cost: '{1}' });
const MILLER = card('Test Self Mill', 'Instant', 'Mill a card.', { cost: '{0}' });

describe('Shadow of the Grave: the cards in your graveyard you cycled or discarded this turn (CR 701.9a, 702.29a, 400.7; ruling 2017-04-18)', () => {
  const board = (): GameState => scenario([], { defs: [SHADOW, RUMMAGE, CYCLER, FODDER, MILLER], p1: { hand: ['Test Grave Echo', 'Test Quick Rummage', 'Test Cycling Rock', 'Test Old Bone', 'Test Self Mill'], graveyard: ['Test Old Bone'], library: ['Test Old Bone', 'Test Old Bone', 'Test Old Bone'] } });
  const inHand = (s: GameState): string[] => names(s, s.zones.hand.p1!).sort();
  const main = (s: GameState): GameState => until(s, (t) => t.turn.activePlayer === 'p1' && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);

  it('CR 702.29a, 701.9a: a card cycled and a card discarded to a spell this turn return; a card already there and a card milled this turn stay', () => {
    let s = main(board());
    // cycle the rock (it is discarded)
    const rock = find(s, 'Test Cycling Rock', 'hand');
    const cyc = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === rock)!;
    s = resolveTop(drive(act(s, cyc.action)));
    s = toP1x(s);
    // discard the Bone in hand to the rummage
    s = cast(s, 'Test Quick Rummage');
    s = resolveTop(s);
    if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Old Bone', 'hand')] });
    s = toP1x(drive(s));
    s = toP1x(resolveTop(cast(s, 'Test Self Mill')));
    const gy = names(s, s.zones.graveyard.p1!).sort();
    expect(gy.filter((n) => n === 'Test Old Bone').length).toBe(3); // the old one, the discarded one, the milled one
    s = toP1x(resolveTop(cast(s, 'Test Grave Echo')));
    const hand = inHand(s);
    expect(hand.filter((n) => n === 'Test Cycling Rock').length).toBe(1);
    expect(names(s, s.zones.graveyard.p1!).filter((n) => n === 'Test Old Bone').length).toBe(2); // only the discarded Bone returned
    expect(hand.filter((n) => n === 'Test Old Bone').length).toBeGreaterThanOrEqual(1);
  });

  it('negative: a card discarded on an earlier turn does not return', () => {
    let s = main(board());
    s = cast(s, 'Test Quick Rummage');
    s = resolveTop(s);
    if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Test Old Bone', 'hand')] });
    s = drive(s);
    const turn = s.turn.number;
    s = until(s, (t) => t.turn.number > turn && t.turn.activePlayer === 'p1' && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
    const before = names(s, s.zones.graveyard.p1!).filter((n) => n === 'Test Old Bone').length;
    s = toP1x(resolveTop(cast(s, 'Test Grave Echo')));
    expect(names(s, s.zones.graveyard.p1!).filter((n) => n === 'Test Old Bone').length).toBe(before);
  });
});
function toP1x(s: GameState): GameState { return s.pending?.kind === 'priority' && s.pending.player !== 'p1' ? next(s) : s; }

// --- Uba Mask: "If a player would draw a card, that player exiles that card face up instead. Each player may play lands and cast spells from among cards they exiled with this
// artifact this turn." ---
const MASK = card('Test Ghost Mask', 'Artifact', 'If a player would draw a card, that player exiles that card face up instead.\nEach player may play lands and cast spells from among cards they exiled with this artifact this turn.', { cost: '{4}' });
const FLASHY = card('Test Quick Gain', 'Instant', 'You gain 3 life.', { cost: '{0}' });

describe('Uba Mask: a draw is an exile instead, each player may play the cards THEY exiled with it this turn (CR 614.1a, 121.1, 607.2a, 601.3, 305.1; rulings 2004-12-01)', () => {
  const board = (): GameState => scenario(['Forest'], { defs: [MASK, FLASHY], p1: { battlefield: ['Test Ghost Mask'], library: ['Forest', 'Test Quick Gain', 'Forest'] }, p2: { library: ['Forest', 'Test Quick Gain', 'Forest'] } });
  const p1Main = (s: GameState): GameState => until(s, (t) => t.turn.activePlayer === 'p1' && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.pending.player === 'p1' && t.zones.stack.length === 0 && t.turn.number > s.turn.number);
  const p2Main = (s: GameState): GameState => until(s, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
  const exiledOf = (s: GameState, owner: string): string[] => s.zones.exile.filter((x) => s.objects[x]!.owner === owner);

  it('CR 614.1a, 121.1: p1\'s draw step draw exiles the top card face up instead; p1 may play it (a land, CR 305.1) this turn', () => {
    const s0 = board();
    const hand0 = s0.zones.hand.p1!.length;
    const s = p1Main(s0);
    expect(s.zones.hand.p1!.length).toBe(hand0); // nothing drawn
    const ex = exiledOf(s, 'p1');
    expect(ex.length).toBe(1);
    expect(s.objects[ex[0]!]!.faceDown).toBe(false);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'playLand' && a.object === ex[0])).toBe(true);
  });

  it('negative: p2 may not play the card p1 exiled; p1 may not play p2\'s; p2 may cast its own instant (CR 607.2a: "cards they exiled")', () => {
    let s = p1Main(board());
    const p1card = exiledOf(s, 'p1')[0]!;
    s = p2Main(s);
    const p2card = exiledOf(s, 'p2').at(-1)!; // the card p2 exiled this turn (turn 2's is an earlier one)
    expect(s.defs[s.objects[p2card]!.defId]!.name).toBe('Test Quick Gain');
    expect(legalActions(s, 'p2').some((a) => a.object === p1card)).toBe(false);
    expect(legalActions(s, 'p2').some((a) => a.kind === 'cast' && a.object === p2card)).toBe(true);
    const p1Prio = until(s, (t) => t.pending?.kind === 'priority' && t.pending.player === 'p1');
    expect(legalActions(p1Prio, 'p1').some((a) => a.object === p2card)).toBe(false);
  });

  it('ruling 2004-12-01: a card exiled with it on an earlier turn can no longer be played; it stays exiled', () => {
    let s = p1Main(board());
    const first = exiledOf(s, 'p1')[0]!;
    s = p1Main(s); // p1's next turn
    expect(s.zones.exile).toContain(first);
    expect(legalActions(s, 'p1').some((a) => a.object === first)).toBe(false);
  });
});

// --- Candlekeep Inspiration: "Until end of turn, creatures you control have base power and toughness X/X, where X is the number of cards you own in exile and in your graveyard that
// are instant cards, are sorcery cards, and/or have an Adventure." ---
const INSPIRE = card('Test Library Muse', 'Sorcery', 'Until end of turn, creatures you control have base power and toughness X/X, where X is the number of cards you own in exile and in your graveyard that are instant cards, are sorcery cards, and/or have an Adventure.', { cost: '{0}' });
const INST = card('Test Old Quick', 'Instant', 'You gain 1 life.', { cost: '{0}' });
const SORC = card('Test Old Slow', 'Sorcery', 'You gain 1 life.', { cost: '{0}' });
const ADV = compileCard({ name: 'Test Knight // Test Quest', layout: 'adventure', mana_cost: '', type_line: 'Creature — Human Knight // Sorcery — Adventure', oracle_text: '', colors: [], keywords: [], power: '2', toughness: '2',
  card_faces: [{ name: 'Test Knight', mana_cost: '{1}{W}', type_line: 'Creature — Human Knight', oracle_text: 'Vigilance', power: '2', toughness: '2' }, { name: 'Test Quest', mana_cost: '{W}', type_line: 'Sorcery — Adventure', oracle_text: 'You gain 2 life.' }] } as unknown as OracleCard);
const BEAST = card('Test Small Beast', 'Creature — Beast', '', { pt: ['1', '1'], cost: '{G}' });

describe('Candlekeep Inspiration: base P/T X/X, X counted once among your exiled and graveyard cards of three kinds (CR 613.4b, 608.2h, 611.2c, 715.1; rulings 2022-06-10)', () => {
  const pt = (s: GameState, id: string): [number, number] => { const c = getChars(s, id); return [Number(c.power), Number(c.toughness)]; };
  it('CR 608.2h: an instant and an Adventurer in the graveyard and a sorcery in exile count (X = 3); a creature card and an opponent\'s instant do not', () => {
    const s0 = scenario([], { defs: [INSPIRE, INST, SORC, ADV, BEAST], p1: { hand: ['Test Library Muse'], battlefield: ['Test Small Beast'], graveyard: ['Test Old Quick', 'Test Knight // Test Quest', 'Test Small Beast'], exile: ['Test Old Slow'] }, p2: { graveyard: ['Test Old Quick'] } });
    const beast = find(s0, 'Test Small Beast', 'battlefield');
    const s = resolveTop(cast(s0, 'Test Library Muse'));
    expect(pt(s, beast)).toEqual([3, 3]); // base 3/3: the Muse itself is still on the stack as X is counted (CR 608.2n), so it is not counted
  });
  it('rulings 2022-06-10: X is locked in as it resolves, and so is the set of creatures', () => {
    const s0 = scenario([], { defs: [INSPIRE, INST, SORC, ADV, BEAST], p1: { hand: ['Test Library Muse', 'Test Old Quick'], battlefield: ['Test Small Beast'], graveyard: ['Test Old Quick'] } });
    const beast = find(s0, 'Test Small Beast', 'battlefield');
    let s = resolveTop(cast(s0, 'Test Library Muse'));
    const after = pt(s, beast);
    s = resolveTop(cast(s, 'Test Old Quick')); // one more instant card in the graveyard
    expect(pt(s, beast)).toEqual(after);
  });
});
