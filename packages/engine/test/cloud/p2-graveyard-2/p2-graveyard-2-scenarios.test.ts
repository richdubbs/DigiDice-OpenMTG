/**
 * p2-graveyard-2 (Phase 2 lane p2-graveyard): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 614.17d, 101.2   "<Creature> cards in graveyards and libraries can't enter the battlefield": a reanimation leaves such a card where it is, a card of another
 *                       type still enters; a search that would put one onto the battlefield leaves it in the library; a creature spell cast from a hand still
 *                       enters (it comes from the stack)
 *   CR 601.3, 601.2a    "Players can't cast spells from graveyards or libraries": flashback from a graveyard and a cast from the top of a library are refused, a cast
 *                       from a hand is not; "Players can't cast noncreature spells from graveyards or exile": a noncreature spell from a graveyard is refused, a
 *                       creature spell from a graveyard is not
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m5/helpers';
import { KEYWORD_FAMILY_MEMBERS } from '../../../src/rules/filter';
import { keywordRegistry } from '../../../src/keywords/registry';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer pending decisions (costs, targets, yes to a may, the queued answers) until a player has priority with an empty stack. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; guard < 60 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0); guard++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (queue.length > 0 && queue[0]!.kind === d.kind) s = answer(s, queue.shift()!);
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((x) => s.defs[s.objects[x]!.defId]!.name).sort();
const castsOf = (s: GameState, id: ObjectId) => legalActions(s, 'p1').filter((a) => a.kind === 'cast' && a.object === id);

const CAGE = card('Test Grave Lock', 'Artifact', "Creature cards in graveyards and libraries can't enter the battlefield.\nPlayers can't cast spells from graveyards or libraries.", { cost: '{1}' });
const JAIL = card('Test Grave Warden', 'Artifact Creature — Phyrexian', "Artifact cards in graveyards can't enter the battlefield.\nPlayers can't cast noncreature spells from graveyards or exile.", { pt: ['2', '1'], cost: '{2}' });
const BEAR = card('Test Ground Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const IDOL = card('Test Stone Idol', 'Artifact', '');
const RAISE = card('Test Raise Word', 'Sorcery', 'Return target permanent card from your graveyard to the battlefield.');
const TUTOR = card('Test Calling Word', 'Sorcery', 'Search your library for a creature card, put it onto the battlefield, then shuffle.');
const ECHO = card('Test Echo Word', 'Instant', 'You gain 2 life.\nFlashback {0}');
const SIGHT = card('Test Far Sight', 'Enchantment', 'You may look at the top card of your library any time.\nYou may cast spells from the top of your library.');
const RISER = card('Test Grave Riser', 'Creature — Zombie', 'Flash\nYou may cast this card from your graveyard.', { pt: ['1', '1'] });

describe('CR 614.17d, 101.2: "<cards> in graveyards [and libraries] can\'t enter the battlefield"', () => {
  it('both cards are automated', () => { expect(full(CAGE)).toBe(true); expect(full(JAIL)).toBe(true); });
  it('a creature card in a graveyard stays there when an effect would return it; a noncreature card still enters', () => {
    let s = scenario([], { p1: { battlefield: ['Test Grave Lock'], graveyard: ['Test Ground Bear', 'Test Stone Idol'], hand: ['Test Raise Word', 'Test Raise Word'] }, defs: [CAGE, BEAR, IDOL, RAISE] });
    const bear = find(s, 'Test Ground Bear', 'graveyard', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand['p1']![0]! }), [], [bear]);
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Ground Bear');
    const idol = find(s, 'Test Stone Idol', 'graveyard', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand['p1']![0]! }), [], [idol]);
    expect(names(s, s.zones.battlefield)).toEqual(['Test Grave Lock', 'Test Stone Idol']);
  });
  it('a creature card a search would put onto the battlefield from a library stays in the library; a creature spell from a hand still enters', () => {
    let s = scenario([], { p1: { battlefield: ['Test Grave Lock'], library: ['Test Ground Bear'], hand: ['Test Calling Word', 'Test Ground Bear'] }, defs: [CAGE, BEAR, TUTOR] });
    const inLib = find(s, 'Test Ground Bear', 'library', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Calling Word', 'hand', 'p1') }), [{ kind: 'chooseObjects', ids: [inLib] } as unknown as DecisionAnswer]);
    expect(s.objects[inLib]?.zone ?? 'library').not.toBe('battlefield');
    expect(names(s, s.zones.battlefield)).toEqual(['Test Grave Lock']);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ground Bear', 'hand', 'p1') }));
    expect(names(s, s.zones.battlefield)).toEqual(['Test Grave Lock', 'Test Ground Bear']);
  });
  it('"Artifact cards in graveyards can\'t enter the battlefield" does not stop a creature card', () => {
    let s = scenario([], { p1: { battlefield: ['Test Grave Warden'], graveyard: ['Test Ground Bear'], hand: ['Test Raise Word'] }, defs: [JAIL, BEAR, RAISE] });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Raise Word', 'hand', 'p1') }), [], [find(s, 'Test Ground Bear', 'graveyard', 'p1')]);
    expect(names(s, s.zones.battlefield)).toEqual(['Test Grave Warden', 'Test Ground Bear']);
  });
});

describe('CR 601.3, 601.2a: "Players can\'t cast spells from graveyards or libraries" / "noncreature spells from graveyards or exile"', () => {
  it('flashback from a graveyard and a cast from the top of a library are refused; the same spell from a hand is not', () => {
    const base = { defs: [CAGE, ECHO, SIGHT] };
    const free = scenario([], { p1: { battlefield: ['Test Far Sight'], graveyard: ['Test Echo Word'], library: ['Test Echo Word'], hand: ['Test Echo Word'] }, ...base });
    const top = (s: GameState): ObjectId => find(s, 'Test Echo Word', 'library', 'p1');
    // without the restriction both are offered (the library card is its top card: the scenario puts the filler cards below it)
    expect(castsOf(free, find(free, 'Test Echo Word', 'graveyard', 'p1')).length).toBeGreaterThan(0);
    expect(castsOf(free, top(free)).length).toBeGreaterThan(0);
    const locked = scenario([], { p1: { battlefield: ['Test Far Sight', 'Test Grave Lock'], graveyard: ['Test Echo Word'], library: ['Test Echo Word'], hand: ['Test Echo Word'] }, ...base });
    expect(castsOf(locked, find(locked, 'Test Echo Word', 'graveyard', 'p1'))).toEqual([]);
    expect(castsOf(locked, top(locked))).toEqual([]);
    expect(castsOf(locked, find(locked, 'Test Echo Word', 'hand', 'p1')).length).toBeGreaterThan(0);
  });
  it('"noncreature spells from graveyards or exile": a noncreature spell from a graveyard is refused, a creature spell from a graveyard is not', () => {
    const s = scenario([], { p1: { battlefield: ['Test Grave Warden'], graveyard: ['Test Echo Word', 'Test Grave Riser'] }, defs: [JAIL, ECHO, RISER] });
    expect(castsOf(s, find(s, 'Test Echo Word', 'graveyard', 'p1'))).toEqual([]);
    expect(castsOf(s, find(s, 'Test Grave Riser', 'graveyard', 'p1')).length).toBeGreaterThan(0);
  });
});

describe('CR 601.3, 614.1a, 400.7: "Once during each of your turns, you may cast <spells> from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead"', () => {
  const MAGE = card('Test Ash Scholar', 'Creature — Human Wizard', 'Flying\nOnce during each of your turns, you may cast an instant or sorcery spell from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead.', { pt: ['3', '4'] });
  const LIFE = card('Test Mend Word', 'Instant', 'You gain 2 life.');
  const board = (): GameState => scenario([], { p1: { battlefield: ['Test Ash Scholar'], graveyard: ['Test Mend Word', 'Test Mend Word'], hand: ['Test Mend Word'] }, defs: [MAGE, LIFE] });
  it('is automated', () => expect(full(MAGE)).toBe(true));
  it('a spell cast this way is exiled as it resolves; the second card can\'t be cast from the graveyard the same turn; one cast from the hand still goes to the graveyard', () => {
    let s = board();
    const [a, b] = s.zones.graveyard['p1']!;
    s = settle(act(s, castsOf(s, a!)[0]!.action));
    expect(s.zones.exile.map((x) => s.defs[s.objects[x]!.defId]!.name)).toEqual(['Test Mend Word']);
    expect(castsOf(s, b!)).toEqual([]);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Mend Word', 'hand', 'p1') }));
    expect(s.zones.graveyard['p1']!.length).toBe(2);
    expect(s.zones.exile.length).toBe(1);
  });
});

describe('CR 702.1, 115.1, 404.1: "Return target <card> with <keyword> from your graveyard to your hand"', () => {
  const DIG = card('Test Dust Recall', 'Sorcery', 'Return up to two target cards with cycling from your graveyard to your hand.');
  const CYC = card('Test Cycler', 'Creature — Beast', 'Cycling {2}', { pt: ['3', '3'] });
  const PLAIN = card('Test Plain Beast', 'Creature — Beast', '', { pt: ['3', '3'] });
  it('is automated', () => expect(full(DIG)).toBe(true));
  it('CR 702.29f: a card with typecycling (swampcycling) has a cycling ability, so it is a card with cycling too', () => {
    const SWAMPY = card('Test Bog Strider', 'Creature — Beast', 'Swampcycling {2}', { pt: ['3', '3'] });
    let s = scenario([], { p1: { graveyard: ['Test Bog Strider'], hand: ['Test Dust Recall'] }, defs: [DIG, SWAMPY] });
    const bog = find(s, 'Test Bog Strider', 'graveyard', 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dust Recall', 'hand', 'p1') }), [], [bog]);
    expect(names(s, s.zones.hand['p1']!)).toEqual(['Test Bog Strider']);
  });
  it('only a card with that keyword can be the target; it returns to its owner\'s hand', () => {
    let s = scenario([], { p1: { graveyard: ['Test Cycler', 'Test Plain Beast'], hand: ['Test Dust Recall'] }, defs: [DIG, CYC, PLAIN] });
    const cyc = find(s, 'Test Cycler', 'graveyard', 'p1');
    const plain = find(s, 'Test Plain Beast', 'graveyard', 'p1');
    const started = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dust Recall', 'hand', 'p1') });
    const pending = started.pending as { kind: string; targets?: { candidates?: { id: string }[] }[]; specs?: { candidates?: string[] }[] };
    expect(JSON.stringify(pending)).toContain(cyc);
    expect(JSON.stringify(pending)).not.toContain(plain);
    s = settle(started, [], [cyc]);
    expect(names(s, s.zones.hand['p1']!)).toEqual(['Test Cycler']);
    expect(names(s, s.zones.graveyard['p1']!)).toEqual(['Test Dust Recall', 'Test Plain Beast']);
  });
});

describe('CR 702.29f, 702.33c: the keyword families a filter reads (rules/filter.ts#KEYWORD_FAMILY_MEMBERS)', () => {
  it('is exactly the `family` of the keyword data', () => {
    const fromData: Record<string, string[]> = {};
    for (const k of keywordRegistry.all()) if (k.family !== undefined) (fromData[k.family] ??= []).push(k.name);
    expect(Object.fromEntries(Object.entries(KEYWORD_FAMILY_MEMBERS).map(([k, v]) => [k, [...v].sort()]))).toEqual(Object.fromEntries(Object.entries(fromData).map(([k, v]) => [k, v.sort()])));
  });
});
