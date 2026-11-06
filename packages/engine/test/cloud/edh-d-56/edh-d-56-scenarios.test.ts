/**
 * Commander lane d-leftovers-4, round edh-d-56: the round's readings played through the engine with synthetic cards (invented names, design 6.10), in 4-player games, with negative cases.
 * CR cites are from the Comprehensive Rules text of 2026-09-25 (cites not re-checked against the text are listed in the record).
 *
 *   CR 107.3, 118.12, 608.2h        "You may pay {X}. If you do, create X ... tokens. X can't be greater than the amount of life you lost this turn."
 *   CR 701.16a, 608.2h, 701.20a     "Each player reveals the top card of their library. For each nonland card revealed this way, you investigate."
 *   CR 601.3, 305.1, 118.9          "Until end of turn, you may cast noncreature spells from among those cards without paying their mana costs."
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { card, full } from '../cmd3/helpers';

const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);

interface Script { numbers?: number[]; asked?: { min?: number; max?: number }[]; yes?: boolean }
/** Answers whatever is asked, from the script, and passes priority until the stack is empty. */
function run(s0: GameState, sc: Script = {}): GameState {
  let s = s0;
  const numbers = [...(sc.numbers ?? [])];
  for (let i = 0; i < 300; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    const d = p as unknown as { min?: number; max?: number; prompt: string };
    let a: DecisionAnswer;
    if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: sc.yes ?? true };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: (p as unknown as { options: ObjectId[] }).options.slice(0, d.min ?? 0) };
    else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p as unknown as { options: { id: string }[] }).options[0]!.id] };
    else if (p.kind === 'chooseNumber') { sc.asked?.push({ min: d.min, max: d.max }); a = { kind: 'chooseNumber', n: numbers.shift() ?? d.min ?? 0 } as DecisionAnswer; }
    else if (p.kind === 'order') a = { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((x) => x.id) };
    else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = mpass(s); continue; }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
    s = manswer(s, a);
  }
  return s;
}
const castBy = (s: GameState, name: string, player: PlayerId = 'p1'): GameState => mact(s, { type: 'cast', player, card: mfind(s, name, 'hand', player) });

describe('CR 107.3, 118.12, 608.2h: "At the beginning of your end step, you may pay {X}. If you do, create X 2/2 ... tokens. X can\'t be greater than the amount of life you lost this turn."', () => {
  const TEXT = "At the beginning of your end step, you may pay {X}. If you do, create X 2/2 black Warrior creature tokens with menace. X can't be greater than the amount of life you lost this turn.";
  const PRIMARCH = card('Test Grave Primarch', 'Legendary Creature — Demon', TEXT, ['1', '1']);
  const OUCH = card('Test Sharp Lesson', 'Instant', 'You lose 3 life.');
  const defs = [PRIMARCH, OUCH];
  const start = (): GameState => mpScenario({ defs, zones: { p1: { battlefield: ['Test Grave Primarch', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'], hand: ['Test Sharp Lesson'] } } });
  const toEnd = (s: GameState, nums: number[], asked: { min?: number; max?: number }[]): GameState =>
    run(passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'end' && (x.pending?.kind !== 'priority' || x.zones.stack.length > 0), "p1's end step"), { numbers: nums, asked });
  it('is automated', () => expect(full(PRIMARCH)).toBe(true));
  it('after losing 3 life this turn X is at most 3: paying 3 creates three tokens', () => {
    const asked: { min?: number; max?: number }[] = [];
    const s = toEnd(run(castBy(start(), 'Test Sharp Lesson')), [3], asked);
    expect(asked[0]!.max).toBe(3);
    expect(tokensOf(s, 'p1')).toHaveLength(3);
  });
  it('negative: with no life lost this turn X can only be 0 and no token is made', () => {
    const asked: { min?: number; max?: number }[] = [];
    const s = toEnd(start(), [5], asked);
    expect(asked.every((a) => (a.max ?? 0) === 0)).toBe(true);
    expect(tokensOf(s, 'p1')).toHaveLength(0);
  });
});

describe('CR 701.16a, 608.2h, 701.20a: "Each player reveals the top card of their library. For each nonland card revealed this way, you investigate."', () => {
  const TEXT = 'When this creature enters, each player reveals the top card of their library. For each nonland card revealed this way, you investigate.';
  const TALKER = card('Test Parley Talker', 'Creature — Human', TEXT, ['1', '1']);
  const SPELL = card('Test Plain Charm', 'Instant', 'You gain 1 life.');
  const defs = [TALKER, SPELL];
  const play = (lib: Record<string, string[]>): GameState =>
    run(castBy(mpScenario({ defs, zones: { p1: { hand: ['Test Parley Talker'], library: lib['p1'] }, p2: { library: lib['p2'] }, p3: { library: lib['p3'] }, p4: { library: lib['p4'] } } }), 'Test Parley Talker'));
  it('is automated', () => expect(full(TALKER)).toBe(true));
  it('two nonland cards among the four revealed: two Clues for the controller', () => {
    const s = play({ p1: ['Plains', 'Test Plain Charm'], p2: ['Plains'], p3: ['Test Plain Charm'], p4: ['Plains'] });
    expect(tokensOf(s, 'p1')).toHaveLength(2);
  });
  it('negative: four lands revealed: no Clue', () => {
    const s = play({ p1: ['Plains'], p2: ['Plains'], p3: ['Plains'], p4: ['Plains'] });
    expect(tokensOf(s, 'p1')).toHaveLength(0);
  });
});

describe('CR 601.3, 305.1, 118.9: "Until end of turn, you may cast noncreature spells from among those cards without paying their mana costs."', () => {
  const TEXT = 'When this creature enters, exile the top four cards of your library. Until end of turn, you may cast noncreature spells from among those cards without paying their mana costs.';
  const MONK = card('Test Raid Monk', 'Creature — Human Monk', TEXT, ['1', '1']);
  const SPELL = card('Test Costly Charm', 'Instant', 'You gain 3 life.', undefined, '{5}');
  const BEAST = card('Test Costly Beast', 'Creature — Beast', '', ['2', '2'], '{5}');
  const defs = [MONK, SPELL, BEAST];
  const after = (): GameState => run(castBy(mpScenario({ defs, zones: { p1: { hand: ['Test Raid Monk'], library: ['Test Costly Charm', 'Test Costly Beast', 'Plains', 'Test Costly Charm'] } } }), 'Test Raid Monk'));
  const castable = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((x) => x.kind === 'cast' && s.objects[x.object!]?.defId === name);
  it('is automated', () => expect(full(MONK)).toBe(true));
  it('the noncreature spells can be cast from exile for no mana; the creature cannot, nor can the land be played', () => {
    const s = after();
    expect(castable(s, 'Test Costly Charm')).toBe(true);
    expect(castable(s, 'Test Costly Beast')).toBe(false);
    const cast = legalActions(s, 'p1').find((x) => x.kind === 'cast' && s.objects[x.object!]?.defId === 'Test Costly Charm')!;
    const l0 = lifeOf(s, 'p1');
    const r = run(mact(s, (cast as unknown as { action: never }).action));
    expect(lifeOf(r, 'p1')).toBe(l0 + 3);
  });
  it('negative: in the next turn the permission is gone', () => {
    const s = passUntil(after(), (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's main phase");
    expect(castable(s, 'Test Costly Charm')).toBe(false);
  });
});
