/**
 * edh-zones-8 (Commander effort, lane edh-zones), played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by the
 * game's default compiler. CR cites checked against MagicCompRules 20260925 where the file says so.
 *
 *   CR 701.23a, 608.2d, 101.4   a tempting offer by search: each opponent may search; you search once more for each who did; each player who searched shuffles
 *   CR 701.20e, 401.4, 110.2a   "Put all F cards from among them onto the battlefield (tapped) and the rest on the bottom of your library in a random order"; "untap those lands"
 *   CR 701.20a, 701.24a         "Put those cards onto the battlefield, then shuffle the rest of the revealed cards into your library"
 *   CR 701.24a, 402.1, 404.1    "Shuffle your graveyard and hand into your library"
 *   CR 701.20e, 608.2d          "Put any number of permanent cards from among them onto the battlefield and the rest into your hand"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, scenario } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { activate } from '../../m5/cr-examples/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.objects[id]!.defId);
const onBattlefield = (s: GameState, p: PlayerId, name: string): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === name).length;
const shuffles = (s: GameState): number => s.log.filter((l) => /shuffles their library/.test(l.text)).length;

/** Resolve the spell: `yes` says which players take the optional search; every search takes the first land offered. */
function settle(s0: GameState, yes: Partial<Record<PlayerId, boolean>>, pick?: (s: GameState, options: readonly string[]) => string[]): GameState {
  let s = s0;
  for (let guard = 0; guard < 300 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: yes[d.player] === true });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(s, d.options) : d.options.slice(0, d.max) } as DecisionAnswer);
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}

const OFFER = card('Test Tempt Lands', 'Sorcery', 'Tempting offer — Search your library for a Forest card and put it onto the battlefield. Each opponent may search their library for a Forest card and put it onto the battlefield. For each opponent who searches a library this way, search your library for a Forest card and put it onto the battlefield. Then each player who searched a library this way shuffles.');
const FOREST = card('Forest', 'Basic Land — Forest', '');

const board = (): GameState => mpScenario({
  players: 4, defs: [OFFER, FOREST],
  zones: { p1: { hand: ['Test Tempt Lands'], library: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest'] }, p2: { library: ['Forest', 'Forest'] }, p3: { library: ['Forest', 'Forest'] }, p4: { library: ['Forest'] } },
});

describe('CR 701.23a, 608.2d, 101.4: a tempting offer by search ("Tempt with Discovery")', () => {
  it('is parsed and automated', () => expect(automated(OFFER)).toBe(true));
  it('you search; each opponent who chooses to search puts a land onto the battlefield; you search once more for each of them; only the players who searched shuffle', () => {
    let s = board();
    const before = shuffles(s);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tempt Lands', 'hand', 'p1') });
    s = settle(s, { p2: true, p3: false, p4: true });
    expect(onBattlefield(s, 'p1', 'Forest')).toBe(3);
    expect(onBattlefield(s, 'p2', 'Forest')).toBe(1);
    expect(onBattlefield(s, 'p3', 'Forest')).toBe(0);
    expect(onBattlefield(s, 'p4', 'Forest')).toBe(1);
    expect(names(s, s.zones.library['p3']!).filter((n) => n === 'Forest').length).toBeGreaterThanOrEqual(2);
    expect(shuffles(s) - before).toBe(3); // p1, p2, p4: p3 searched nothing
    expect(s.log.filter((l) => /Player 3 shuffles their library|p3 shuffles their library/i.test(l.text)).length).toBe(0);
  });
  it('the negative case: if no opponent searches, you search once and only you shuffle', () => {
    let s = board();
    const before = shuffles(s);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tempt Lands', 'hand', 'p1') });
    s = settle(s, {});
    expect(onBattlefield(s, 'p1', 'Forest')).toBe(1);
    expect(onBattlefield(s, 'p2', 'Forest') + onBattlefield(s, 'p3', 'Forest') + onBattlefield(s, 'p4', 'Forest')).toBe(0);
    expect(shuffles(s) - before).toBe(1);
  });
  it('all three opponents search: you search four times in all (the library holds four lands after the draw for the turn) and everybody shuffles', () => {
    let s = board();
    const before = shuffles(s);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Tempt Lands', 'hand', 'p1') });
    s = settle(s, { p2: true, p3: true, p4: true });
    expect(onBattlefield(s, 'p1', 'Forest')).toBe(4);
    expect([2, 3, 4].map((n) => onBattlefield(s, `p${n}` as PlayerId, 'Forest'))).toEqual([1, 1, 1]);
    expect(shuffles(s) - before).toBe(4);
  });
});

const nameOf = (s: GameState, id: string): string => s.objects[id]!.defId;
const inZone = (s: GameState, p: PlayerId, zone: 'hand' | 'library' | 'graveyard', name: string): number => names(s, s.zones[zone][p]!).filter((n) => n === name).length;
const tappedOnBf = (s: GameState, p: PlayerId, name: string): boolean[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === name).map((id) => s.objects[id]!.tapped);

const SWAMP = card('Test Marsh', 'Basic Land — Swamp', '');
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}');
const GOB1 = card('Test Goblin Scout', 'Creature — Goblin', '', ['1', '1'], '{1}{R}');
const GOB5 = card('Test Goblin Chief', 'Creature — Goblin', '', ['5', '5'], '{3}{R}{R}');
const GOB6 = card('Test Goblin Titan', 'Creature — Goblin', '', ['6', '6'], '{4}{R}{R}');
const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.', undefined, '{R}');
const DIGGER = card('Test Dig Land', 'Sorcery', 'Reveal the top four cards of your library. Put all land cards from among them onto the battlefield tapped and the rest on the bottom of your library in a random order.\nSpell mastery — If there are two or more instant and/or sorcery cards in your graveyard, untap those lands.');

describe('CR 701.20e, 401.4, 110.2a: "Put all land cards from among them onto the battlefield tapped and the rest on the bottom of your library in a random order." + spell mastery "untap those lands" ("Animist\'s Awakening")', () => {
  const board = (graveyard: string[]): GameState => scenario([], { p1: { hand: ['Test Dig Land'], library: ['Test Marsh', 'Test Bear', 'Test Marsh', 'Test Spark', 'Plains', 'Plains'], graveyard }, defs: [DIGGER, SWAMP, BEAR, BOLT] });
  it('is parsed and automated', () => expect(automated(DIGGER)).toBe(true));
  it('every land among the top four goes onto the battlefield tapped; the others go to the bottom, below everything else', () => {
    let s = board([]);
    const size = s.zones.library['p1']!.length;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dig Land', 'hand', 'p1') });
    s = settle(s, {});
    expect(tappedOnBf(s, 'p1', 'Test Marsh')).toEqual([true, true]);
    expect(inZone(s, 'p1', 'library', 'Test Bear')).toBe(1);
    // the four cards revealed are Marsh, Bear, Marsh, Spark: the Bear and the Spark are the last two cards now, below the two Plains that were not revealed
    const lib = names(s, s.zones.library['p1']!);
    expect(lib.slice(-2).sort()).toEqual(['Test Bear', 'Test Spark']);
    expect(lib.slice(0, 2)).toEqual(['Plains', 'Plains']);
    expect(lib.length).toBe(size - 2);
  });
  it('spell mastery with two instant and/or sorcery cards in your graveyard: only the lands just put are untapped (the spell itself is not counted)', () => {
    let s = board(['Test Spark', 'Test Spark']);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dig Land', 'hand', 'p1') });
    s = settle(s, {});
    expect(tappedOnBf(s, 'p1', 'Test Marsh')).toEqual([false, false]);
  });
  it('the negative case: one instant or sorcery card (and a creature card) in the graveyard is not spell mastery: the lands stay tapped', () => {
    let s = board(['Test Spark', 'Test Bear']);
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dig Land', 'hand', 'p1') });
    s = settle(s, {});
    expect(tappedOnBf(s, 'p1', 'Test Marsh')).toEqual([true, true]);
  });
});

const KINDRED = card('Test Reveal Two', 'Sorcery', 'Reveal cards from the top of your library until you reveal two creature cards. Put those cards onto the battlefield, then shuffle the rest of the revealed cards into your library.');

describe('CR 701.20a, 701.24a: "Put those cards onto the battlefield, then shuffle the rest of the revealed cards into your library." ("Kindred Summons")', () => {
  it('is parsed and automated', () => expect(automated(KINDRED)).toBe(true));
  it('the two creature cards revealed are put onto the battlefield; the lands revealed on the way go back into the library, which is shuffled; cards below stay', () => {
    let s = scenario([], { p1: { hand: ['Test Reveal Two'], library: ['Test Marsh', 'Test Bear', 'Test Marsh', 'Test Bear', 'Test Spark'] }, defs: [KINDRED, SWAMP, BEAR, BOLT] });
    const before = shuffles(s);
    const size = s.zones.library['p1']!.length;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Reveal Two', 'hand', 'p1') });
    s = settle(s, {});
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Bear').length).toBe(2);
    expect(inZone(s, 'p1', 'library', 'Test Marsh')).toBe(2); // revealed, not put: back in the library
    expect(inZone(s, 'p1', 'library', 'Test Spark')).toBe(1); // below the revealed cards, never revealed
    expect(s.zones.library['p1']!.length).toBe(size - 2);
    expect(shuffles(s) - before).toBe(1);
  });
  it('the negative case: with one creature card in the library everything is revealed, the creature is put, everything else is shuffled back', () => {
    let s = scenario([], { p1: { hand: ['Test Reveal Two'], library: ['Test Marsh', 'Test Bear', 'Test Marsh'] }, defs: [KINDRED, SWAMP, BEAR] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Reveal Two', 'hand', 'p1') });
    s = settle(s, {});
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Bear').length).toBe(1);
    expect(inZone(s, 'p1', 'library', 'Test Marsh')).toBe(2 + 0);
  });
});

const MUXUS = card('Test Goblin Seer', 'Sorcery', 'Reveal the top six cards of your library. Put all Goblin creature cards with mana value 5 or less from among them onto the battlefield and the rest on the bottom of your library in a random order.');

describe('CR 701.20e, 202.3: "Put all Goblin creature cards with mana value 5 or less from among them onto the battlefield and the rest on the bottom ..." ("Muxus, Goblin Grandee")', () => {
  it('is parsed and automated', () => expect(automated(MUXUS)).toBe(true));
  it('only the Goblins with mana value 5 or less among the six revealed are put onto the battlefield; a Goblin with mana value 6 and the other cards go to the bottom; the seventh card is not touched', () => {
    let s = scenario([], { p1: { hand: ['Test Goblin Seer'], library: ['Test Goblin Scout', 'Test Goblin Titan', 'Test Bear', 'Test Goblin Chief', 'Test Marsh', 'Test Marsh', 'Test Goblin Scout'] }, defs: [MUXUS, GOB1, GOB5, GOB6, BEAR, SWAMP] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Goblin Seer', 'hand', 'p1') });
    s = settle(s, {});
    expect(s.zones.battlefield.map((id) => nameOf(s, id)).filter((n) => n.startsWith('Test Goblin')).sort()).toEqual(['Test Goblin Chief', 'Test Goblin Scout']);
    const lib = names(s, s.zones.library['p1']!);
    expect(lib[0]).toBe('Test Goblin Scout'); // the seventh card: not revealed
    expect(lib.slice(-4).sort()).toEqual(['Test Bear', 'Test Goblin Titan', 'Test Marsh', 'Test Marsh']);
  });
});

const CLOCK = card('Test Clock Land', 'Land', '{T}, Sacrifice this land: Shuffle your graveyard and hand into your library, then draw seven cards.');

describe('CR 701.24a, 402.1, 404.1: "Shuffle your graveyard and hand into your library, then draw seven cards." ("Trenzalore Clocktower")', () => {
  it('is parsed and automated', () => expect(automated(CLOCK)).toBe(true));
  it('your hand and graveyard go into your library, then you draw seven; the other player\'s zones are untouched', () => {
    let s = scenario([], { p1: { battlefield: ['Test Clock Land'], hand: ['Test Bear'], graveyard: ['Test Bear', 'Test Bear'] }, p2: { hand: ['Test Bear'], graveyard: ['Test Bear'] }, defs: [CLOCK, BEAR] });
    const p2 = [s.zones.hand['p2']!.length, s.zones.graveyard['p2']!.length];
    const src = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Clock Land')!;
    s = activate(s, src);
    s = settle(s, {});
    expect(s.zones.graveyard['p1']).toEqual([]);
    expect(s.zones.hand['p1']!.length).toBe(7);
    expect([s.zones.hand['p2']!.length, s.zones.graveyard['p2']!.length]).toEqual(p2);
    expect(inZone(s, 'p1', 'hand', 'Test Bear') + inZone(s, 'p1', 'library', 'Test Bear')).toBe(3); // the Bear in hand and the two in the graveyard: all in the library, then up to seven drawn
  });
});

const GENESIS = card('Test Genesis Spell', 'Sorcery', 'Look at the top five cards of your library. Put any number of permanent cards from among them onto the battlefield and the rest into your hand. Exile this spell.');

describe('CR 701.20e, 608.2d: "Put any number of permanent cards from among them onto the battlefield and the rest into your hand." ("Genesis Ultimatum")', () => {
  it('is parsed and automated', () => expect(automated(GENESIS)).toBe(true));
  it('the permanent cards you choose are put onto the battlefield; every other card of the five, the permanents you did not choose and the instant too, goes into your hand; the spell is exiled', () => {
    let s = scenario([], { p1: { hand: ['Test Genesis Spell'], library: ['Plains', 'Test Bear', 'Test Marsh', 'Test Spark', 'Test Bear', 'Test Marsh', 'Test Marsh'] }, defs: [GENESIS, BEAR, SWAMP, BOLT] });
    const handBefore = s.zones.hand['p1']!.length;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Genesis Spell', 'hand', 'p1') });
    // choose the first Bear and the first Marsh only
    let chosen = 0;
    s = settle(s, {}, (st, options) => { const want = ['Test Bear', 'Test Marsh']; const out: string[] = []; for (const w of want) { const id = options.find((o) => nameOf(st, o) === w && !out.includes(o)); if (id) out.push(id); } chosen = out.length; return out; });
    expect(chosen).toBe(2);
    expect(s.zones.battlefield.map((id) => nameOf(s, id)).filter((n) => n === 'Test Bear' || n === 'Test Marsh').sort()).toEqual(['Test Bear', 'Test Marsh']);
    expect(s.zones.hand['p1']!.length).toBe(handBefore - 1 + 3); // the spell left the hand; the Spark, the second Bear and the second Marsh came in (the Plains too: it is a card of the five, not chosen)
    expect(inZone(s, 'p1', 'hand', 'Test Spark')).toBe(1);
    expect(inZone(s, 'p1', 'library', 'Test Marsh')).toBeGreaterThanOrEqual(1); // the sixth and seventh cards were not looked at
    expect(Object.values(s.objects).find((o) => o.defId === 'Test Genesis Spell')!.zone).toBe('exile');
  });
});

const AURA = card('Test Wisp Aura', 'Enchantment — Aura', 'Enchant creature');

describe('CR 303.4g, Genesis Ultimatum ruling 2025-04-04: an Aura that can\'t be attached is put into your hand with the rest', () => {
  it('chosen with no creature to enchant, the Aura stays in the library under the old reading; now it goes to the hand with the cards not put onto the battlefield', () => {
    let s = scenario([], { p1: { hand: ['Test Genesis Spell'], library: ['Test Wisp Aura', 'Test Spark', 'Test Marsh', 'Test Spark', 'Test Spark', 'Test Marsh'] }, defs: [GENESIS, AURA, BOLT, SWAMP] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Genesis Spell', 'hand', 'p1') });
    s = settle(s, {}, (_st, options) => [...options]);
    expect(inZone(s, 'p1', 'hand', 'Test Wisp Aura')).toBe(1);
    expect(inZone(s, 'p1', 'library', 'Test Wisp Aura')).toBe(0);
  });
});
