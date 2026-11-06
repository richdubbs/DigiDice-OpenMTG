/**
 * Commander lane each-player, round edh-next-72 (second round): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case.
 *
 *   CR 701.58a, 608.2c  "For each player, exile up to one target nonland permanent that player controls. For each permanent exiled this way, its controller cloaks ..." (Unexplained Absence)
 *   CR 102.3, 119.1     "For each opponent, exile up to one target creature that player controls and that player gains life equal to its power." (Luminate Primordial)
 *   CR 101.4, 608.2c    "Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card." (Kynaios and Tiro of Meletis)
 *   CR 101.4, 608.2d    "Each opponent may investigate. Each opponent who doesn't loses 1 life. You investigate X times ..." (Wernog, Rider's Chaplain)
 *   CR 104.3b, 119.1    "Each player with exactly 13 life loses the game, then each player gains 1 life." (Triskaidekaphobia)
 *   CR 101.4, 121.1     "Each player may draw up to two cards. For each card less than two a player draws this way, that player gains 2 life." (Truce, Temporary Truce)
 *   CR 701.9a, 120.3    "Each player may discard up to three cards. ~ deals damage to each player equal to 3 minus the number of cards they discarded this way." (Mind Bomb)
 *   CR 205.2a, 701.21a  "Each opponent sacrifices a permanent of their choice that shares a card type with it." (Martyr's Bond; Fatal Grudge)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): string[] => d.faces.flatMap((f) => f.abilities.filter((a) => a.kind === 'manual').map((a) => a.text));
const nameOf = (s: GameState, id: ObjectId): string => getChars(s, id)!.name;
const zoneNames = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => nameOf(s, id));
const bfIds = (s: GameState, p?: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => p === undefined || s.objects[id]!.controller === p);
const bfNames = (s: GameState, p?: PlayerId): string[] => bfIds(s, p).map((id) => nameOf(s, id));
const real = (xs: string[]): string[] => xs.filter((x) => x !== 'Plains');
const hand = (s: GameState, p: PlayerId): string[] => real(zoneNames(s, 'hand', p));
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const count = (xs: string[], n: string): number => xs.filter((x) => x === n).length;
const target = (id: ObjectId) => ({ kind: 'object', id }) as const;

interface Picks { targets?: ObjectId[]; yes?: boolean | Record<string, boolean>; n?: number | Record<string, number>; take?: 'max' | 'min' | 'none' | Record<string, 'max' | 'min' | 'none'> }
/** Answer every decision until a player has priority and the stack is empty: yes/no by `yes`, numbers by `n`, choices of objects by `take` (each per player). */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 300 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
    const p = s.pending as unknown as { kind: string; player: string; options?: ObjectId[]; min?: number; max?: number };
    const per = <T,>(v: T | Record<string, T> | undefined, d: T): T => (v !== null && typeof v === 'object' ? (v as Record<string, T>)[p.player] ?? d : v ?? d);
    if (p.kind === 'priority') s = pass(s);
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (o.targets ?? []).map(target) } as DecisionAnswer);
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: per(o.yes, true) } as DecisionAnswer);
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: Math.min(p.max ?? 99, per(o.n, p.max ?? 0)) } as never);
    else if (p.kind === 'chooseObjects') {
      const take = per(o.take, 'max');
      const n = take === 'none' ? 0 : take === 'min' ? p.min ?? 0 : Math.min(p.max ?? (p.options ?? []).length, (p.options ?? []).length);
      s = answer(s, { kind: 'chooseObjects', ids: (p.options ?? []).slice(0, n) } as DecisionAnswer);
    } else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
const cast = (s: GameState, name: string, o: Picks = {}, targets?: ObjectId[], player: PlayerId = 'p1'): GameState => {
  const t = act(s, { type: 'cast', player, card: find(s, name, 'hand', player) } as never);
  return drive(t, { ...o, ...(targets !== undefined ? { targets } : {}) });
};

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['4', '4'] });
const FOREST = card('Test Forest', 'Basic Land — Forest', '');
const GEAR = card('Test Gear', 'Artifact', '');

describe('CR 701.58a, 608.2c: "For each player, exile up to one target nonland permanent that player controls. For each permanent exiled this way, its controller cloaks the top card of their library." (Unexplained Absence)', () => {
  const ABSENCE = card('Test Absence', 'Instant', 'For each player, exile up to one target nonland permanent that player controls. For each permanent exiled this way, its controller cloaks the top card of their library.');
  const defs = [ABSENCE, BEAR, OGRE, FOREST, GEAR];
  it('is automated', () => { expect(noManual(ABSENCE)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Absence'], battlefield: ['Test Bear'], library: ['Test Forest', 'Test Forest'] }, p2: { battlefield: ['Test Ogre', 'Test Gear'], library: ['Test Forest', 'Test Ogre'] }, p3: { battlefield: ['Test Bear'], library: ['Test Ogre', 'Test Forest'] } } });
  it('each player whose permanent was chosen has it exiled and cloaks the top card of their OWN library (a face-down 2/2); a player with no chosen permanent cloaks nothing', () => {
    const s0 = start();
    const s = cast(s0, 'Test Absence', {}, [find(s0, 'Test Bear', 'battlefield', 'p1'), find(s0, 'Test Ogre', 'battlefield', 'p2')]);
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear', 'Test Ogre']);
    // p1 and p2 each have one face-down permanent that came from their own library; p3 keeps only its Bear
    const faceDown = (p: PlayerId): ObjectId[] => bfIds(s, p).filter((id) => s.objects[id]!.faceDown === true);
    expect(faceDown('p1')).toHaveLength(1);
    expect(faceDown('p2')).toHaveLength(1);
    expect(faceDown('p3')).toHaveLength(0);
    expect(s.objects[faceDown('p1')[0]!]!.owner).toBe('p1');
    expect(s.objects[faceDown('p2')[0]!]!.owner).toBe('p2');
    expect(bfNames(s, 'p3')).toEqual(['Test Bear']);
    expect(s.zones.library['p3']).toHaveLength(s0.zones.library['p3']!.length);
  });
  it('a player whose permanent was not chosen does not cloak: the Gear of p2 and every card of p3\'s library stay put', () => {
    const s0 = start();
    const s = cast(s0, 'Test Absence', {}, [find(s0, 'Test Gear', 'battlefield', 'p2')]);
    expect(bfNames(s, 'p2')).toContain('Test Ogre');
    expect(bfIds(s, 'p2').filter((id) => s.objects[id]!.faceDown === true)).toHaveLength(1);
    expect(bfIds(s, 'p1').filter((id) => s.objects[id]!.faceDown === true)).toHaveLength(0);
    expect(s.zones.library['p1']).toHaveLength(s0.zones.library['p1']!.length);
  });
});

describe('CR 102.3, 119.1, 608.2h: "When this creature enters, for each opponent, exile up to one target creature that player controls and that player gains life equal to its power." (Luminate Primordial)', () => {
  const PRIMORDIAL = card('Test Primordial', 'Creature — Avatar', 'When this creature enters, for each opponent, exile up to one target creature that player controls and that player gains life equal to its power.', { pt: ['5', '5'] });
  const defs = [PRIMORDIAL, BEAR, OGRE];
  it('is automated', () => { expect(noManual(PRIMORDIAL)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Primordial'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, p3: { battlefield: ['Test Bear'] } } });
  it('each opponent\'s chosen creature is exiled and THAT opponent gains life equal to its power (4 and 2); the caster and their own creature are untouched', () => {
    const s0 = start();
    const s = cast(s0, 'Test Primordial', {}, [find(s0, 'Test Ogre', 'battlefield', 'p2'), find(s0, 'Test Bear', 'battlefield', 'p3')]);
    expect(bfNames(s, 'p2')).toEqual([]);
    expect(bfNames(s, 'p3')).toEqual([]);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') + 4);
    expect(life(s, 'p3')).toBe(life(s0, 'p3') + 2);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
    expect(bfNames(s, 'p1').sort()).toEqual(['Test Bear', 'Test Primordial']);
  });
  it('an opponent with no chosen creature gains nothing and loses nothing', () => {
    const s0 = start();
    const s = cast(s0, 'Test Primordial', {}, [find(s0, 'Test Ogre', 'battlefield', 'p2')]);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') + 4);
    expect(life(s, 'p3')).toBe(life(s0, 'p3'));
    expect(bfNames(s, 'p3')).toEqual(['Test Bear']);
  });
});

describe('CR 101.4, 608.2c: "Each player may put a land card from their hand onto the battlefield, then each opponent who didn\'t draws a card." (Kynaios and Tiro of Meletis)', () => {
  const KYNAIOS = card('Test Kynaios', 'Instant', 'Each player may put a land card from their hand onto the battlefield, then each opponent who didn\'t draws a card.');
  const defs = [KYNAIOS, FOREST, BEAR];
  it('is automated', () => { expect(noManual(KYNAIOS)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Kynaios'], library: ['Test Bear', 'Test Bear'] }, p2: { hand: ['Test Forest'], library: ['Test Bear', 'Test Bear'] }, p3: { hand: ['Test Bear'], library: ['Test Bear', 'Test Bear'] } } });
  it('an opponent who put a land draws nothing; an opponent with no land card in hand (so they did not) draws a card; the controller never draws from the second part', () => {
    const s = cast(start(), 'Test Kynaios');
    expect(bfNames(s, 'p2')).toEqual(['Test Forest']);
    expect(hand(s, 'p2')).toEqual([]);
    expect(hand(s, 'p3')).toEqual(['Test Bear', 'Test Bear']);
    expect(hand(s, 'p1')).toEqual(['Test Bear']); // (the card p1 drew in the draw step)
  });
  it('an opponent who chooses not to put their land draws a card (and keeps the land in hand)', () => {
    const s = cast(start(), 'Test Kynaios', { take: { p2: 'none' } });
    expect(bfNames(s, 'p2')).toEqual([]);
    expect(hand(s, 'p2').sort()).toEqual(['Test Bear', 'Test Forest']);
  });
});

describe('CR 101.4, 102.3, 608.2d: "Each opponent may investigate. Each opponent who doesn\'t loses 1 life. You investigate X times, where X is one plus the number of opponents who investigated this way." (Wernog, Rider\'s Chaplain)', () => {
  const WERNOG = card('Test Wernog', 'Creature — Human', "When this creature enters, each opponent may investigate. Each opponent who doesn't loses 1 life. You investigate X times, where X is one plus the number of opponents who investigated this way.", { pt: ['1', '1'] });
  const defs = [WERNOG];
  it('is automated', () => { expect(noManual(WERNOG)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 4, defs, zones: { p1: { hand: ['Test Wernog'] } } });
  const clues = (s: GameState, p: PlayerId): number => bfIds(s, p).filter((id) => nameOf(s, id) === 'Clue Token').length;
  it('every opponent who investigates gets a Clue and does not lose life; every one who declines loses 1 life; the controller investigates 1 + the number who did', () => {
    const s0 = start();
    const s = cast(s0, 'Test Wernog', { yes: { p2: true, p3: false, p4: true } });
    expect(clues(s, 'p2')).toBe(1);
    expect(clues(s, 'p3')).toBe(0);
    expect(clues(s, 'p4')).toBe(1);
    expect(life(s, 'p2')).toBe(life(s0, 'p2'));
    expect(life(s, 'p3')).toBe(life(s0, 'p3') - 1);
    expect(life(s, 'p4')).toBe(life(s0, 'p4'));
    expect(clues(s, 'p1')).toBe(3);
  });
  it('when no opponent investigates every opponent loses 1 life and the controller investigates once', () => {
    const s0 = start();
    const s = cast(s0, 'Test Wernog', { yes: false });
    for (const p of ['p2', 'p3', 'p4'] as const) { expect(clues(s, p), p).toBe(0); expect(life(s, p), p).toBe(life(s0, p) - 1); }
    expect(clues(s, 'p1')).toBe(1);
  });
});

describe('CR 104.3b, 119.1: "Each player with exactly 13 life loses the game, then each player gains 1 life." (Triskaidekaphobia)', () => {
  const PHOBIA = card('Test Phobia', 'Sorcery', 'Each player with exactly 13 life loses the game, then each player gains 1 life.');
  const LOSER = card('Test Loser', 'Sorcery', 'Each player with exactly 13 life loses the game, then each player loses 1 life.');
  const defs = [PHOBIA, LOSER];
  it('is automated', () => { expect(noManual(PHOBIA)).toEqual([]); expect(noManual(LOSER)).toEqual([]); });
  const withLife = (name: string, lives: Record<PlayerId, number>): GameState => mpScenario({ players: 4, defs, zones: { p1: { hand: [name] } }, setup: (st) => { for (const p of st.players) p.life = lives[p.id] ?? p.life; } });
  it('a player on exactly 13 life loses the game; players on 12 and 14 do not; everybody still in gains 1 life afterwards', () => {
    const s = cast(withLife('Test Phobia', { p1: 20, p2: 13, p3: 12, p4: 14 }), 'Test Phobia');
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(true);
    for (const p of ['p1', 'p3', 'p4'] as const) expect(s.players.find((x) => x.id === p)!.hasLost, p).toBe(false);
    expect(life(s, 'p1')).toBe(21);
    expect(life(s, 'p3')).toBe(13);
    expect(life(s, 'p4')).toBe(15);
  });
  it('the life is checked BEFORE the change: a player on 12 who would gain to 13 does not lose; the other mode loses 1 life instead', () => {
    const a = cast(withLife('Test Phobia', { p1: 12, p2: 12, p3: 12, p4: 12 }), 'Test Phobia');
    for (const p of a.players) { expect(p.hasLost, p.id).toBe(false); expect(p.life, p.id).toBe(13); }
    const b = cast(withLife('Test Loser', { p1: 20, p2: 13, p3: 14, p4: 12 }), 'Test Loser');
    expect(b.players.find((p) => p.id === 'p2')!.hasLost).toBe(true);
    expect(life(b, 'p1')).toBe(19);
    expect(life(b, 'p3')).toBe(13);
    expect(life(b, 'p4')).toBe(11);
    expect(b.players.find((p) => p.id === 'p3')!.hasLost).toBe(false);
  });
});

describe('CR 104.4a, 104.3b (ruling 2025-01-24): the players on exactly 13 life lose together', () => {
  const PHOBIA = card('Test Phobia', 'Sorcery', 'Each player with exactly 13 life loses the game, then each player gains 1 life.');
  const withLife = (lives: Record<PlayerId, number>, players = 3): GameState => mpScenario({ players, defs: [PHOBIA], zones: { p1: { hand: ['Test Phobia'] } }, setup: (st) => { for (const p of st.players) p.life = lives[p.id] ?? p.life; } });
  it('every player on 13 life at once is a draw (the controller does not lose first and stop the effect)', () => {
    const s = cast(withLife({ p1: 13, p2: 13, p3: 13 }), 'Test Phobia');
    expect(s.result).toEqual(expect.objectContaining({ winner: null }));
  });
  it('the controller and one opponent on 13 lose together (the rest of the ability stops: its controller left, CR 800.4a) and the game goes on', () => {
    const s = cast(withLife({ p1: 13, p2: 13, p3: 20, p4: 20 }, 4), 'Test Phobia');
    expect(s.players.find((p) => p.id === 'p1')!.hasLost).toBe(true);
    expect(s.players.find((p) => p.id === 'p2')!.hasLost).toBe(true);
    expect(s.players.find((p) => p.id === 'p3')!.hasLost).toBe(false);
    expect(life(s, 'p3')).toBe(20); // (the ability's controller left the game, so the rest of it does not happen: CR 800.4a)
    expect(s.result ?? null).toBeNull();
  });
});

describe('CR 101.4, 121.1, 119.1: "Each player may draw up to two cards. For each card less than two a player draws this way, that player gains 2 life." (Truce, Temporary Truce)', () => {
  const TRUCE = card('Test Truce', 'Instant', 'Each player may draw up to two cards. For each card less than two a player draws this way, that player gains 2 life.');
  const defs = [TRUCE, BEAR];
  it('is automated', () => { expect(noManual(TRUCE)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Truce'], library: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { library: ['Test Bear', 'Test Bear', 'Test Bear'] }, p3: { library: ['Test Bear', 'Test Bear', 'Test Bear'] } } });
  it('a player who draws two gains nothing, one who draws one gains 2, one who draws none gains 4; a player who declines gains 4', () => {
    const s0 = start();
    const s = cast(s0, 'Test Truce', { n: { p1: 2, p2: 1, p3: 0 } });
    expect(hand(s, 'p1')).toHaveLength(hand(s0, 'p1').length - 1 + 2); // (the spell left the hand)
    expect(hand(s, 'p2')).toHaveLength(hand(s0, 'p2').length + 1);
    expect(hand(s, 'p3')).toHaveLength(hand(s0, 'p3').length);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
    expect(life(s, 'p2')).toBe(life(s0, 'p2') + 2);
    expect(life(s, 'p3')).toBe(life(s0, 'p3') + 4);
    const t = cast(s0, 'Test Truce', { yes: { p2: false }, n: 2 });
    expect(hand(t, 'p2')).toHaveLength(hand(s0, 'p2').length);
    expect(life(t, 'p2')).toBe(life(s0, 'p2') + 4);
    expect(life(t, 'p3')).toBe(life(s0, 'p3'));
  });
});

describe('CR 101.4, 701.9a, 120.3: "Each player may discard up to three cards. ~ deals damage to each player equal to 3 minus the number of cards they discarded this way." (Mind Bomb)', () => {
  const BOMB = card('Test Bomb', 'Sorcery', 'Each player may discard up to three cards. ~ deals damage to each player equal to 3 minus the number of cards they discarded this way.');
  const defs = [BOMB, BEAR];
  it('is automated', () => { expect(noManual(BOMB)).toEqual([]); });
  const start = (): GameState => mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Bomb', 'Test Bear', 'Test Bear', 'Test Bear'] }, p2: { hand: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, p3: { hand: ['Test Bear'] } } });
  it('3 minus the cards discarded: three discarded is no damage, none discarded is 3 damage, a player with one card discards it and takes 2', () => {
    const s0 = start();
    const s = cast(s0, 'Test Bomb', { take: { p1: 'max', p2: 'none', p3: 'max' } });
    expect(hand(s, 'p1')).toHaveLength(0);
    expect(life(s, 'p1')).toBe(life(s0, 'p1'));
    expect(hand(s, 'p2')).toHaveLength(4);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 3);
    expect(hand(s, 'p3')).toHaveLength(0);
    expect(life(s, 'p3')).toBe(life(s0, 'p3') - 2);
  });
  it('a player who declines the discard takes the full 3', () => {
    const s0 = start();
    const s = cast(s0, 'Test Bomb', { yes: { p2: false } });
    expect(hand(s, 'p2')).toHaveLength(4);
    expect(life(s, 'p2')).toBe(life(s0, 'p2') - 3);
  });
});

describe('CR 205.2a, 701.21a: "Each opponent sacrifices a permanent of their choice that shares a card type with it." (Martyr\'s Bond) and Fatal Grudge', () => {
  const BOND = card('Test Bond', 'Enchantment', 'Whenever another nonland permanent you control is put into a graveyard from the battlefield, each opponent sacrifices a permanent of their choice that shares a card type with it.');
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  const CHARM = card('Test Grudge', 'Sorcery', 'As an additional cost to cast this spell, sacrifice a nonland permanent.\nEach opponent chooses a permanent they control that shares a card type with the sacrificed permanent and sacrifices it.\nDraw a card.');
  const ARTIFACT_CREATURE = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['1', '1'] });
  const defs = [BOND, KILL, CHARM, BEAR, OGRE, GEAR, FOREST, ARTIFACT_CREATURE];
  it('is automated', () => { expect(noManual(BOND)).toEqual([]); expect(noManual(CHARM)).toEqual([]); });
  it('Bond: when a creature of yours dies each opponent sacrifices a permanent that is a creature too; an opponent with only lands and artifacts sacrifices nothing', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Kill'], battlefield: ['Test Bond', 'Test Bear'] }, p2: { battlefield: ['Test Ogre', 'Test Gear', 'Test Forest'] }, p3: { battlefield: ['Test Gear', 'Test Forest'] } } });
    const s = cast(s0, 'Test Kill', {}, [find(s0, 'Test Bear', 'battlefield', 'p1')]);
    expect(bfNames(s, 'p2').sort()).toEqual(['Test Forest', 'Test Gear']);
    expect(bfNames(s, 'p3').sort()).toEqual(['Test Forest', 'Test Gear']);
    expect(bfNames(s, 'p1')).toEqual(['Test Bond']);
  });
  it('Bond: an artifact creature that dies shares a type with an opponent\'s artifact: they sacrifice one permanent that is an artifact or a creature (their choice)', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Kill'], battlefield: ['Test Bond', 'Test Golem'] }, p2: { battlefield: ['Test Ogre', 'Test Gear', 'Test Forest'] }, p3: { battlefield: ['Test Forest'] } } });
    const s = cast(s0, 'Test Kill', {}, [find(s0, 'Test Golem', 'battlefield', 'p1')]);
    expect(bfNames(s, 'p2')).toHaveLength(2);
    expect(bfNames(s, 'p2')).toContain('Test Forest');
  });
  it('Bond (review): a token that dies still counts as the creature it was (it ceased to exist), and an artifact animated into a creature counts as both', () => {
    const MAKER = card('Test Maker', 'Sorcery', 'Create a 2/2 white Spirit creature token.');
    const ANIMATE = card('Test Animate', 'Instant', 'Target artifact becomes a 3/3 artifact creature until end of turn.');
    const d2 = [...defs, MAKER, ANIMATE];
    const a0 = mpScenario({ players: 3, defs: d2, zones: { p1: { hand: ['Test Maker', 'Test Kill'], battlefield: ['Test Bond'] }, p2: { battlefield: ['Test Ogre', 'Test Forest'] }, p3: { battlefield: ['Test Forest'] } } });
    let a = cast(a0, 'Test Maker');
    const token = bfIds(a, 'p1').find((id) => nameOf(a, id) !== 'Test Bond')!;
    a = cast(a, 'Test Kill', {}, [token]);
    expect(bfNames(a, 'p2')).toEqual(['Test Forest']);
    const b0 = mpScenario({ players: 3, defs: d2, zones: { p1: { hand: ['Test Animate', 'Test Kill'], battlefield: ['Test Bond', 'Test Gear'] }, p2: { battlefield: ['Test Bear', 'Test Forest'] }, p3: { battlefield: ['Test Forest'] } } });
    let b = cast(b0, 'Test Animate', {}, [find(b0, 'Test Gear', 'battlefield', 'p1')]);
    b = cast(b, 'Test Kill', {}, [find(b0, 'Test Gear', 'battlefield', 'p1')]);
    expect(bfNames(b, 'p2')).toEqual(['Test Forest']);
  });
  it('Grudge: each opponent sacrifices a permanent sharing a type with the sacrificed one, the caster draws; an opponent with no such permanent keeps everything', () => {
    const s0 = mpScenario({ players: 3, defs, zones: { p1: { hand: ['Test Grudge'], battlefield: ['Test Bear'], library: ['Test Forest'] }, p2: { battlefield: ['Test Ogre', 'Test Forest'] }, p3: { battlefield: ['Test Gear', 'Test Forest'] } } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Grudge', 'hand', 'p1') } as never);
    s = drive(s);
    expect(bfNames(s, 'p1')).toEqual([]);
    expect(bfNames(s, 'p2')).toEqual(['Test Forest']);
    expect(bfNames(s, 'p3').sort()).toEqual(['Test Forest', 'Test Gear']);
    expect(hand(s, 'p1')).toEqual(['Test Forest']);
  });
});
