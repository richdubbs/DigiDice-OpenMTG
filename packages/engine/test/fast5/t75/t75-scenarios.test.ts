/**
 * FAST5 T75: the look-at / reveal-the-top-N and library-search shapes of parser/templates/zz-fast5/t75.json played through the engine with synthetic cards
 * compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 701.20a, 701.20e, 608.2d  "You may reveal a Wizard creature card or a Swamp card from among them and put it into your hand": one card of either description,
 *                                chosen from the cards looked at (never a card elsewhere in the library), revealed, put into the hand; "a card with {X} in its mana
 *                                cost" (CR 107.3, 202.1); "a noncreature, nonland card"
 *   CR 202.3, 608.2h             "a creature card with mana value less than or equal to the number of lands you control": the count is the lands as the card is chosen
 *   CR 608.2d, 110.2             "Put a random creature card from among them onto the battlefield": no player chooses; none among them: nothing happens
 *   CR 701.23a, 701.20a          "Search your library for a basic land card or a Cave card, reveal it, put it into your hand, then shuffle"
 *   CR 701.17a, 608.2c, 400.7    "Mill four cards. You may put a land card from among them into your hand." (the milled cards only); "If you put a Town card into your
 *                                hand this way, you gain 2 life." reads the card that really went to the hand
 *   CR 701.23a, 608.2c, 110.2    "Search your library for up to two Forest cards and reveal them. Put one of them onto the battlefield tapped and the other into your
 *                                hand, then shuffle."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, battlefieldNames, find, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

function settle(s0: GameState, answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Cast the named spell from p1's hand and let it resolve; the game stops at the first decision of the spell. */
const cast = (s0: GameState, name: string): GameState => settle(pass(pass(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }))));
const options = (s: GameState): ObjectId[] => (s.pending?.kind === 'chooseObjects' ? [...s.pending.options] : []);
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.objects[id]!.defId).sort();
const pick = (s: GameState, name: string): DecisionAnswer => {
  const id = options(s).find((o) => s.objects[o]!.defId === name);
  if (id === undefined) throw new Error(`${name} is not offered`);
  return { kind: 'chooseObjects', ids: [id] };
};
/** The bottom `n` cards of p1's library, by name. */
const bottom = (s: GameState, n: number): string[] => s.zones.library['p1']!.slice(-n).map((id) => s.objects[id]!.defId).sort();

const LANDS = ['Swamp', 'Forest', 'Island'];
const ELF = card('Test Elf', 'Creature — Elf', '', ['1', '1'], '{W}');
const WIZARD = card('Test Wizard', 'Creature — Wizard', '', ['1', '1'], '{U}');
const IMP = card('Test Imp', 'Creature — Imp', '', ['2', '2'], '{2}');
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{3}');
const ROCK = card('Test Rock', 'Artifact', '', undefined, '{1}');
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 1 damage to any target.', undefined, '{R}');
const FIREBALL = card('Test Fireball', 'Sorcery', 'Test Fireball deals X damage to any target.', undefined, '{X}{R}');
const TOWN = card('Test Town', 'Land — Town', '');
const CAVERN = card('Test Cavern', 'Land — Cave', '');
const WASTE = card('Test Waste', 'Land', '');

describe('CR 701.20a, 701.20e, 608.2d: "You may reveal a Wizard creature card or a Swamp card from among them and put it into your hand."', () => {
  const SEEK = card('Test Seeker', 'Sorcery', 'Look at the top five cards of your library. You may reveal a Wizard creature card or a Swamp card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.');
  const game = (): GameState => scenario(LANDS, { p1: { hand: ['Test Seeker'], library: ['Test Rock', 'Test Wizard', 'Swamp', 'Test Elf', 'Test Rock', 'Test Wizard'] }, defs: [SEEK, WIZARD, ELF, ROCK] });
  it('is automated; only the Wizard creature and the Swamp among the five cards looked at are offered (a Wizard sixth from the top is not)', () => {
    expect(full(SEEK)).toBe(true);
    const s = cast(game(), 'Test Seeker');
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.min).toBe(0);
    expect(s.pending.max).toBe(1);
    expect(names(s, options(s))).toEqual(['Swamp', 'Test Wizard']);
  });
  it('the chosen card goes to the hand and the other four go to the bottom of the library; declining puts all five there', () => {
    const s = cast(game(), 'Test Seeker');
    const taken = settle(s, [pick(s, 'Swamp')]);
    expect(zoneNames(taken, 'hand', 'p1')).toEqual(['Swamp']);
    expect(bottom(taken, 4)).toEqual(['Test Elf', 'Test Rock', 'Test Rock', 'Test Wizard']);
    const declined = settle(s, [{ kind: 'chooseObjects', ids: [] }]);
    expect(zoneNames(declined, 'hand', 'p1')).toEqual([]);
    expect(bottom(declined, 5)).toEqual(['Swamp', 'Test Elf', 'Test Rock', 'Test Rock', 'Test Wizard']);
  });
});

describe('CR 107.3, 202.1, 701.20a: "You may reveal a land card or a card with {X} in its mana cost from among them and put it into your hand."', () => {
  const SURVEY = card('Test Surveyor', 'Sorcery', 'Look at the top five cards of your library. You may reveal a land card or a card with {X} in its mana cost from among them and put it into your hand. Put the rest on the bottom of your library in a random order.');
  it('offers a land and a spell with {X} in its mana cost, not a spell with a plain cost', () => {
    expect(full(SURVEY)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Surveyor'], library: ['Test Rock', 'Test Fireball', 'Test Elf', 'Test Town', 'Test Bolt'] }, defs: [SURVEY, ROCK, FIREBALL, ELF, TOWN, BOLT] });
    const s = cast(s0, 'Test Surveyor');
    expect(names(s, options(s))).toEqual(['Test Fireball', 'Test Town']);
    const done = settle(s, [pick(s, 'Test Fireball')]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Test Fireball']);
  });
});

describe('CR 205.4b, 701.20a: "You may reveal a noncreature, nonland card from among them and put it into your hand."', () => {
  const TRAIN = card('Test Trainer', 'Sorcery', 'Look at the top four cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.');
  it('offers the artifact and the instant, not the creature or the land', () => {
    expect(full(TRAIN)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Trainer'], library: ['Test Elf', 'Test Rock', 'Test Town', 'Test Bolt', 'Test Bolt'] }, defs: [TRAIN, ELF, ROCK, TOWN, BOLT] });
    const s = cast(s0, 'Test Trainer');
    expect(names(s, options(s))).toEqual(['Test Bolt', 'Test Rock']);
    const done = settle(s, [pick(s, 'Test Bolt')]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Test Bolt']);
    expect(bottom(done, 3)).toEqual(['Test Elf', 'Test Rock', 'Test Town']);
  });
});

describe('CR 608.2d, 110.2: "Put a random creature card from among them onto the battlefield."', () => {
  const BARREL = card('Test Barrel', 'Sorcery', 'Reveal the top four cards of your library. Put a random creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.');
  const game = (library: string[], seed: string): GameState => scenario(LANDS, { p1: { hand: ['Test Barrel'], library }, defs: [BARREL, ELF, OGRE, ROCK], seed });
  it('no player chooses: exactly one of the revealed creature cards enters (both can be the one), the other three cards go to the bottom', () => {
    expect(full(BARREL)).toBe(true);
    const entered = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      const s = cast(game(['Test Elf', 'Test Rock', 'Test Ogre', 'Test Rock', 'Test Elf'], seed), 'Test Barrel');
      expect(s.pending?.kind).toBe('priority'); // nothing to decide, not even the order of the rest
      const creatures = battlefieldNames(s, 'p1').filter((n) => n !== 'Plains');
      expect(creatures).toHaveLength(1);
      entered.add(creatures[0]!);
      expect(s.zones.library['p1']!.slice(0, 1).map((id) => s.objects[id]!.defId)).toEqual(['Test Elf']); // the fifth card was not revealed and stays on top
      expect(bottom(s, 3).filter((n) => n === 'Test Rock')).toHaveLength(2); // both Rocks are among the three cards put on the bottom
    }
    expect([...entered].sort()).toEqual(['Test Elf', 'Test Ogre']);
  });
  it('no creature card among them: nothing enters and all four go to the bottom', () => {
    const s = cast(game(['Test Rock', 'Test Rock', 'Test Rock', 'Test Rock', 'Test Elf'], 'a'), 'Test Barrel');
    expect(battlefieldNames(s, 'p1')).toEqual([]);
    expect(bottom(s, 4)).toEqual(['Test Rock', 'Test Rock', 'Test Rock', 'Test Rock']);
  });
});

describe('CR 202.3, 608.2h, 110.2: "You may reveal a creature card with mana value less than or equal to the number of lands you control from among them and put it onto the battlefield."', () => {
  const LOOT = card('Test Explorer', 'Sorcery', 'Look at the top four cards of your library. You may reveal a creature card with mana value less than or equal to the number of lands you control from among them and put it onto the battlefield. Put the rest on the bottom of your library in a random order.');
  const game = (lands: string[]): GameState => scenario(LANDS, { p1: { hand: ['Test Explorer'], battlefield: lands, library: ['Test Ogre', 'Test Imp', 'Test Elf', 'Test Rock'] }, defs: [LOOT, OGRE, IMP, ELF, ROCK] });
  it('with two lands only creature cards of mana value 2 or less are offered', () => {
    expect(full(LOOT)).toBe(true);
    const s = cast(game(['Plains', 'Plains']), 'Test Explorer');
    expect(names(s, options(s))).toEqual(['Test Elf', 'Test Imp']);
    const done = settle(s, [pick(s, 'Test Imp')]);
    expect(battlefieldNames(done, 'p1')).toContain('Test Imp');
    expect(bottom(done, 3)).toEqual(['Test Elf', 'Test Ogre', 'Test Rock']);
  });
  it('with three lands the mana value 3 creature is offered too', () => {
    const s = cast(game(['Plains', 'Plains', 'Plains']), 'Test Explorer');
    expect(names(s, options(s))).toEqual(['Test Elf', 'Test Imp', 'Test Ogre']);
  });
  it('with no land nothing qualifies (a creature card has mana value 1 or more here), so there is nothing to choose', () => {
    const s = cast(game([]), 'Test Explorer');
    expect(options(s)).toEqual([]);
    expect(battlefieldNames(s, 'p1')).toEqual([]);
  });
});

describe('CR 701.23a, 701.20a: "Search your library for a basic land card or a Cave card, reveal it, put it into your hand, then shuffle."', () => {
  const WARDEN = card('Test Warden', 'Sorcery', 'Search your library for a basic land card or a Cave card, reveal it, put it into your hand, then shuffle.');
  it('offers a basic land and a Cave, not a nonbasic land that is no Cave and not a creature card', () => {
    expect(full(WARDEN)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Warden'], library: ['Test Elf', 'Test Waste', 'Test Cavern', 'Swamp'] }, defs: [WARDEN, ELF, WASTE, CAVERN] });
    const s = cast(s0, 'Test Warden');
    const offered = new Set(names(s, options(s)));
    expect([...offered].sort()).toEqual(['Plains', 'Swamp', 'Test Cavern']);
    const done = settle(s, [pick(s, 'Test Cavern')]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Test Cavern']);
  });
});

describe('CR 701.23a, 701.20a, 608.2d: "You may search your library for a basic land card or a Cave card, reveal it, put it into your hand, then shuffle."', () => {
  const WARDEN = card('Test Wardress', 'Sorcery', 'You may search your library for a basic land card or a Cave card, reveal it, put it into your hand, then shuffle.');
  it('is optional: you may decline (nothing found, no card in the hand) or take a Cave', () => {
    expect(full(WARDEN)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Wardress'], library: ['Test Elf', 'Test Cavern', 'Swamp'] }, defs: [WARDEN, ELF, CAVERN] });
    const s = cast(s0, 'Test Wardress');
    expect(s.pending?.kind).toBe('yesNo');
    const declined = settle(s, [{ kind: 'yesNo', yes: false }]);
    expect(zoneNames(declined, 'hand', 'p1')).toEqual([]);
    const taken = settle(s, [{ kind: 'yesNo', yes: true }]);
    expect(names(taken, options(taken))).toContain('Test Cavern');
    const done = settle(taken, [pick(taken, 'Test Cavern')]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Test Cavern']);
  });
});

describe('CR 701.17a, 608.2c, 400.7: "Mill four cards. You may put a land card from among them into your hand. If you put a Town card into your hand this way, you gain 2 life."', () => {
  const GREETER = card('Test Greeter', 'Sorcery', 'Mill four cards. You may put a land card from among them into your hand. If you put a Town card into your hand this way, you gain 2 life.');
  const game = (): GameState => scenario(LANDS, { p1: { hand: ['Test Greeter'], graveyard: ['Test Cavern'], library: ['Test Elf', 'Test Town', 'Swamp', 'Test Rock', 'Test Town'] }, defs: [GREETER, ELF, TOWN, ROCK, CAVERN] });
  it('is fully automated; only the lands among the four milled cards are offered (the land already in the graveyard and the fifth card are not)', () => {
    expect(full(GREETER)).toBe(true);
    const s = cast(game(), 'Test Greeter');
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.min).toBe(0);
    expect(s.pending.max).toBe(1);
    expect(names(s, options(s))).toEqual(['Swamp', 'Test Town']);
  });
  it('putting the Town card into the hand gains 2 life', () => {
    const s = cast(game(), 'Test Greeter');
    const done = settle(s, [pick(s, 'Test Town')]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Test Town']);
    expect(life(done, 'p1')).toBe(22);
  });
  it('putting another land into the hand, or none, gains nothing', () => {
    const s = cast(game(), 'Test Greeter');
    const other = settle(s, [pick(s, 'Swamp')]);
    expect(zoneNames(other, 'hand', 'p1')).toEqual(['Swamp']);
    expect(life(other, 'p1')).toBe(20);
    const none = settle(s, [{ kind: 'chooseObjects', ids: [] }]);
    expect(zoneNames(none, 'hand', 'p1')).toEqual([]);
    expect(life(none, 'p1')).toBe(20);
  });
  it('a Town card among the milled cards that you do not put into your hand gains nothing', () => {
    const s = cast(game(), 'Test Greeter');
    const done = settle(s, [pick(s, 'Swamp')]);
    expect(zoneNames(done, 'graveyard', 'p1')).toContain('Test Town');
    expect(life(done, 'p1')).toBe(20);
  });
});

describe('CR 701.17a, 608.2c, 608.2e: "Mill three cards. You may put a land card from among them into your hand. If you don\'t, put a +1/+1 counter on this creature." (the same sentences, read by the named move)', () => {
  const HORSE = card('Test Horse', 'Creature — Horse', 'When Test Horse enters, mill three cards. You may put a land card from among them into your hand. If you don\'t, put a +1/+1 counter on this creature.', ['1', '1']);
  const game = (library: string[]): GameState => scenario(LANDS, { p1: { hand: ['Test Horse'], library }, defs: [HORSE, ELF, ROCK, TOWN] });
  const counters = (s: GameState): number => s.objects[find(s, 'Test Horse', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0;
  it('a land is put into the hand: no counter; none put (declined, or no land among the milled cards): the counter', () => {
    expect(full(HORSE)).toBe(true);
    // the creature spell resolves, then its enters trigger does
    const enter = (s0: GameState): GameState => settle(pass(pass(pass(pass(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Horse', 'hand', 'p1') }))))));
    const entered = enter(game(['Test Elf', 'Test Town', 'Test Rock', 'Test Rock']));
    expect(entered.pending?.kind).toBe('chooseObjects');
    if (entered.pending?.kind !== 'chooseObjects') return;
    const taken = settle(entered, [pick(entered, 'Test Town')]);
    expect(zoneNames(taken, 'hand', 'p1')).toEqual(['Test Town']);
    expect(counters(taken)).toBe(0);
    const declined = settle(entered, [{ kind: 'chooseObjects', ids: [] }]);
    expect(zoneNames(declined, 'hand', 'p1')).toEqual([]);
    expect(counters(declined)).toBe(1);
    const none = enter(game(['Test Elf', 'Test Rock', 'Test Rock', 'Test Rock']));
    expect(none.pending?.kind).toBe('priority'); // no land among the milled cards: nothing to choose
    expect(counters(none)).toBe(1);
  });
});

describe('CR 701.17a, 608.2c: "... from among the milled cards" names the same cards as "... from among them"', () => {
  const RESCUE = card('Test Rescue', 'Sorcery', 'Mill two cards. You may put a permanent card from among the milled cards into your hand. You gain 2 life.');
  it('offers the two milled cards only, puts the chosen permanent card into the hand and gains 2 life', () => {
    expect(full(RESCUE)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Rescue'], graveyard: ['Test Rock'], library: ['Test Rock', 'Test Bolt', 'Test Rock'] }, defs: [RESCUE, ROCK, BOLT] });
    const s = cast(s0, 'Test Rescue');
    expect(names(s, options(s))).toEqual(['Test Rock']); // the Bolt is no permanent card, the third Rock was not milled, the Rock already in the graveyard is not offered
    const done = settle(s, [pick(s, 'Test Rock')]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Test Rock']);
    expect(life(done, 'p1')).toBe(22);
  });
});

describe('CR 701.17a, 110.4, 608.2d: "Mill three cards. You may put a permanent card from among them into your hand."', () => {
  const SCOUT = card('Test Scout', 'Sorcery', 'Mill three cards. You may put a permanent card from among them into your hand.');
  it('offers the milled permanent cards, not the milled instant or a permanent card already in the graveyard', () => {
    expect(full(SCOUT)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Scout'], graveyard: ['Test Elf'], library: ['Test Rock', 'Test Bolt', 'Test Town', 'Test Elf'] }, defs: [SCOUT, ROCK, BOLT, TOWN, ELF] });
    const s = cast(s0, 'Test Scout');
    expect(names(s, options(s))).toEqual(['Test Rock', 'Test Town']);
    const done = settle(s, [pick(s, 'Test Rock')]);
    expect(zoneNames(done, 'hand', 'p1')).toEqual(['Test Rock']);
  });
});

describe('CR 701.23a, 608.2c, 110.2: "Search your library for up to two Forest cards and reveal them. Put one of them onto the battlefield tapped and the other into your hand, then shuffle."', () => {
  const KIN = card('Test Bloom', 'Sorcery', 'Search your library for up to two Forest cards and reveal them. Put one of them onto the battlefield tapped and the other into your hand, then shuffle.');
  const game = (forests: number): GameState => scenario(LANDS, { p1: { hand: ['Test Bloom'], library: ['Test Elf', ...Array(forests).fill('Forest')] }, defs: [KIN, ELF] });
  it('two Forests found: you choose which one enters tapped; the other goes to your hand', () => {
    expect(full(KIN)).toBe(true);
    let s = cast(game(3), 'Test Bloom');
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.max).toBe(2);
    expect(names(s, options(s))).toEqual(['Forest', 'Forest', 'Forest']);
    s = settle(s, [{ kind: 'chooseObjects', ids: options(s).slice(0, 2) }]);
    expect(s.pending?.kind).toBe('chooseObjects'); // which of the two enters the battlefield
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.min).toBe(1);
    expect(s.pending.max).toBe(1);
    expect(s.pending.options).toHaveLength(2);
    const chosen = s.pending.options[1]!;
    s = settle(s, [{ kind: 'chooseObjects', ids: [chosen] }]);
    expect(battlefieldNames(s, 'p1').filter((n) => n === 'Forest')).toHaveLength(1);
    const forest = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Forest')!;
    expect(s.objects[forest]!.tapped).toBe(true);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Forest']);
  });
  it('only one Forest in the library: it enters tapped and nothing goes to the hand', () => {
    const found = cast(game(1), 'Test Bloom');
    expect(options(found)).toHaveLength(1); // a search may find fewer than it could (CR 701.23b); this player finds it
    const s = settle(found, [{ kind: 'chooseObjects', ids: options(found) }]);
    expect(s.pending?.kind).toBe('priority'); // one card found: nothing to choose between
    expect(battlefieldNames(s, 'p1').filter((n) => n === 'Forest')).toHaveLength(1);
    expect(s.objects[s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Forest')!]!.tapped).toBe(true);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
  });
  it('you may find fewer: none found, nothing happens (and the library is still shuffled)', () => {
    let s = cast(game(2), 'Test Bloom');
    s = settle(s, [{ kind: 'chooseObjects', ids: [] }]);
    expect(battlefieldNames(s, 'p1').filter((n) => n === 'Forest')).toHaveLength(0);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
  });
  it('"Put two of them onto the battlefield tapped and the other into your hand": three found, two enter', () => {
    const SYNC = card('Test Sync', 'Sorcery', 'Search your library for up to three Island cards and reveal them. Put two of them onto the battlefield tapped and the other into your hand, then shuffle.');
    expect(full(SYNC)).toBe(true);
    const s0 = scenario(LANDS, { p1: { hand: ['Test Sync'], library: ['Island', 'Island', 'Island', 'Island'] }, defs: [SYNC] });
    let s = cast(s0, 'Test Sync');
    s = settle(s, [{ kind: 'chooseObjects', ids: options(s).slice(0, 3) }]);
    expect(s.pending?.kind).toBe('chooseObjects');
    if (s.pending?.kind !== 'chooseObjects') return;
    expect(s.pending.min).toBe(2);
    expect(s.pending.max).toBe(2);
    s = settle(s, [{ kind: 'chooseObjects', ids: s.pending.options.slice(0, 2) }]);
    const entered = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Island');
    expect(entered).toHaveLength(2);
    expect(entered.every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Island']);
  });
});
