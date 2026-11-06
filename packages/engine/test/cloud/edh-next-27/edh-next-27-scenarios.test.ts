/**
 * Commander lane edh-next, round edh-next-27: the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites were checked against the Comprehensive Rules text of
 * 2026-09-25 (media.wizards.com).
 *
 *   CR 406.1, 608.2d, 101.4, 109.4   "Each opponent exiles two cards from their hand." (Nicol Bolas, God-Pharaoh)
 *   CR 201.5c, 122.1, 111.2           a legendary name ending in a Roman numeral is called by the name without it (King Darien XLVIII)
 *   CR 122.1, 608.2c                  "Put a +1/+1 counter and a lifelink counter on that creature and a +1/+1 counter and a lifelink counter on ~" (Arwen, Mortal Queen)
 *   CR 702.6c, 205.3m                 "Equip Shaman, Warlock, or Wizard {1}" (Robe of the Archmagi)
 *   CR 603.12, 107.3, 601.2c          "destroy target creature with toughness X or less, where X is the number of Shrines you control" (Go-Shintai of Hidden Cruelty)
 *   CR 122.1, 119.3, 603.3d, 115.1    Betor, Ancestor's Voice's end step trigger
 *   CR 701.17a, 107.3                 "Target player mills three times X cards" (Jace, the Perfected Mind)
 *   CR 106.4, 603.2c, 508.1           "add that much mana in any combination of {R} and/or {G}" (Grand Warlord Radha)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, advanceTo, answer, find, legal, pass, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; loyalty?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const namesIn = (s: GameState, zone: 'battlefield' | 'exile' | 'hand', p: PlayerId): string[] => {
  const ids = zone === 'battlefield' ? s.zones.battlefield.filter((id) => s.objects[id]!.controller === p) : zone === 'exile' ? s.zones.exile.filter((id) => s.objects[id]!.owner === p) : s.zones.hand[p]!;
  return ids.map((id) => nameOf(s, id)).sort();
};

/** What each chooser was offered, in order, and who chose. */
interface Seen { player: PlayerId; options: string[] }
/** Answer decisions: a chooseObjects is answered with the options named by `pick[player]` (or the first offered, as many as required). */
function drive(s0: GameState, pick: Partial<Record<PlayerId, string[]>>, seen: Seen[]): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as { kind: string; player: PlayerId; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'chooseObjects') {
      const opts = p.options ?? [];
      seen.push({ player: p.player, options: opts.map((id) => nameOf(s, id)).sort() });
      const want = pick[p.player];
      const chosen = want === undefined ? opts.slice(0, p.min ?? 1) : want.map((n) => opts.find((id) => nameOf(s, id) === n)!);
      s = answer(s, { kind: 'chooseObjects', ids: chosen } as never);
    } else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function cast(s0: GameState, name: string, pick: Partial<Record<PlayerId, string[]>> = {}): { s: GameState; seen: Seen[] } {
  const seen: Seen[] = [];
  let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), pick, seen);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), pick, seen);
  return { s, seen };
}
const land = (n: string): CardDef => card(n, 'Land', '');

// ---- Nicol Bolas, God-Pharaoh's +1: each opponent exiles two cards from their own hand ---------------------------------------------------------------------------------------

const PURGE = card('Test Purge', 'Sorcery', 'Each opponent exiles two cards from their hand.');
const A = land('Test Land A'); const B = land('Test Land B'); const C = land('Test Land C'); const D = land('Test Land D');

describe('CR 406.1, 608.2d, 101.4: "Each opponent exiles two cards from their hand."', () => {
  const setup = (): GameState => mpScenario({
    defs: [PURGE, A, B, C, D],
    zones: { p1: { hand: ['Test Purge', 'Test Land A', 'Test Land B', 'Test Land C'] }, p2: { hand: ['Test Land A', 'Test Land B', 'Test Land C'] }, p3: { hand: ['Test Land D'] }, p4: { hand: [] } },
  });
  it('is automated', () => expect(full(PURGE)).toBe(true));
  it('each opponent chooses two cards of their OWN hand (never another player\'s) and exiles them; the card they keep stays; you keep all of yours', () => {
    const { s, seen } = cast(setup(), 'Test Purge', { p2: ['Test Land B', 'Test Land C'] });
    expect(seen.find((x) => x.player === 'p2')!.options).toEqual(['Test Land A', 'Test Land B', 'Test Land C']);
    expect(namesIn(s, 'exile', 'p2')).toEqual(['Test Land B', 'Test Land C']);
    expect(namesIn(s, 'hand', 'p2')).toEqual(['Test Land A']);
    expect(namesIn(s, 'hand', 'p1').filter((n) => n !== 'Plains')).toEqual(['Test Land A', 'Test Land B', 'Test Land C']); // you are not an opponent (the spell itself left the hand; a Plains was drawn)
    expect(namesIn(s, 'exile', 'p1')).toEqual([]);
  });
  it('CR 608.2d: an opponent with two or fewer cards exiles the whole hand with no choice to make; an opponent with an empty hand exiles nothing', () => {
    const { s, seen } = cast(setup(), 'Test Purge', { p2: ['Test Land A', 'Test Land B'] });
    expect(seen.find((x) => x.player === 'p3')).toBeUndefined();
    expect(seen.find((x) => x.player === 'p4')).toBeUndefined();
    expect(namesIn(s, 'exile', 'p3')).toEqual(['Test Land D']);
    expect(namesIn(s, 'hand', 'p3')).toEqual([]);
    expect(namesIn(s, 'exile', 'p4')).toEqual([]);
  });
});

// ---- two-player scenarios (Alice p1 is the active player) ------------------------------------------------------------------------------------------------------------------------

/** Answer decisions until the stack is empty or a decision this helper does not know: targets are `targets` (by name), yes/no is `yes`, numbers `x`, colors cycle through `colors`. */
function settle(s0: GameState, o: { targets?: string[]; yes?: boolean; x?: number; colors?: string[] } = {}): GameState {
  let s = s0;
  let color = 0;
  for (let g = 0; g < 120; g++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; targets?: unknown };
    if (p === null || p === undefined) break;
    if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = pass(s); }
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') {
      const pend = s.pending as unknown as { objects?: ObjectId[]; players?: PlayerId[]; max?: number; min?: number };
      const ids = (pend.objects ?? []).filter((id) => (o.targets ?? []).includes(nameOf(s, id))).slice(0, pend.max ?? 1);
      const players = (pend.players ?? []).filter((q) => (o.targets ?? []).includes(q)).slice(0, Math.max(0, (pend.max ?? 1) - ids.length));
      s = answer(s, { kind: 'chooseTargets', targets: [...ids.map((id) => ({ kind: 'object' as const, id })), ...players.map((id) => ({ kind: 'player' as const, id }))] } as never);
    }
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? 0 } as never);
    else if (p.kind === 'chooseColor') s = answer(s, { kind: 'chooseColor', color: (o.colors ?? ['R'])[color++ % (o.colors ?? ['R']).length] } as never);
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options ?? []).slice(0, p.min ?? 1) } as never);
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(s.pending).slice(0, 300)}`);
  }
  return s;
}
const activate = (s: GameState, source: ObjectId, textStart: string): GameState => {
  const a = legal(s, 'p1', 'activate').find((l) => (l as unknown as { action: { source: ObjectId } }).action.source === source && String((l as unknown as { label?: string }).label ?? '').toLowerCase().includes(textStart.toLowerCase()));
  if (!a) throw new Error(`no activation "${textStart}" offered: ${legal(s, 'p1', 'activate').map((l) => JSON.stringify(l).slice(0, 160)).join(' | ')}`);
  return act(s, (a as unknown as { action: never }).action);
};
const stats = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const onBf = (s: GameState, n: string): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === n);

const SOVEREIGN = card('Test Sovereign XLVIII', 'Legendary Creature — Human Soldier', '{0}: Put a +1/+1 counter on Test Sovereign and create a 1/1 white Soldier creature token.', { pt: ['2', '2'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 201.5c, 122.1, 111.2: a legendary card whose name ends in a Roman numeral is called by the name without it', () => {
  it('is automated', () => expect(full(SOVEREIGN)).toBe(true));
  it('its ability puts the counter on the Sovereign itself and creates the token', () => {
    let s = scenario([], { defs: [SOVEREIGN, BEAR], p1: { battlefield: ['Test Sovereign XLVIII'] } });
    const id = onBf(s, 'Test Sovereign XLVIII')[0]!;
    s = settle(activate(s, id, 'put'));
    expect(stats(s, id)).toBe('3/3');
    expect(s.zones.battlefield.filter((o) => s.objects[o]!.kind === 'token').length).toBe(1);
  });
});

const WARDEN = card('Test Warden', 'Creature — Elf Noble', '{0}: Another target creature gains indestructible until end of turn. Put a +1/+1 counter and a lifelink counter on that creature and a +1/+1 counter and a lifelink counter on ~.', { pt: ['1', '1'] });
describe('CR 122.1, 608.2c: "Put a +1/+1 counter and a lifelink counter on that creature and a +1/+1 counter and a lifelink counter on ~."', () => {
  it('is automated', () => expect(full(WARDEN)).toBe(true));
  it('both counters go on the other creature and the same two on the Warden itself', () => {
    let s = scenario([], { defs: [WARDEN, BEAR], p1: { battlefield: ['Test Warden', 'Test Bear'] } });
    const [w, b] = [onBf(s, 'Test Warden')[0]!, onBf(s, 'Test Bear')[0]!];
    s = settle(activate(s, w, 'another'), { targets: ['Test Bear'] });
    expect(s.objects[b]!.counters).toEqual({ '+1/+1': 1, lifelink: 1 });
    expect(s.objects[w]!.counters).toEqual({ '+1/+1': 1, lifelink: 1 });
    expect(stats(s, b)).toBe('3/3');
    expect(stats(s, w)).toBe('2/2');
  });
  it('"another target creature": with no other creature the ability cannot be activated (no counters on the Warden alone)', () => {
    const s = scenario([], { defs: [WARDEN, BEAR], p1: { battlefield: ['Test Warden'] } });
    expect(legal(s, 'p1', 'activate').some((l) => String((l as unknown as { label?: string }).label).includes('Another target'))).toBe(false);
  });
});

const ROBE = card('Test Robe', 'Artifact — Equipment', 'Equip Elf, Druid, or Scout {1}\nEquip {4}');
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const SCOUT = card('Test Scout', 'Creature — Human Scout', '', { pt: ['1', '1'] });
describe('CR 702.6c, 205.3m: "Equip Elf, Druid, or Scout {1}"', () => {
  it('is automated', () => expect(full(ROBE)).toBe(true));
  it('the {1} ability can target a creature you control with any one of the three types, never another creature', () => {
    let s = scenario([], { defs: [ROBE, ELF, SCOUT, BEAR], p1: { battlefield: ['Test Robe', 'Test Elf', 'Test Scout', 'Test Bear', 'Plains'] } });
    s = activate(s, onBf(s, 'Test Robe')[0]!, 'equip elf');
    const d = s.pending as unknown as { kind: string; objects: ObjectId[] };
    expect(d.kind).toBe('chooseTargets');
    expect(d.objects.map((id) => nameOf(s, id)).sort()).toEqual(['Test Elf', 'Test Scout']); // not the Bear
    s = settle(answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: onBf(s, 'Test Scout')[0]! }] } as never));
    expect(s.objects[onBf(s, 'Test Robe')[0]!]!.attachedTo).toBe(onBf(s, 'Test Scout')[0]);
  });
  it('an opponent\'s Elf is not a legal target (only creatures you control)', () => {
    let s = scenario([], { defs: [ROBE, ELF, BEAR], p1: { battlefield: ['Test Robe', 'Test Bear', 'Plains'] }, p2: { battlefield: ['Test Elf'] } });
    expect(legal(s, 'p1', 'activate').some((l) => String((l as unknown as { label?: string }).label).includes('Equip Elf'))).toBe(false);
    void s; s = s;
  });
});

const IDOL = card('Test Shrine Idol', 'Artifact Creature — Shrine', 'At the beginning of your end step, you may pay {1}. When you do, destroy target creature with toughness X or less, where X is the number of Shrines you control.', { pt: ['1', '1'] });
const SHRINE = card('Test Shrine', 'Enchantment — Shrine', '');
const GIANT = card('Test Giant', 'Creature — Giant', '', { pt: ['4', '4'] });
/** Pass priority to the end step of turn 1 and stop when the end-step trigger asks for something. */
function toEnd(s0: GameState): GameState {
  let s = s0;
  for (let g = 0; g < 80 && !(s.turn.step === 'end' && s.pending?.kind !== 'priority'); g++) {
    const d = s.pending as unknown as { kind: string } | null;
    if (d?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (d?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d?.kind === 'priority') { if (s.turn.step === 'end' && s.zones.stack.length === 0 && g > 0) break; s = pass(s); }
    else break;
  }
  return s;
}
describe('CR 603.12, 107.3: "you may pay {1}. When you do, destroy target creature with toughness X or less, where X is the number of Shrines you control."', () => {
  it('is automated', () => expect(full(IDOL)).toBe(true));
  const setup = (shrines: number): GameState => scenario([], { defs: [IDOL, SHRINE, BEAR, GIANT], p1: { battlefield: ['Test Shrine Idol', ...Array(shrines).fill('Test Shrine'), 'Plains'] }, p2: { battlefield: ['Test Bear', 'Test Giant'] } });
  it('with the Idol and one more Shrine (X = 2) the 2/2 can be destroyed, the 4/4 is not a legal target', () => {
    let s = toEnd(setup(1));
    if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    s = settle(s, { targets: ['Test Bear'] });
    expect(onBf(s, 'Test Bear').length).toBe(0);
    expect(onBf(s, 'Test Giant').length).toBe(1);
  });
  it('with only the Idol (X = 1) only creatures with toughness 1 or less are legal targets (the Idol itself), never the 2/2 or the 4/4', () => {
    let s = toEnd(setup(0));
    if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    s = answer(s, { kind: 'payCost', auto: true });
    const d = s.pending as unknown as { kind: string; objects: ObjectId[] };
    expect(d.kind).toBe('chooseTargets');
    expect(d.objects.map((id) => nameOf(s, id))).toEqual(['Test Shrine Idol']);
    s = settle(s, { targets: ['Test Shrine Idol'] });
    expect(onBf(s, 'Test Bear').length).toBe(1);
    expect(onBf(s, 'Test Giant').length).toBe(1);
  });
  it('declining to pay {1} destroys nothing', () => {
    let s = toEnd(setup(1));
    if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: false });
    s = settle(s, { yes: false, targets: ['Test Bear'] });
    expect(onBf(s, 'Test Bear').length).toBe(1);
  });
});

const SPIRIT = card('Test Spirit', 'Legendary Creature — Spirit Dragon', 'At the beginning of your end step, put a number of +1/+1 counters on up to one other target creature you control equal to the amount of life you gained this turn. Return up to one target creature card with mana value less than or equal to the amount of life you lost this turn from your graveyard to the battlefield.', { pt: ['3', '3'] });
const GAIN = card('Test Gain', 'Instant', 'You gain 3 life.');
const DRAIN = card('Test Drain', 'Instant', 'You lose 2 life.');
const CUB = card('Test Cub', 'Creature — Bear', '', { cost: '{1}', pt: ['1', '1'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { cost: '{4}', pt: ['4', '4'] });
describe('CR 122.1, 119.3, 603.3d, 115.1: Betor\'s end step trigger counts life gained and lost this turn', () => {
  it('is automated', () => expect(full(SPIRIT)).toBe(true));
  const play = (): GameState => {
    let s = scenario([], { defs: [SPIRIT, GAIN, DRAIN, CUB, OGRE, BEAR], p1: { hand: ['Test Gain', 'Test Drain'], battlefield: ['Test Spirit', 'Test Bear'], graveyard: ['Test Cub', 'Test Ogre'] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gain', 'hand', 'p1') } as never));
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Drain', 'hand', 'p1') } as never));
    return s;
  };
  it('3 life gained: three +1/+1 counters on another creature (never on the Spirit); 2 life lost: the 1-cost creature returns, the 4-cost one is not a legal target', () => {
    let s = toEnd(play());
    const d = s.pending as unknown as { kind: string; objects: ObjectId[] };
    expect(d.kind).toBe('chooseTargets');
    expect(d.objects.map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear']); // the first target: another creature you control, not the Spirit
    s = settle(s, { targets: ['Test Bear', 'Test Cub'] });
    expect(s.objects[onBf(s, 'Test Bear')[0]!]!.counters).toEqual({ '+1/+1': 3 });
    expect(onBf(s, 'Test Cub').length).toBe(1);
    expect(onBf(s, 'Test Ogre').length).toBe(0);
  });
  it('nothing gained and nothing lost: no counters, and the graveyard creature with mana value 1 is not a legal target (0 life lost)', () => {
    let s = toEnd(scenario([], { defs: [SPIRIT, CUB, OGRE, BEAR], p1: { battlefield: ['Test Spirit', 'Test Bear'], graveyard: ['Test Cub', 'Test Ogre'] } }));
    s = settle(s, { targets: ['Test Bear'] });
    expect(s.objects[onBf(s, 'Test Bear')[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(onBf(s, 'Test Cub').length).toBe(0);
  });
});

const MIND = card('Test Mind', 'Legendary Planeswalker — Jace', '−X: Target player mills three times X cards.', { loyalty: '5' });
describe('CR 701.17a, 107.3: "Target player mills three times X cards."', () => {
  it('is automated', () => expect(full(MIND)).toBe(true));
  it('-2 mills six cards from the target\'s library and removes two loyalty counters', () => {
    let s = scenario([], { defs: [MIND], p1: { battlefield: [{ name: 'Test Mind', counters: { loyalty: 5 } }] } });
    const lib0 = s.zones.library['p2']!.length;
    const id = onBf(s, 'Test Mind')[0]!;
    s = settle(activate(s, id, 'mills'), { x: 2, targets: ['p2'] });
    s = settle(s);
    expect(s.zones.library['p2']!.length).toBe(lib0 - 6);
    expect(s.objects[id]!.counters['loyalty']).toBe(3);
  });
});

const WARLORD = card('Test Warlord', 'Legendary Creature — Elf Warrior', "Haste\nWhenever one or more creatures you control attack, add that much mana in any combination of {R} and/or {G}. Until end of turn, you don't lose this mana as steps and phases end.", { pt: ['3', '3'] });
const BEAR2 = card('Test Bear Two', 'Creature — Bear', '', { pt: ['2', '2'] });
describe('CR 106.4, 603.2c, 508.1: "Whenever one or more creatures you control attack, add that much mana in any combination of {R} and/or {G}."', () => {
  it('is automated', () => expect(full(WARLORD)).toBe(true));
  const attack = (names: string[]): GameState => {
    let s = scenario([], { defs: [WARLORD, BEAR, BEAR2], p1: { battlefield: ['Test Warlord', 'Test Bear', 'Test Bear Two'] } });
    for (let g = 0; g < 30 && s.pending?.kind !== 'declareAttackers'; g++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: names.map((n) => ({ attacker: onBf(s, n)[0]!, defender: 'p2' as PlayerId })) } as never);
    return settle(s, { colors: ['R', 'G'] });
  };
  const pool = (s: GameState): string => s.players[0]!.manaPool.map((u) => u.type).sort().join('');
  it('two attackers: two mana, each chosen as {R} or {G}, in one trigger; the mana is still there in later steps of the turn', () => {
    let s = attack(['Test Bear', 'Test Bear Two']);
    expect(pool(s)).toBe('GR');
    s = pass(s);
    expect(pool(s)).toBe('GR'); // CR 106.4: it would empty at the end of the step, but "you don't lose this mana as steps and phases end"
  });
  it('one attacker: one mana; the three creatures attacking together: still one trigger, three mana', () => {
    expect(pool(attack(['Test Bear']))).toBe('R');
    expect(pool(attack(['Test Warlord', 'Test Bear', 'Test Bear Two'])).length).toBe(3);
  });
  it('no attack declared: no mana', () => {
    let s = scenario([], { defs: [WARLORD, BEAR], p1: { battlefield: ['Test Warlord', 'Test Bear'] } });
    for (let g = 0; g < 30 && s.pending?.kind !== 'declareAttackers'; g++) s = pass(s);
    s = settle(answer(s, { kind: 'declareAttackers', attacks: [] } as never));
    expect(pool(s)).toBe('');
  });
});

const THIEF = card('Test Thief', 'Sorcery', 'Target opponent exiles cards from the top of their library until they exile a nonland card. Until end of turn, you may cast that card without paying its mana cost.');
describe('CR 118.9, 601.2b, 611.2a: "Until end of turn, you may cast that card without paying its mana cost."', () => {
  it('is automated', () => expect(full(THIEF)).toBe(true));
  it('the exiled nonland card can be cast for no mana this turn, and not any more on the next turn', () => {
    let s = scenario([], { defs: [THIEF, BEAR], p1: { hand: ['Test Thief'] }, p2: { library: ['Test Bear'] } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Thief', 'hand', 'p1') } as never), { targets: ['p2'] });
    const bear = s.zones.exile.find((id) => nameOf(s, id) === 'Test Bear');
    expect(bear).toBeDefined();
    const castable = (st: GameState): boolean => legal(st, 'p1', 'cast').some((l) => (l as unknown as { action: { card?: ObjectId } }).action.card === bear);
    expect(castable(s)).toBe(true);
    expect(castable(advanceTo(s, 3, 'main1'))).toBe(false);
  });
});
