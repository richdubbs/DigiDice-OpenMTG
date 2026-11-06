/**
 * Round edh-d-31 (Commander lane mana, second pass): the behaviour it added, played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 *
 *   CR 105.2, 106.5, 605.1a   "{T}: Choose a color of a permanent you control. Add one mana of that color." (Meteor Crater) and "... of a card in your graveyard." (Corrupted Grafstone)
 *   CR 603.7a, 614.1c, 605.3b  "{T}: Add {G}. When you next cast a Bird creature spell this turn, it enters with an additional +1/+1 counter on it." (Chocobo Camp), "... that creature enters with
 *                              two additional +1/+1 counters on it." (Yuna, Grand Summoner's first ability)
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { act, answer, find, legal, life, pass, pool, scenario } from '../../m3/scenario';
import { compileCard, type CardDef, type OracleCard } from '../../../src/index';
import { card, full, resolveAll } from '../cmd3/helpers';

/** A synthetic card with the colors its mana cost has (the cmd3 helper's cards are colorless). */
function colored(name: string, type: string, text: string, pt: [string, string] | undefined, cost: string): CardDef {
  const colors = (['W', 'U', 'B', 'R', 'G'] as const).filter((c) => cost.includes(`{${c}}`));
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const activateOf = (s: GameState, name: string) => legal(s, 'p1', 'activate').find((a) => a.object !== undefined && nameOf(s, a.object) === name);

// ---- Meteor Crater / Corrupted Grafstone ----------------------------------------------------------------------------------------------------------------------------
const CRATER = card('Test Crater', 'Land', '{T}: Choose a color of a permanent you control. Add one mana of that color.');
const REDBEAR = colored('Test Redbear', 'Creature — Bear', 'Vigilance', ['1', '1'], '{R}');
const BLUEBEAR = colored('Test Bluebear', 'Creature — Bear', 'Vigilance', ['1', '1'], '{U}');
const GRAY = card('Test Gray', 'Artifact', 'Indestructible', undefined, '{2}');
const GRAFSTONE = card('Test Grafstone', 'Artifact', 'This artifact enters tapped.\n{T}: Choose a color of a card in your graveyard. Add one mana of that color.');

describe('CR 105.2, 106.5, 605.1a: "Choose a color of a permanent you control. Add one mana of that color." (Meteor Crater)', () => {
  it('the card is fully automated and its activation is a mana ability', () => {
    expect(full(CRATER), JSON.stringify(CRATER.automation)).toBe(true);
    const s = scenario([], { defs: [CRATER], p1: { battlefield: ['Test Crater'] } });
    expect(activateOf(s, 'Test Crater')?.isMana).toBe(true);
  });
  it('a red and a blue permanent: the player chooses one of those two colors and gets one mana of it', () => {
    const s0 = scenario([], { defs: [CRATER, REDBEAR, BLUEBEAR], p1: { battlefield: ['Test Crater', 'Test Redbear', 'Test Bluebear'] } });
    let s = act(s0, activateOf(s0, 'Test Crater')!.action);
    expect(s.pending?.kind).toBe('chooseColor');
    const options = (s.pending as unknown as { options?: string[] }).options;
    if (options) expect([...options].sort()).toEqual(['R', 'U']);
    s = answer(s, { kind: 'chooseColor', color: 'U' });
    expect(pool(s, 'p1')).toBe('U');
    expect(s.objects[find(s, 'Test Crater', 'battlefield')]!.tapped).toBe(true);
  });
  it('negative: one color only (red): that color is the only one chosen, and green is never produced; a red card in the graveyard is not a permanent and adds nothing', () => {
    const s0 = scenario([], { defs: [CRATER, REDBEAR, BLUEBEAR], p1: { battlefield: ['Test Crater', 'Test Redbear'], graveyard: ['Test Bluebear'] } });
    const s = act(s0, activateOf(s0, 'Test Crater')!.action);
    expect(s.pending?.kind === 'chooseColor' ? 'asked' : pool(s, 'p1')).toBe(s.pending?.kind === 'chooseColor' ? 'asked' : 'R');
    if (s.pending?.kind === 'chooseColor') expect(() => answer(s, { kind: 'chooseColor', color: 'U' })).toThrow();
  });
  it('negative: only colorless permanents (the Crater itself is colorless): no color to choose, no mana', () => {
    const s0 = scenario([], { defs: [CRATER, GRAY], p1: { battlefield: ['Test Crater', 'Test Gray'] } });
    const s = act(s0, activateOf(s0, 'Test Crater')!.action);
    expect(s.pending?.kind === 'chooseColor').toBe(false);
    expect(pool(s, 'p1')).toBe('');
  });
  it('negative: a permanent an opponent controls does not count', () => {
    const s0 = scenario([], { defs: [CRATER, BLUEBEAR], p1: { battlefield: ['Test Crater'] }, p2: { battlefield: ['Test Bluebear'] } });
    const s = act(s0, activateOf(s0, 'Test Crater')!.action);
    expect(pool(s, 'p1')).toBe('');
  });
});

describe('CR 105.2, 106.5: "Choose a color of a card in your graveyard. Add one mana of that color." (Corrupted Grafstone)', () => {
  it('the card is fully automated', () => expect(full(GRAFSTONE), JSON.stringify(GRAFSTONE.automation)).toBe(true));
  it('a blue card in your graveyard gives {U}; a card in an opponent\'s graveyard or on the battlefield does not count', () => {
    const s0 = scenario([], { defs: [GRAFSTONE, BLUEBEAR, REDBEAR], p1: { battlefield: ['Test Grafstone', 'Test Redbear'], graveyard: ['Test Bluebear'] } });
    const s = act(s0, activateOf(s0, 'Test Grafstone')!.action);
    const pending = s.pending as unknown as { kind: string } | null;
    const done = pending?.kind === 'chooseColor' ? answer(s, { kind: 'chooseColor', color: 'U' }) : s;
    expect(pool(done, 'p1')).toBe('U');
    const t0 = scenario([], { defs: [GRAFSTONE, BLUEBEAR, REDBEAR], p1: { battlefield: ['Test Grafstone', 'Test Redbear'] }, p2: { graveyard: ['Test Bluebear'] } });
    const t = act(t0, activateOf(t0, 'Test Grafstone')!.action);
    expect(pool(t, 'p1')).toBe('');
  });
});

// ---- Chocobo Camp / Yuna -----------------------------------------------------------------------------------------------------------------------------------------
const CAMP = card('Test Camp', 'Land', '{T}: Add {G}. When you next cast a Bird creature spell this turn, it enters with an additional +1/+1 counter on it.');
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '1'], '{G}');
const BEAR = card('Test Greenbear', 'Creature — Bear', 'Vigilance', ['1', '1'], '{G}');
const BEAR2 = card('Test Greenbear Two', 'Creature — Bear', 'Vigilance', ['1', '1'], '{G}');
const BOLT = card('Test Gain', 'Instant', 'You gain 1 life.', undefined, '{G}');
const SUMMONER = card('Test Summoner', 'Legendary Creature — Human', '{T}: Add one mana of any color. When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it.', ['1', '1']);

describe('CR 603.7a, 614.1c, 605.3b: "{T}: Add {G}. When you next cast a Bird creature spell this turn, it enters with an additional +1/+1 counter on it." (Chocobo Camp)', () => {
  it('the card is fully automated and its activation is a mana ability (it does not use the stack)', () => {
    expect(full(CAMP), JSON.stringify(CAMP.automation)).toBe(true);
    const s = scenario([], { defs: [CAMP], p1: { battlefield: ['Test Camp'] } });
    expect(activateOf(s, 'Test Camp')?.isMana).toBe(true);
  });
  const board = (): GameState => scenario(['Forest'], { defs: [CAMP, BIRD, BEAR, BEAR2, BOLT], p1: { hand: ['Test Bird', 'Test Greenbear', 'Test Greenbear Two', 'Test Gain'], battlefield: ['Test Camp', 'Forest', 'Forest', 'Forest'] } });
  it('the next Bird spell cast this turn enters with an additional +1/+1 counter', () => {
    const s0 = board();
    let s = act(s0, activateOf(s0, 'Test Camp')!.action);
    expect(pool(s, 'p1')).toBe('G');
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bird', 'hand') }));
    expect(s.objects[find(s, 'Test Bird', 'battlefield')]!.counters['+1/+1']).toBe(1);
  });
  it('negative: a Bear spell and an instant do not use it up and get nothing; the Bird cast after them still gets the counter', () => {
    const s0 = board();
    let s = act(s0, activateOf(s0, 'Test Camp')!.action);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Greenbear', 'hand') }));
    expect(s.objects[find(s, 'Test Greenbear', 'battlefield')]!.counters['+1/+1'] ?? 0).toBe(0);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Gain', 'hand') }));
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bird', 'hand') }));
    expect(s.objects[find(s, 'Test Bird', 'battlefield')]!.counters['+1/+1']).toBe(1);
  });
  it('once: a second Bird spell cast the same turn gets nothing', () => {
    const b2 = card('Test Bird Two', 'Creature — Bird', 'Flying', ['1', '1'], '{G}');
    const s0 = scenario(['Forest'], { defs: [CAMP, BIRD, b2], p1: { hand: ['Test Bird', 'Test Bird Two'], battlefield: ['Test Camp', 'Forest', 'Forest'] } });
    let s = act(s0, activateOf(s0, 'Test Camp')!.action);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bird', 'hand') }));
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bird Two', 'hand') }));
    expect(s.objects[find(s, 'Test Bird', 'battlefield')]!.counters['+1/+1']).toBe(1);
    expect(s.objects[find(s, 'Test Bird Two', 'battlefield')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 603.7a, 614.1c: "... that creature enters with two additional +1/+1 counters on it." (Yuna, Grand Summoner)', () => {
  // edh-next-84: the template is stable now (Yuna, Grand Summoner is full: its second ability, "that number of", is edh-next-84's); this synthetic card has the mana ability alone, which is full
  it('the wording "that creature enters with two additional ... counters" (stable since edh-next-84, Yuna, Grand Summoner as its golden card): the mana ability is full', () => {
    expect(full(SUMMONER)).toBe(true);
  });
  it('any creature spell cast next this turn enters with two +1/+1 counters; the next one does not', () => {
    const s0 = scenario(['Forest'], { defs: [SUMMONER, BEAR, BEAR2], p1: { hand: ['Test Greenbear', 'Test Greenbear Two'], battlefield: ['Test Summoner', 'Forest', 'Forest'] } });
    let s = act(s0, activateOf(s0, 'Test Summoner')!.action);
    s = answer(s, { kind: 'chooseColor', color: 'G' });
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Greenbear', 'hand') }));
    expect(s.objects[find(s, 'Test Greenbear', 'battlefield')]!.counters['+1/+1']).toBe(2);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Greenbear Two', 'hand') }));
    expect(s.objects[find(s, 'Test Greenbear Two', 'battlefield')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

// ---- Sorcerer Class ------------------------------------------------------------------------------------------------------------------------------------------------
const CLASS = card('Test Class', 'Enchantment — Class', '(Gain the next level as a sorcery to add its ability.)\nWhen this Class enters, you gain 1 life.\n{1}: Level 2\nCreatures you control have "{T}: Add {U} or {R}. Spend this mana only to cast an instant or sorcery spell or to gain a Class level."\n{U}: Level 3\nWhenever you cast an instant or sorcery spell, you gain 1 life.');
const WORKER = card('Test Worker', 'Creature — Human', 'Vigilance', ['1', '1']);
const PINGER = card('Test Pinger', 'Artifact', '{U}: You gain 1 life.');
const INSTANT = card('Test Spark', 'Instant', 'You gain 2 life.', undefined, '{U}');
const CREATURE_SPELL = card('Test Cub', 'Creature — Bear', 'Vigilance', ['1', '1'], '{U}');

describe('CR 106.6, 716.2a: "Spend this mana only to cast an instant or sorcery spell or to gain a Class level." (Sorcerer Class)', () => {
  it('the Class is fully automated', () => expect(full(CLASS), JSON.stringify(CLASS.automation)).toBe(true));
  const board = (hand: string[] = []): GameState => {
    const s = scenario([], { defs: [CLASS, WORKER, PINGER, INSTANT, CREATURE_SPELL], p1: { hand, battlefield: ['Test Class', 'Test Worker', 'Test Pinger'] } });
    s.objects[find(s, 'Test Class', 'battlefield')]!.classLevel = 2;
    return s;
  };
  const levelUp = (s: GameState) => legal(s, 'p1', 'activate').find((a) => a.object !== undefined && nameOf(s, a.object) === 'Test Class' && /Level 3/i.test(a.label));
  it('the level-up cost {U} of the next level is paid with the creature\'s restricted mana: the Class becomes level 3', () => {
    const s0 = board();
    expect(levelUp(s0), 'the level-up is available with the creature as the only source').toBeDefined();
    let s = act(s0, levelUp(s0)!.action);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = resolveAll(s);
    expect(s.objects[find(s, 'Test Class', 'battlefield')]!.classLevel).toBe(3);
    expect(s.objects[find(s, 'Test Worker', 'battlefield')]!.tapped).toBe(true);
  });
  it('negative: the same mana cannot pay for another ability ("{U}: You gain 1 life" of the Pinger is not offered) nor for a creature spell', () => {
    const s0 = board(['Test Cub']);
    expect(legal(s0, 'p1', 'activate').some((a) => a.object !== undefined && nameOf(s0, a.object) === 'Test Pinger' && !a.isMana)).toBe(false);
    expect(legal(s0, 'p1', 'cast').some((a) => a.object !== undefined && nameOf(s0, a.object) === 'Test Cub')).toBe(false);
  });
  it('an instant spell can be cast with it', () => {
    const s0 = board(['Test Spark']);
    expect(legal(s0, 'p1', 'cast').some((a) => a.object !== undefined && nameOf(s0, a.object) === 'Test Spark')).toBe(true);
  });
});

// ---- Brass Infiniscope ---------------------------------------------------------------------------------------------------------------------------------------------
const SCOPE = card('Test Scope', 'Artifact', '{T}: Add {C}{C}. When you next cast a spell with {X} in its mana cost this turn, you draw a card and gain half X life, rounded down.');
const FLARE = card('Test Flare', 'Sorcery', 'Draw a card.', undefined, '{X}{R}');
const PLAIN_SPELL = card('Test Plain', 'Sorcery', 'You gain 1 life.', undefined, '{R}');

/** Cast `name` announcing X = `x` when asked, pay automatically, and let the stack resolve. */
function castX(s0: GameState, name: string, x: number): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand') });
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x } as never);
    else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else break;
  }
  return resolveAll(s);
}
const handSize = (s: GameState): number => (s.zones.hand['p1'] ?? []).length;

describe('CR 603.7a, 107.3e, 107.1a: "When you next cast a spell with {X} in its mana cost this turn, you draw a card and gain half X life, rounded down." (Brass Infiniscope)', () => {
  it('the card is fully automated and its activation is a mana ability', () => {
    expect(full(SCOPE), JSON.stringify(SCOPE.automation)).toBe(true);
    const s = scenario([], { defs: [SCOPE], p1: { battlefield: ['Test Scope'] } });
    expect(activateOf(s, 'Test Scope')?.isMana).toBe(true);
  });
  const board = (): GameState => scenario(['Mountain'], { defs: [SCOPE, FLARE, PLAIN_SPELL], p1: { hand: ['Test Flare', 'Test Plain'], battlefield: ['Test Scope', 'Mountain', 'Mountain', 'Mountain'] } });
  for (const [x, gain] of [[4, 2], [3, 1], [1, 0], [0, 0]] as const) {
    it(`X = ${x}: the spell cast draws a card (besides its own) and gains ${gain} life (half X rounded down)`, () => {
      const s0 = board();
      const l0 = life(s0, 'p1');
      const h0 = handSize(s0);
      let s = act(s0, activateOf(s0, 'Test Scope')!.action);
      expect(pool(s, 'p1')).toBe('CC');
      s = castX(s, 'Test Flare', x);
      expect(life(s, 'p1') - l0).toBe(gain);
      expect(handSize(s)).toBe(h0 - 1 + 2); // the spell left the hand; the trigger drew one and the spell itself drew one
    });
  }
  it('negative: a spell without {X} does not use it up and draws nothing extra; the X spell cast after it still gets it', () => {
    const s0 = board();
    const l0 = life(s0, 'p1');
    let s = act(s0, activateOf(s0, 'Test Scope')!.action);
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Plain', 'hand') }));
    expect(life(s, 'p1') - l0).toBe(1); // only the plain spell's own gain
    const h1 = handSize(s);
    s = castX(s, 'Test Flare', 3);
    expect(life(s, 'p1') - l0).toBe(1 + 1);
    expect(handSize(s)).toBe(h1 - 1 + 2);
  });
  it('once: a second spell with {X} the same turn gets nothing', () => {
    const f2 = card('Test Flare Two', 'Sorcery', 'You gain 0 life.', undefined, '{X}{R}');
    const s0 = scenario(['Mountain'], { defs: [SCOPE, FLARE, f2], p1: { hand: ['Test Flare', 'Test Flare Two'], battlefield: ['Test Scope', 'Mountain', 'Mountain', 'Mountain', 'Mountain'] } });
    let s = act(s0, activateOf(s0, 'Test Scope')!.action);
    s = castX(s, 'Test Flare', 2);
    const l1 = life(s, 'p1');
    s = castX(s, 'Test Flare Two', 2);
    expect(life(s, 'p1')).toBe(l1);
  });
});
