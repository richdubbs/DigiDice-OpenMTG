/**
 * edh-zones-3 (Commander effort, lane edh-zones): "When ~ is put into a graveyard from anywhere" (lower/trigger-zone.ts, CR 603.6c, 113.6k), played through the engine with
 * synthetic cards (invented names and wordings, design 6.10), compiled by the game's default compiler. CR cites checked against MagicCompRules 20260925.
 *
 *   CR 603.6c, 113.6k   the ability is never a leaves-the-battlefield ability, whatever zone the card comes from; it functions in the graveyard it arrives in, for the card's owner
 *   CR 400.3, 701.24a   "its owner shuffles their graveyard into their library", "shuffle it into its owner's library": the owner's, whoever controlled the card
 *   CR 111.7            a token that is put into a graveyard triggers it before it ceases to exist
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { activate, resolveAll } from '../../m5/cr-examples/helpers';
import { drive, lifeOf, mpScenario, resolveStack } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.objects[id]!.defId);
const inLibrary = (s: GameState, p: PlayerId, name: string): number => names(s, s.zones.library[p]!).filter((n) => n === name).length;

/** Resolve everything, answering yes/no with `yes`, costs automatically and targets with none, until the stack is empty and p1 has priority. */
function settle(s0: GameState, yes = true): GameState {
  let s = s0;
  for (let guard = 0; guard < 300 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending;
    if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}

const SHUFFLER = card('Test Void Colossus', 'Creature — Eldrazi', 'When ~ is put into a graveyard from anywhere, its owner shuffles their graveyard into their library.', ['4', '4']);
const WURM = card('Test Return Wurm', 'Creature — Wurm', 'When ~ is put into a graveyard from anywhere, shuffle it into its owner\'s library.', ['5', '5']);
const WRATH = card('Test Sweep', 'Sorcery', 'Destroy all creatures.');
const TOSS = card('Test Toss', 'Sorcery', 'Discard a card.');
const SIFT = card('Test Deep Sift', 'Sorcery', 'Mill ten cards.');
const BANISH = card('Test Banish', 'Sorcery', 'Exile all creatures.');
const BOUNCE = card('Test Scatter', 'Sorcery', 'Return all creatures to their owners\' hands.');
const BYSTANDER = card('Test Bystander', 'Creature — Bear', 'Vigilance', ['1', '1']);

describe('CR 603.6c, 113.6k: "When ~ is put into a graveyard from anywhere, its owner shuffles their graveyard into their library."', () => {
  it('is parsed and automated: a triggered ability that functions in the graveyard, with no origin zone', () => {
    expect(automated(SHUFFLER)).toBe(true);
    const json = JSON.stringify(SHUFFLER.faces[0]!.abilities);
    expect(json).toContain('"zone":["graveyard"]');
    expect(json).toContain('"trigger":{"on":[{"ev":"zoneChange","subject":{"self":true},"to":"graveyard"}]}');
  });
  it('destroyed on the battlefield, it triggers and its owner shuffles the whole graveyard (itself included) into the library', () => {
    let s = scenario([], { p1: { hand: ['Test Sweep'], battlefield: ['Test Void Colossus'], graveyard: ['Plains', 'Plains'] }, defs: [SHUFFLER, WRATH] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sweep', 'hand', 'p1') });
    s = settle(s);
    expect(s.zones.graveyard['p1']).toEqual([]);
    expect(inLibrary(s, 'p1', 'Test Void Colossus')).toBe(1);
    expect(inLibrary(s, 'p1', 'Test Sweep')).toBe(1);
  });
  it("another player's card destroyed: its OWNER's graveyard is shuffled, not the graveyard of the player who destroyed it", () => {
    let s = scenario([], { p1: { hand: ['Test Sweep'], graveyard: ['Plains'] }, p2: { battlefield: ['Test Void Colossus'], graveyard: ['Plains', 'Plains'] }, defs: [SHUFFLER, WRATH] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sweep', 'hand', 'p1') });
    s = settle(s);
    expect(s.zones.graveyard['p2']).toEqual([]);
    expect(inLibrary(s, 'p2', 'Test Void Colossus')).toBe(1);
    expect(names(s, s.zones.graveyard['p1']!).sort()).toEqual(['Plains', 'Test Sweep']);
  });
  it('discarded from the hand, it triggers from the graveyard it arrived in', () => {
    let s = scenario([], { p1: { hand: ['Test Toss', 'Test Void Colossus'], graveyard: ['Plains'] }, defs: [SHUFFLER, TOSS] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Toss', 'hand', 'p1') });
    s = settle(s);
    expect(s.zones.graveyard['p1']).toEqual([]);
    expect(inLibrary(s, 'p1', 'Test Void Colossus')).toBe(1);
  });
  it('milled from the library, it triggers from the graveyard it arrived in', () => {
    let s = scenario([], { p1: { hand: ['Test Deep Sift'], library: ['Test Void Colossus'], graveyard: ['Plains'] }, defs: [SHUFFLER, SIFT] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Deep Sift', 'hand', 'p1') });
    s = settle(s);
    expect(s.zones.graveyard['p1']).toEqual([]);
    expect(inLibrary(s, 'p1', 'Test Void Colossus')).toBe(1);
  });
  it('the negative cases: exiled, or returned to the hand, it does not go to a graveyard and does not trigger; another card put into the graveyard does not trigger it', () => {
    for (const spell of ['Test Banish', 'Test Scatter']) {
      let s = scenario([], { p1: { hand: [spell], battlefield: ['Test Void Colossus'], graveyard: ['Plains'] }, defs: [SHUFFLER, BANISH, BOUNCE] });
      s = act(s, { type: 'cast', player: 'p1', card: find(s, spell, 'hand', 'p1') });
      s = settle(s);
      expect(names(s, s.zones.graveyard['p1']!), spell).toContain('Plains');
      expect(inLibrary(s, 'p1', 'Test Void Colossus'), spell).toBe(0);
    }
    let s = scenario([], { p1: { hand: ['Test Toss', 'Test Bystander'], battlefield: ['Test Void Colossus'], graveyard: ['Plains'] }, defs: [SHUFFLER, TOSS, BYSTANDER] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Toss', 'hand', 'p1') });
    s = settle(s);
    expect(names(s, s.zones.graveyard['p1']!).sort()).toEqual(['Plains', 'Test Bystander', 'Test Toss']);
    expect(names(s, s.zones.battlefield)).toContain('Test Void Colossus');
  });
});

describe('CR 603.6c, 701.24a: "When ~ is put into a graveyard from anywhere, shuffle it into its owner\'s library."', () => {
  it('is parsed and automated: it is the card in the graveyard that goes into its owner\'s library, and that library is shuffled', () => {
    expect(automated(WURM)).toBe(true);
  });
  it('destroyed on the battlefield, it goes from the graveyard into its owner\'s library; the other cards stay in the graveyard', () => {
    let s = scenario([], { p1: { hand: ['Test Sweep'], battlefield: ['Test Return Wurm'], graveyard: ['Plains'] }, defs: [WURM, WRATH] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sweep', 'hand', 'p1') });
    s = settle(s);
    expect(inLibrary(s, 'p1', 'Test Return Wurm')).toBe(1);
    expect(names(s, s.zones.graveyard['p1']!).sort()).toEqual(['Plains', 'Test Sweep']);
  });
  it("an opponent's destroyed: it goes into its owner's library, not into the library of the player who destroyed it", () => {
    let s = scenario([], { p1: { hand: ['Test Sweep'] }, p2: { battlefield: ['Test Return Wurm'] }, defs: [WURM, WRATH] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sweep', 'hand', 'p1') });
    s = settle(s);
    expect(inLibrary(s, 'p2', 'Test Return Wurm')).toBe(1);
    expect(inLibrary(s, 'p1', 'Test Return Wurm')).toBe(0);
  });
  it('discarded from the hand it triggers too; exiled it does not', () => {
    let s = scenario([], { p1: { hand: ['Test Toss', 'Test Return Wurm'] }, defs: [WURM, TOSS] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Toss', 'hand', 'p1') });
    s = settle(s);
    expect(inLibrary(s, 'p1', 'Test Return Wurm')).toBe(1);
    let t = scenario([], { p1: { hand: ['Test Banish'], battlefield: ['Test Return Wurm'] }, defs: [WURM, BANISH] });
    t = act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Banish', 'hand', 'p1') });
    t = settle(t);
    expect(inLibrary(t, 'p1', 'Test Return Wurm')).toBe(0);
  });
});

describe('CR 111.7, 603.6c: a token put into a graveyard triggers "from anywhere" abilities before it ceases to exist', () => {
  const COPIER = card('Test Husk Maker', 'Sorcery', 'For each creature you control, create a token that\'s a copy of it.');
  const tokensOf = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
  it('is parsed and automated', () => {
    expect(automated(COPIER)).toBe(true);
  });
  it('a token copy is destroyed while the card lives: the token\'s own ability shuffles its owner\'s graveyard into the library, though the token itself is gone', () => {
    const SNIPE = card('Test Snipe', 'Sorcery', 'Destroy target creature.');
    let s = scenario([], { p1: { hand: ['Test Husk Maker', 'Test Snipe'], battlefield: ['Test Void Colossus'], graveyard: ['Plains', 'Plains'] }, defs: [SHUFFLER, COPIER, SNIPE] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Husk Maker', 'hand', 'p1') });
    s = settle(s);
    const [token] = tokensOf(s);
    expect(token).toBeDefined();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Snipe', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: token! }] });
    s = settle(s);
    expect(tokensOf(s)).toEqual([]);
    expect(s.log.filter((l) => /triggers: When/.test(l.text) && /Test Void Colossus/.test(l.text)).length).toBe(1); // one trigger, no phantom
    expect(s.log.some((l) => /can't find the triggered ability/.test(l.text))).toBe(false);
    expect(names(s, s.zones.battlefield)).toEqual(['Test Void Colossus']); // the card itself did not die and did not trigger
    expect(s.zones.graveyard['p1']).toEqual([]);
    expect(inLibrary(s, 'p1', 'Test Husk Maker')).toBe(1);
    expect(inLibrary(s, 'p1', 'Test Snipe')).toBe(1);
  });
});

const nameCount = (s: GameState, ids: readonly string[], name: string): number => names(s, ids).filter((n) => n === name).length;
const bf = (s: GameState): string[] => names(s, s.zones.battlefield).sort();
const yesAnswer: DecisionAnswer = { kind: 'yesNo', yes: true };
const noAnswer: DecisionAnswer = { kind: 'yesNo', yes: false };

describe('CR 700.6, 205.4a: "Return each nonland permanent that\'s not historic to its owner\'s hand." / "Exile all nonland permanents that aren\'t legendary."', () => {
  const RECALL = card('Test Recall', 'Instant', "Return each nonland permanent that's not historic to its owner's hand.");
  const PURGE = card('Test Purge', 'Sorcery', "Exile all nonland permanents that aren't legendary.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const KING = card('Test King', 'Legendary Creature — Bear', '', ['3', '3']);
  const RELIC = card('Test Relic', 'Artifact', '');
  const TOWER = card('Test Tower', 'Enchantment — Saga', '');
  const WARD = card('Test Ward', 'Enchantment', '');
  const DEFS = [RECALL, PURGE, BEAR, KING, RELIC, TOWER, WARD];
  it('both are parsed and automated', () => { expect(automated(RECALL)).toBe(true); expect(automated(PURGE)).toBe(true); });
  it('not historic: the nonartifact, nonlegendary non-Saga nonland permanents of every player go to their owners\' hands; an artifact, a legendary permanent, a Saga and a land stay', () => {
    let s = scenario([], { p1: { hand: ['Test Recall'], battlefield: ['Test Bear', 'Test King', 'Test Relic', 'Test Tower', 'Test Ward', 'Plains'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Recall', 'hand', 'p1') });
    s = settle(s);
    expect(bf(s)).toEqual(['Plains', 'Test King', 'Test Relic', 'Test Tower']);
    expect(names(s, s.zones.hand['p1']!)).toEqual(expect.arrayContaining(['Test Bear', 'Test Ward']));
    expect(names(s, s.zones.hand['p2']!)).toContain('Test Bear');
  });
  it('not legendary: everything but lands and legendary permanents is exiled, artifacts and Sagas included', () => {
    let s = scenario([], { p1: { hand: ['Test Purge'], battlefield: ['Test Bear', 'Test King', 'Test Relic', 'Test Tower', 'Plains'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Purge', 'hand', 'p1') });
    s = settle(s);
    expect(bf(s)).toEqual(['Plains', 'Test King']);
    expect(names(s, s.zones.exile).sort()).toEqual(['Test Bear', 'Test Bear', 'Test Relic', 'Test Tower']);
  });
});

describe('CR 107.1a, 701.17a, 102.2: "Each opponent mills eight cards. If this spell was kicked, instead each opponent mills half their library, rounded up."', () => {
  const FLOOD = card('Test Flood', 'Sorcery', 'Kicker {1}\nEach opponent mills eight cards. If this spell was kicked, instead each opponent mills half their library, rounded up.');
  const libs = (s: GameState, p: PlayerId): number => s.zones.library[p]!.length;
  const board = (): GameState => mpScenario({ players: 3, defs: [FLOOD], zones: { p1: { hand: ['Test Flood'], battlefield: ['Plains'] }, p2: { library: Array(4).fill('Plains') as string[] }, p3: { library: Array(9).fill('Plains') as string[] } } });
  it('is parsed and automated', () => expect(automated(FLOOD)).toBe(true));
  it('kicked: each opponent mills half of THEIR OWN library, rounded up (24 -> 12, 29 -> 15), not of a shared count', () => {
    let s = board();
    expect([libs(s, 'p2'), libs(s, 'p3')]).toEqual([24, 29]);
    const mine = libs(s, 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Flood', 'hand', 'p1') });
    s = resolveStack(drive(s, [yesAnswer]));
    expect([libs(s, 'p2'), libs(s, 'p3')]).toEqual([12, 14]);
    expect(libs(s, 'p1')).toBe(mine);
  });
  it('not kicked: each opponent mills eight', () => {
    let s = board();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Flood', 'hand', 'p1') });
    s = resolveStack(drive(s, [noAnswer]));
    expect([libs(s, 'p2'), libs(s, 'p3')]).toEqual([16, 21]);
  });
});

describe('CR 401.4, 400.3, 608.2c: "When ~ enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order."', () => {
  const INCARNATION = card('Test Rewind Spirit', 'Creature — Elemental', 'When ~ enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order.', ['4', '4']);
  const board = (): GameState => scenario([], { p1: { hand: ['Test Rewind Spirit'], graveyard: ['Plains'] }, p2: { graveyard: ['Plains', 'Plains', 'Plains'] }, defs: [INCARNATION] });
  it('is parsed and automated', () => expect(automated(INCARNATION)).toBe(true));
  it('the target player\'s whole graveyard goes to the bottom of THEIR library; the other graveyard is untouched', () => {
    let s = board();
    const before = s.zones.library['p2']!.length;
    const grave = [...s.zones.graveyard['p2']!];
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rewind Spirit', 'hand', 'p1') });
    s = resolveAll(s, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect(s.zones.graveyard['p2']).toEqual([]);
    expect(s.zones.library['p2']!.length).toBe(before + 3);
    expect(s.zones.library['p2']!.slice(-3).sort()).not.toEqual([]); // (the three cards are the last three of the library: the old objects are gone, new ones are there)
    expect(grave.every((id) => s.objects[id] === undefined)).toBe(true);
    expect(s.zones.graveyard['p1']!.length).toBe(1);
  });
  it('the negative case: no target chosen ("up to one"): nothing moves', () => {
    let s = board();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rewind Spirit', 'hand', 'p1') });
    s = resolveAll(s, [{ kind: 'chooseTargets', targets: [] }]);
    expect(s.zones.graveyard['p2']!.length).toBe(3);
    expect(s.zones.graveyard['p1']!.length).toBe(1);
  });
  it('you may target yourself', () => {
    let s = board();
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rewind Spirit', 'hand', 'p1') });
    s = resolveAll(s, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] }]);
    expect(s.zones.graveyard['p1']).toEqual([]);
    expect(s.zones.graveyard['p2']!.length).toBe(3);
  });
});

describe('CR 701.24a, 400.3: "{2}, {T}: You gain 5 life. Shuffle ~ and your graveyard into their owner\'s library."', () => {
  const ELIXIR = card('Test Phial', 'Artifact', "{2}, {T}: You gain 5 life. Shuffle ~ and your graveyard into their owner's library.");
  it('is parsed and automated', () => expect(automated(ELIXIR)).toBe(true));
  it('you gain 5 life; the artifact and your whole graveyard go into your library; the opponent\'s graveyard stays', () => {
    let s = scenario([], { p1: { battlefield: ['Test Phial', 'Plains', 'Plains'], graveyard: ['Plains', 'Plains'] }, p2: { graveyard: ['Plains'] }, defs: [ELIXIR] });
    const lib = s.zones.library['p1']!.length;
    s = resolveAll(activate(s, find(s, 'Test Phial', 'battlefield'), []));
    expect(lifeOf(s, 'p1')).toBe(25);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Phial')).toBe(false);
    expect(s.zones.graveyard['p1']).toEqual([]);
    expect(s.zones.library['p1']!.length).toBe(lib + 3);
    expect(nameCount(s, s.zones.library['p1']!, 'Test Phial')).toBe(1);
    expect(s.zones.graveyard['p2']!.length).toBe(1);
  });
});

describe('CR 608.2b, 207.2c: "Return target creature card from your graveyard to your hand. Threshold -- Return that card from your graveyard to the battlefield instead if there are seven or more cards in your graveyard."', () => {
  const STITCH = card('Test Stitch', 'Sorcery', 'Return target creature card from your graveyard to your hand.\nThreshold \u2014 Return that card from your graveyard to the battlefield instead if there are seven or more cards in your graveyard.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const run = (filler: number): GameState => {
    let s = scenario([], { p1: { hand: ['Test Stitch'], graveyard: ['Test Bear', ...(Array(filler).fill('Plains') as string[])] }, defs: [STITCH, BEAR] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Stitch', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Bear', 'graveyard', 'p1') }] });
    return resolveAll(s);
  };
  it('is parsed and automated', () => expect(automated(STITCH)).toBe(true));
  it('seven cards in the graveyard (the creature card counts, the spell does not): it returns to the battlefield', () => {
    const s = run(6);
    expect(names(s, s.zones.battlefield)).toContain('Test Bear');
    expect(names(s, s.zones.hand['p1']!)).not.toContain('Test Bear');
  });
  it('the negative case: six cards: it returns to the hand', () => {
    const s = run(5);
    expect(names(s, s.zones.hand['p1']!)).toContain('Test Bear');
    expect(names(s, s.zones.battlefield)).not.toContain('Test Bear');
  });
});

describe('CR 603.2, 603.10a, 400.3: "Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, ~ deals 1 damage to each opponent."', () => {
  const GRIM = card('Test Grim King', 'Legendary Creature — Zombie', 'Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, ~ deals 1 damage to each opponent.', ['3', '2']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const ARTIFACT = card('Test Relic', 'Artifact', '');
  const EXILER = card('Test Exile Spell', 'Sorcery', 'Exile target card from a graveyard.');
  const DEFS = [GRIM, BEAR, ARTIFACT, WRATH, TOSS, SIFT, EXILER];
  it('is parsed and automated', () => expect(automated(GRIM)).toBe(true));
  it('another creature dies: 1 damage for each (Syr Konrad dying with them still sees them)', () => {
    let s = scenario([], { p1: { hand: ['Test Sweep'], battlefield: ['Test Grim King', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Sweep', 'hand', 'p1') });
    s = settle(s);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('a creature card discarded, and a creature card milled: 1 damage each; a noncreature card discarded: none', () => {
    let s = scenario([], { p1: { hand: ['Test Toss', 'Test Bear'], battlefield: ['Test Grim King'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Toss', 'hand', 'p1') });
    s = settle(s);
    expect(lifeOf(s, 'p2')).toBe(19);
    let t = scenario([], { p1: { hand: ['Test Deep Sift'], library: ['Test Bear', 'Test Relic'], battlefield: ['Test Grim King'] }, defs: DEFS });
    t = act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Deep Sift', 'hand', 'p1') });
    t = settle(t);
    expect(lifeOf(t, 'p2')).toBe(19);
    let u = scenario([], { p1: { hand: ['Test Toss', 'Test Relic'], battlefield: ['Test Grim King'] }, defs: DEFS });
    u = act(u, { type: 'cast', player: 'p1', card: find(u, 'Test Toss', 'hand', 'p1') });
    u = settle(u);
    expect(lifeOf(u, 'p2')).toBe(20);
  });
  it('a creature card leaves YOUR graveyard: 1 damage; one leaves an opponent\'s graveyard: none', () => {
    let s = scenario([], { p1: { hand: ['Test Exile Spell'], graveyard: ['Test Bear'], battlefield: ['Test Grim King'] }, defs: DEFS });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Exile Spell', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Bear', 'graveyard', 'p1') }] });
    s = settle(s);
    expect(lifeOf(s, 'p2')).toBe(19);
    let t = scenario([], { p1: { hand: ['Test Exile Spell'], battlefield: ['Test Grim King'] }, p2: { graveyard: ['Test Bear'] }, defs: DEFS });
    t = act(t, { type: 'cast', player: 'p1', card: find(t, 'Test Exile Spell', 'hand', 'p1') });
    t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Test Bear', 'graveyard', 'p2') }] });
    t = settle(t);
    expect(lifeOf(t, 'p2')).toBe(20);
  });
});
