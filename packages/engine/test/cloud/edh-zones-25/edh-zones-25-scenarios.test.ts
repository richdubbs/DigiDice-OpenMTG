/**
 * edh-zones-25 (Commander lane edh-zones): the round's readings played through the engine with synthetic cards (invented names, design 6.10). CR cites checked against the
 * 2026-09-25 text (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).
 *
 *   CR 701.23a, 608.2c, 614.15, 608.2d  "Search your library for up to two basic Forest cards, reveal those cards, and put one onto the battlefield tapped and the rest into your hand. Then shuffle.
 *                                       If there are two or more instant and/or sorcery cards in your graveyard, search your library for up to three basic Forest cards instead of two."
 *                                       (Nissa's Pilgrimage): the number of cards the search may find, judged as the search starts; the spell itself is on the stack, not in the graveyard
 *   CR 608.2d, 614.15, 702.143a         "Choose a creature type. Return up to two creature cards of that type from your graveyard to the battlefield. If this spell was foretold, return all
 *                                       creature cards of that type from your graveyard to the battlefield instead." (Haunting Voyage)
 *   CR 701.9a, 603.2c, 701.13a, 608.2d  "Whenever you discard one or more nonland cards, you may exile one of them from your graveyard. If you do, you may cast it this turn." (Conspiracy Theorist)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState } from '../../../src/index';
import { act, answer, card, cast, drive, find, full, passBoth, scenario } from '../r3-cost/support';
import { getChars } from '../../../src/rules/characteristics';
import { pick, until } from '../../m6/dfc/support';
import { declareAttackers, declareBlockers, toDeclareAttackers } from '../../m4/helpers';
import { pass } from '../../m3/scenario';

const nameOf = (s: GameState, id: string): string => getChars(s, id).name;
const zoneNames = (s: GameState, z: 'hand' | 'graveyard' | 'library', p: 'p1' | 'p2'): string[] => s.zones[z][p]!.map((id) => nameOf(s, id)).sort();
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();
const bf = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();

/** What a test answers when the game asks: `names` for a creature type, `objects(options, s, pending)` for a choice of objects, `yes` for the optional steps in order. */
interface Answers {
  name?: string;
  objects?: (options: string[], s: GameState, min: number, max: number) => string[];
  yes?: boolean[];
}
/** Answer every decision and pass priority until the stack is empty (payments automatic). Records the (min, max) of each object choice asked. */
function settle(s0: GameState, a: Answers = {}, asked: { min: number; max: number }[] = []): GameState {
  let s = s0;
  const yes = [...(a.yes ?? [])];
  for (let i = 0; i < 60; i++) {
    const p = s.pending;
    if (p !== null && p.kind !== 'priority') {
      if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: yes.shift() ?? false });
      else if (p.kind === 'chooseName') s = answer(s, { kind: 'chooseName', name: a.name ?? 'Elf' });
      else if (p.kind === 'chooseObjects') {
        asked.push({ min: p.min, max: p.max });
        s = answer(s, pick(...(a.objects ? a.objects(p.options, s, p.min, p.max) : p.options.slice(0, p.min))));
      } else s = drive(s);
      continue;
    }
    if (s.zones.stack.length > 0) { s = passBoth(s); continue; }
    break;
  }
  return s;
}
const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
void lands;

describe('"Search your library for up to two basic Forest cards, reveal those cards, and put one onto the battlefield tapped and the rest into your hand. Then shuffle. If there are two or more instant and/or sorcery cards in your graveyard, search your library for up to three basic Forest cards instead of two." (Nissa\'s Pilgrimage)', () => {
  const WALK = card('Test Grove Walk', 'Sorcery', 'Search your library for up to two basic Forest cards, reveal those cards, and put one onto the battlefield tapped and the rest into your hand. Then shuffle. If there are two or more instant and/or sorcery cards in your graveyard, search your library for up to three basic Forest cards instead of two.');
  const WOOD = card('Test Wood', 'Basic Land — Forest', '');
  const FEN = card('Test Fen', 'Basic Land — Swamp', '');
  const BOLT = card('Test Spark', 'Instant', 'You gain 1 life.');
  const CHANT = card('Test Chant', 'Sorcery', 'You gain 1 life.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [WALK, WOOD, FEN, BOLT, CHANT, BEAR];
  const setup = (graveyard: string[]): GameState =>
    scenario([], { defs, p1: { hand: ['Test Grove Walk'], graveyard, library: ['Test Wood', 'Test Fen', 'Test Wood', 'Test Wood', 'Test Wood', 'Test Bear'] }, p2: {} });
  /** Cast it, take the first `found` Forests the search offers, then the first of them for the battlefield. */
  function play(graveyard: string[], found: number): { s: GameState; asked: { min: number; max: number }[] } {
    const asked: { min: number; max: number }[] = [];
    const s = settle(cast(setup(graveyard), 'Test Grove Walk'), { objects: (options, st, _min, max) => (asked.length === 1 ? options.slice(0, found) : options.slice(0, 1).filter(() => max === 1)) }, asked);
    return { s, asked };
  }
  it('is fully automated', () => expect(full(WALK)).toBe(true));
  it('with fewer than two instants and sorceries in the graveyard: up to TWO Forests, one onto the battlefield tapped, the rest into the hand', () => {
    const { s, asked } = play(['Test Spark'], 2);
    expect(asked[0]).toEqual({ min: 0, max: 2 });
    expect(bf(s)).toEqual(['Test Wood']);
    const wood = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Wood')!;
    expect(s.objects[wood]!.tapped).toBe(true);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Wood']);
  });
  it('with two instants and/or sorceries in the graveyard (spell mastery): up to THREE Forests, one onto the battlefield, the other two into the hand', () => {
    const { s, asked } = play(['Test Spark', 'Test Chant'], 3);
    expect(asked[0]).toEqual({ min: 0, max: 3 });
    expect(bf(s)).toEqual(['Test Wood']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Wood', 'Test Wood']);
  });
  it('a creature card in the graveyard does not count: two of them are no spell mastery', () => {
    expect(play(['Test Bear', 'Test Bear'], 2).asked[0]).toEqual({ min: 0, max: 2 });
  });
  it('the spell itself is not in the graveyard while it resolves: one instant there is not enough', () => {
    expect(play(['Test Spark'], 1).asked[0]).toEqual({ min: 0, max: 2 });
  });
  it('finding fewer cards than allowed is fine: one Forest found goes onto the battlefield tapped and nothing goes into the hand', () => {
    const { s } = play([], 1);
    expect(bf(s)).toEqual(['Test Wood']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
  });
  it('only basic Forest cards can be found (the Swamp is not offered)', () => {
    let offered: string[] = [];
    settle(cast(setup([]), 'Test Grove Walk'), { objects: (options, st) => { if (offered.length === 0) offered = options.map((id) => nameOf(st, id)); return options.slice(0, 1); } });
    expect(offered).toEqual(['Test Wood', 'Test Wood', 'Test Wood', 'Test Wood']);
  });
});

describe('"Choose a creature type. Return up to two creature cards of that type from your graveyard to the battlefield. If this spell was foretold, return all creature cards of that type from your graveyard to the battlefield instead." (Haunting Voyage)', () => {
  const VOYAGE = card('Test Grave Voyage', 'Sorcery', 'Choose a creature type. Return up to two creature cards of that type from your graveyard to the battlefield. If this spell was foretold, return all creature cards of that type from your graveyard to the battlefield instead.\nForetell {1}', '{3}');
  const ELF1 = card('Test Elf One', 'Creature — Elf', '', '{0}', ['1', '1']);
  const ELF2 = card('Test Elf Two', 'Creature — Elf Druid', '', '{0}', ['1', '1']);
  const ELF3 = card('Test Elf Three', 'Creature — Elf Scout', '', '{0}', ['1', '1']);
  const GOB = card('Test Goblin', 'Creature — Goblin', '', '{0}', ['1', '1']);
  const SHIFT = card('Test Shifter', 'Creature — Shapeshifter', 'Changeling', '{0}', ['1', '1']);
  const ART = card('Test Idol', 'Artifact', '');
  const defs = [VOYAGE, ELF1, ELF2, ELF3, GOB, SHIFT, ART];
  const board = (): GameState => scenario(['Island'], { defs, p1: { hand: ['Test Grave Voyage'], graveyard: ['Test Elf One', 'Test Elf Two', 'Test Elf Three', 'Test Goblin', 'Test Shifter', 'Test Idol'], battlefield: Array(4).fill('Island') as string[] }, p2: {} });
  const special = (s: GameState): Action | undefined => legalActions(s, 'p1').find((a) => a.kind === 'special' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === 'Test Grave Voyage')?.action;
  const castVia = (s: GameState, method: string): Action | undefined =>
    legalActions(s, 'p1').find((a) => a.kind === 'cast' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === 'Test Grave Voyage' && (a.action as { method?: string }).method === method)?.action;
  const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => until(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
  const bfc = (s: GameState): string[] => bf(s).filter((n) => n !== 'Island');
  it('is fully automated', () => expect(full(VOYAGE)).toBe(true));
  it('cast from the hand: up to two creature cards of the chosen type come back, no more (a Goblin and a non-creature card stay)', () => {
    const asked: { min: number; max: number }[] = [];
    const s = settle(cast(board(), 'Test Grave Voyage'), { name: 'Elf', objects: (options) => options.slice(0, 2) }, asked);
    expect(asked[0]!.max).toBe(2);
    expect(bfc(s)).toHaveLength(2);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(expect.arrayContaining(['Test Goblin', 'Test Idol']));
  });
  it('cast from the hand: choosing none returns none (up to)', () => {
    const s = settle(cast(board(), 'Test Grave Voyage'), { name: 'Elf', objects: () => [] });
    expect(bfc(s)).toEqual([]);
  });
  it('cast from the hand: more than two chosen is refused (the answer is not accepted)', () => {
    let s = passBoth(cast(board(), 'Test Grave Voyage'));
    s = answer(s, { kind: 'chooseName', name: 'Elf' });
    expect(s.pending?.kind).toBe('chooseObjects');
    const p = s.pending as { options: string[]; max: number };
    expect(p.max).toBe(2);
    expect(p.options.map((id) => nameOf(s, id)).sort()).toEqual(['Test Elf One', 'Test Elf Three', 'Test Elf Two', 'Test Shifter']);
    expect(() => answer(s, pick(...p.options.slice(0, 3)))).toThrow(/Choose between 0 and 2/);
  });
  it('foretold (cast from exile for its foretell cost on a later turn): ALL creature cards of the chosen type come back, a changeling too; the Goblin and the artifact stay', () => {
    let s = board();
    s = drive(act(s, special(s)!));
    s = mainOf(mainOf(s, 'p2'), 'p1');
    s = drive(act(s, castVia(s, 'foretell')!));
    s = settle(s, { name: 'Elf' });
    expect(bfc(s)).toEqual(['Test Elf One', 'Test Elf Three', 'Test Elf Two', 'Test Shifter']);
    expect(zoneNames(s, 'graveyard', 'p1').filter((n) => n !== 'Test Grave Voyage')).toEqual(['Test Goblin', 'Test Idol']);
  });
});

describe('"Whenever you discard one or more nonland cards, you may exile one of them from your graveyard. If you do, you may cast it this turn." (Conspiracy Theorist)', () => {
  const THEORIST = card('Test Plot Seer', 'Creature — Human Shaman', 'Whenever you discard one or more nonland cards, you may exile one of them from your graveyard. If you do, you may cast it this turn.', '{0}', ['1', '1']);
  const LOOT = card('Test Loot', 'Sorcery', 'Discard two cards.');
  const LOOT1 = card('Test Loot One', 'Sorcery', 'Discard a card.');
  const SPELL = card('Test Gain', 'Sorcery', 'You gain 2 life.');
  const FLASH = card('Test Flash', 'Instant', 'You gain 3 life.');
  const TERRA = card('Test Terra', 'Land', '');
  const defs = [THEORIST, LOOT, LOOT1, SPELL, FLASH, TERRA];
  const setup = (hand: string[]): GameState => scenario([], { defs, p1: { hand: ['Test Loot', 'Test Loot One', ...hand], battlefield: ['Test Plot Seer'] }, p2: {} });
  const discardWith = (hand: string[], discards: string[], spell: string, trigger: Answers): GameState => {
    const s0 = setup(hand);
    const keep = new Set(discards);
    return settle(cast(s0, spell), { ...trigger, objects: (options, st, min, max) => (min === max && min === discards.length && options.some((id) => keep.has(nameOf(st, id))) ? options.filter((id) => keep.has(nameOf(st, id))) : trigger.objects ? trigger.objects(options, st, min, max) : options.slice(0, min)) });
  };
  it('is fully automated', () => expect(full(THEORIST)).toBe(true));
  it('discarding two nonland cards at once is ONE trigger: exile one of the two from the graveyard, then cast it this turn', () => {
    const s = discardWith(['Test Gain', 'Test Flash'], ['Test Gain', 'Test Flash'], 'Test Loot', { yes: [true], objects: (options, st) => options.filter((id) => nameOf(st, id) === 'Test Flash') });
    expect(exileNames(s)).toEqual(['Test Flash']);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(expect.arrayContaining(['Test Gain']));
    expect(zoneNames(s, 'graveyard', 'p1')).not.toContain('Test Flash');
    const a = legalActions(s, 'p1').find((l) => l.kind === 'cast' && l.object === find(s, 'Test Flash', 'exile', 'p1'));
    expect(a).toBeDefined(); // may cast the exiled card this turn
  });
  it('declining the option exiles nothing and gives no permission', () => {
    const s = discardWith(['Test Gain', 'Test Flash'], ['Test Gain', 'Test Flash'], 'Test Loot', { yes: [false] });
    expect(exileNames(s)).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(expect.arrayContaining(['Test Gain', 'Test Flash']));
  });
  it('a land card discarded with a nonland card is not one of "them": only the nonland card can be exiled (it is the only one, so it is not even asked)', () => {
    const asked: { min: number; max: number }[] = [];
    const s0 = setup(['Test Terra', 'Test Gain']); // the land first, so a first-option answer would pick it if it were offered
    const discards = new Set(['Test Gain', 'Test Terra']);
    const s = settle(cast(s0, 'Test Loot'), { yes: [true], objects: (options, st, min, max) => (min === 2 && max === 2 ? options.filter((id) => discards.has(nameOf(st, id))) : options.slice(0, min)) }, asked);
    expect(asked.filter((a) => a.min === 1 && a.max === 1)).toEqual([]);
    expect(exileNames(s)).toEqual(['Test Gain']);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Terra');
  });
  it('discarding only a land card does not trigger it', () => {
    const s = discardWith(['Test Terra'], ['Test Terra'], 'Test Loot One', { yes: [true] });
    expect(exileNames(s)).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Terra');
  });
  it('a card another player discards does not trigger it (whenever YOU discard)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Plot Seer'] }, p2: { hand: ['Test Loot One', 'Test Gain'] } });
    const s1 = until(s0, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
    const s = settle(cast(s1, 'Test Loot One', {}, 'p2'), { yes: [true] });
    expect(exileNames(s)).toEqual([]);
  });
});

describe('"Whenever ~ attacks, you may pay {1} and discard a card. If you do, draw a card." (Conspiracy Theorist; ch.maypay.discard)', () => {
  const SEER = card('Test Loot Seer', 'Creature — Human Shaman', 'Whenever ~ attacks, you may pay {1} and discard a card. If you do, draw a card.', '{0}', ['1', '1']);
  const JUNK = card('Test Junk', 'Sorcery', 'You gain 1 life.');
  const FRESH = card('Test Fresh', 'Sorcery', 'You gain 2 life.');
  const defs = [SEER, JUNK, FRESH];
  /** Attack with the Seer (no blocks) and answer the trigger with `yes`; stops after combat damage. */
  function attack(hand: string[], battlefield: string[], yes: boolean): GameState {
    const s0 = scenario(['Plains'], { defs, p1: { hand, battlefield: ['Test Loot Seer', ...battlefield], library: ['Test Fresh', 'Test Fresh'] }, p2: {} });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Loot Seer', 'battlefield', 'p1')]]);
    for (let i = 0; i < 40; i++) {
      const d = s.pending;
      if (!d) break;
      if (d.kind === 'declareBlockers') s = declareBlockers(s, []);
      else if (d.kind === 'priority') {
        if (s.turn.step === 'endCombat') break;
        s = pass(s);
      } else s = settle(s, { yes: [yes] });
    }
    return s;
  }
  it('is fully automated', () => expect(full(SEER)).toBe(true));
  it('pays {1}, discards a card and draws a card', () => {
    const s = attack(['Test Junk'], ['Plains'], true);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Junk']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Fresh']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped).map((id) => nameOf(s, id)).sort()).toEqual(['Plains', 'Test Loot Seer']);
  });
  it('declining pays nothing, discards nothing and draws nothing', () => {
    const s = attack(['Test Junk'], ['Plains'], false);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Junk']);
  });
  it('with no card in hand the cost cannot be paid: no draw', () => {
    const s = attack([], ['Plains'], true);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
  });
  it('with no mana the cost cannot be paid: the card stays in hand, nothing is drawn', () => {
    const s = attack(['Test Junk'], [], true);
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual([]);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Junk']);
  });
});
