/**
 * trek-7 (lane trek, Star Trek cards): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10), compiled by
 * the game's default compiler. Each test is named after the rule it checks, with its negative case. The Star Trek mechanics are newer than the Comprehensive Rules
 * edition of rules/cr (2026-09-25): their reminder text is the rule source; CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 113.6, 601.3,     "You may cast this card from exile." (Khan, Vengeful Heart): a static ability of the card that functions in exile; its owner casts it from there
 *   601.3e               with its normal cost and timing; nobody else, and no other card, may
 *   CR 506.3, 508.1      "the number of opponents you attacked this turn" (Worf, Defiant Commander): the different players whose creatures were attacked this turn
 *                        (a planeswalker attacked is not its player); read after the combat as well; the cards exiled may be played until the end of your next turn
 *   CR 700.2             "create a 1/1 ... token for each dilemma you've faced this turn" (Captain Benjamin Sisko): one for each choice of modes of yours this turn, not
 *                        of last turn or of an opponent; "cast any number of spells with mana value less than or equal to the number of Officers you control from among
 *                        those cards without paying their mana costs": a nonland card of that value or less, any number of them, each for free
 *   CR 108.3, 400.7,     "look at target opponent's hand. You may exile a nonland card from it. For as long as that card remains exiled, its owner may play it. A spell
 *   601.2f, 611.2b       cast this way costs {2} more to cast." (Zero, Incorporeal Sensate): the owner, not you, plays it, paying {2} more, until it leaves exile
 *   CR 406.1, 701 (the   "target opponent exiles cards from the top of their library until they exile a creature card. Assimilate that card. They put the rest on the bottom
 *   assimilate reminder) in a random order." (The Borg Queen): the creature card enters under your control with a +1/+1 counter as a Borg artifact creature; the other
 *                        exiled cards go to the bottom of their owner's library
 *   CR 118.9, 601.2b,    "During your main phase, each card in your graveyard has beam me up. The beam me up cost is equal to that spell's mana cost. ~ can't be beamed
 *   101.2, 614.17b       up to cast a spell this way." (Scotty, Miracle Worker): instants and sorceries only; during your main phase only; another creature of yours is
 *                        returned, never the grantor; a printed beam me up still lets the grantor be returned
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, legalActions, type Action, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass } from '../../m5/helpers';
import { activate, drive, handSize, resolveAll, resolveTop, countOn } from '../../m5/cr-examples/helpers';
import { castWith, synthetic } from '../../m6/costs/support';
import { mpScenario, passUntil, resolveStack, drive as mpDrive, namesOn } from '../../m12/rules/helpers';
import { scenario } from '../../m3/scenario';

const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const mode = (id: string): DecisionAnswer => ({ kind: 'chooseOption', ids: [id] });
const pick = (...ids: ObjectId[]): DecisionAnswer => ({ kind: 'chooseObjects', ids });
const target = (id: string): DecisionAnswer => ({ kind: 'chooseTargets', targets: [id === 'p1' || id === 'p2' ? { kind: 'player' as const, id } : { kind: 'object' as const, id }] });
const zoneOf = (s: GameState, name: string): string[] => Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === name).map((o) => o.zone);
const castActions = (s: GameState, player: PlayerId, name: string): Action[] =>
  legalActions(s, player).filter((a) => a.kind === 'cast' && a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name).map((a) => a.action);
const subtypes = (s: GameState, id: string): string[] => [...getChars(s, id)!.subtypes].sort();
const onField = (s: GameState, name: string, controller?: PlayerId): string => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === name && (controller === undefined || s.objects[id]!.controller === controller))!;
/** Pay for a pending cost automatically, then answer the rest with `answers`. */
const pay = (s: GameState, answers: DecisionAnswer[] = []): GameState => drive(s, answers);
/** A synthetic card of two faces (a modal double-faced card, a split card or an Adventurer) compiled by the default compiler (design 6.10: invented names and wordings). */
const face = (name: string, manaCost: string, typeLine: string, text: string, extra: Record<string, string> = {}) => ({ name, mana_cost: manaCost, type_line: typeLine, oracle_text: text, ...extra });
const twoFaced = (layout: 'modal_dfc' | 'split' | 'adventure', a: ReturnType<typeof face>, b: ReturnType<typeof face>): CardDef =>
  compileCard({
    name: `${a.name} // ${b.name}`, layout, mana_cost: layout === 'modal_dfc' ? a.mana_cost : layout === 'adventure' ? a.mana_cost : `${a.mana_cost} // ${b.mana_cost}`,
    type_line: `${a.type_line} // ${b.type_line}`, oracle_text: '', colors: [], keywords: [], card_faces: [a, b],
  } as unknown as OracleCard);
const stackFaces = (s: GameState): { name: string; face: number }[] => s.zones.stack.map((id) => ({ name: s.defs[s.objects[id]!.defId]!.name, face: s.objects[id]!.face ?? 0 }));

describe('CR 113.6, 601.3, 601.3e: "You may cast this card from exile." (a static ability of the card itself, functioning in exile)', () => {
  const WARLORD = synthetic('Test Exiled Warlord', 'Creature — Human Warrior', '{1}{B}', 'When this creature enters, you gain 1 life.\nYou may cast this card from exile.', { power: '5', toughness: '3' });
  const PLAIN = synthetic('Test Plain Brute', 'Creature — Human Warrior', '{1}{B}', '', { power: '2', toughness: '2' });
  const DEFS = [WARLORD, PLAIN];

  it('the card is automated and the permission is a capability (the exile permission of the card itself)', () => {
    expect(full(WARLORD), JSON.stringify(WARLORD.automation)).toBe(true);
    expect(ENGINE_CAPABILITIES.has('permit:cast.exile')).toBe(true);
  });
  it('its owner may cast it from exile, paying its mana cost: it resolves onto the battlefield', () => {
    let s = scenario(['Swamp'], { defs: DEFS, p1: { exile: ['Test Exiled Warlord'], battlefield: ['Swamp', 'Swamp'] } });
    const cast = castActions(s, 'p1', 'Test Exiled Warlord');
    expect(cast.length).toBe(1);
    s = pay(act(s, cast[0]!));
    expect(s.zones.stack.length).toBe(1);
    expect(zoneOf(s, 'Test Exiled Warlord')).toEqual(['stack']);
    s = resolveAll(s);
    expect(zoneOf(s, 'Test Exiled Warlord')).toEqual(['battlefield']);
    expect(lifeOf(s, 'p1')).toBe(21); // its enters trigger ran: it was cast as a creature spell
  });
  it('negative: it is not castable without the mana, nor by the other player, and a card without the ability is not castable from exile', () => {
    let s = scenario(['Swamp'], { defs: DEFS, p1: { exile: ['Test Exiled Warlord', 'Test Plain Brute'], battlefield: ['Swamp'] }, p2: { battlefield: ['Swamp', 'Swamp'] } });
    expect(castActions(s, 'p1', 'Test Exiled Warlord')).toEqual([]); // one Swamp is not {1}{B}
    s = scenario(['Swamp'], { defs: DEFS, p1: { exile: ['Test Exiled Warlord', 'Test Plain Brute'], battlefield: ['Swamp', 'Swamp'] }, p2: { battlefield: ['Swamp', 'Swamp'] } });
    expect(castActions(s, 'p1', 'Test Plain Brute')).toEqual([]);
    expect(castActions(s, 'p2', 'Test Exiled Warlord')).toEqual([]);
    s = advanceTo(s, 2, 'main1');
    expect(castActions(s, 'p2', 'Test Exiled Warlord')).toEqual([]); // not their card, not their turn: the permission is its owner's
  });
  it('negative: the permission is for exile only: the same card in a graveyard is not castable from there', () => {
    const s = scenario(['Swamp'], { defs: DEFS, p1: { graveyard: ['Test Exiled Warlord'], battlefield: ['Swamp', 'Swamp'] } });
    expect(castActions(s, 'p1', 'Test Exiled Warlord')).toEqual([]);
  });
  it('timing is the card\'s own: a creature card in exile is cast at sorcery speed (not in the opponent\'s turn)', () => {
    let s = scenario(['Swamp'], { defs: DEFS, p1: { exile: ['Test Exiled Warlord'], battlefield: ['Swamp', 'Swamp'] } });
    s = advanceTo(s, 2, 'main1');
    expect(castActions(s, 'p1', 'Test Exiled Warlord')).toEqual([]);
  });
});

describe('CR 506.3, 508.1: "the number of opponents you attacked this turn" (Worf, Defiant Commander)', () => {
  const COMMANDER = synthetic('Test Defiant Commander', 'Legendary Creature — Klingon Warrior', '{0}', 'Whenever you attack, exile the top X cards of your library, where X is the number of opponents you attacked this turn. Until the end of your next turn, you may play those cards.', { power: '3', toughness: '4' });
  const SCOUT = synthetic('Test Scout', 'Creature — Human Scout', '{0}', '', { power: '1', toughness: '1' });
  const LOOKOUT = synthetic('Test Lookout', 'Creature — Human Scout', '{0}', 'At the beginning of your end step, exile the top X cards of your library, where X is the number of opponents you attacked this turn.', { power: '1', toughness: '1' });
  const card = (n: string, cost: string, type = 'Instant'): CardDef => synthetic(n, type, cost, type === 'Instant' ? 'You gain 1 life.' : '');
  const A = card('Test Spell A', '{1}');
  const B = card('Test Spell B', '{1}');
  const C = card('Test Spell C', '{1}');
  const D = card('Test Spell D', '{1}');
  const DEFS = [COMMANDER, SCOUT, LOOKOUT, A, B, C, D];
  const attack = (s: GameState, attacks: { attacker: ObjectId; defender: string }[]): GameState => resolveStack(mpDrive(answer(s, { kind: 'declareAttackers', attacks })));
  const toAttackers = (s: GameState): GameState => passUntil(s, (t) => t.pending?.kind === 'declareAttackers' && t.pending.player === 'p1', 'the attack of p1');
  const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.defs[s.objects[id]!.defId]!.name);

  it('the card is automated; the quantity is a capability', () => {
    expect(full(COMMANDER), JSON.stringify(COMMANDER.automation)).toBe(true);
    expect(full(LOOKOUT), JSON.stringify(LOOKOUT.automation)).toBe(true);
    expect(ENGINE_CAPABILITIES.has('q:opponentsAttacked')).toBe(true);
  });
  it('two opponents attacked (and a planeswalker of a third, which is not its player): X is 2; the two top cards are exiled and playable', () => {
    let s = mpScenario({
      cards: ['Jace Beleren'], defs: DEFS,
      zones: { p1: { battlefield: ['Test Defiant Commander', 'Test Scout', 'Test Scout', 'Plains', 'Plains'], library: ['Test Spell A', 'Test Spell B', 'Test Spell C', 'Test Spell D'] }, p4: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } },
    });
    // (a four-player game: the first player draws, so Test Spell A is in the hand and B, C, D are the top three cards)
    const [commander] = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Defiant Commander');
    const scouts = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Scout');
    const jace = find(s, 'Jace Beleren', 'battlefield', 'p4');
    s = attack(toAttackers(s), [{ attacker: commander!, defender: 'p2' }, { attacker: scouts[0]!, defender: 'p3' }, { attacker: scouts[1]!, defender: jace }]);
    expect(exiled(s)).toEqual(['Test Spell B', 'Test Spell C']);
    // until the end of your next turn you may play them (cast from exile)
    s = advanceTo(s, 1, 'main2');
    expect(castActions(s, 'p1', 'Test Spell B').length).toBe(1);
    expect(castActions(s, 'p1', 'Test Spell C').length).toBe(1);
    expect(castActions(s, 'p2', 'Test Spell B')).toEqual([]);
  });
  it('negative: two attackers on ONE opponent is one opponent: X is 1', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Defiant Commander', 'Test Scout'], library: ['Test Spell A', 'Test Spell B', 'Test Spell C'] } } });
    const commander = find(s, 'Test Defiant Commander', 'battlefield', 'p1');
    const scout = find(s, 'Test Scout', 'battlefield', 'p1');
    s = attack(toAttackers(s), [{ attacker: commander, defender: 'p2' }, { attacker: scout, defender: 'p2' }]);
    expect(exiled(s)).toEqual(['Test Spell B']);
  });
  it('negative: attacking only a planeswalker attacks no opponent: X is 0, nothing is exiled', () => {
    let s = mpScenario({ cards: ['Jace Beleren'], defs: DEFS, zones: { p1: { battlefield: ['Test Defiant Commander'], library: ['Test Spell A', 'Test Spell B'] }, p3: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }] } } });
    const commander = find(s, 'Test Defiant Commander', 'battlefield', 'p1');
    s = attack(toAttackers(s), [{ attacker: commander, defender: find(s, 'Jace Beleren', 'battlefield', 'p3') }]);
    expect(exiled(s)).toEqual([]);
  });
  it('"this turn": read at the end step, after the combat is over (the melee count of one combat would be 0 there)', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Lookout', 'Test Scout'], library: ['Test Spell A', 'Test Spell B', 'Test Spell C'] } } });
    const scout = find(s, 'Test Scout', 'battlefield', 'p1');
    s = attack(toAttackers(s), [{ attacker: scout, defender: 'p3' }]);
    s = passUntil(s, (t) => t.turn.step === 'end' && t.turn.number === 1, 'the end step');
    s = resolveStack(s);
    expect(exiled(s)).toEqual(['Test Spell B']);
  });
  it('negative: it counts this turn only: an attack of an earlier turn adds nothing', () => {
    let s = mpScenario({ defs: DEFS, zones: { p1: { battlefield: ['Test Lookout', 'Test Scout'], library: ['Test Spell A', 'Test Spell B', 'Test Spell C', 'Test Spell D'] } } });
    const scout = find(s, 'Test Scout', 'battlefield', 'p1');
    s = attack(toAttackers(s), [{ attacker: scout, defender: 'p3' }]);
    s = passUntil(s, (t) => t.turn.number === 5 && t.turn.step === 'end', 'the end step of the next turn of p1');
    s = resolveStack(s);
    expect(exiled(s)).toHaveLength(1); // (the first turn's end trigger exiled one card; the fifth turn, which attacked nobody, exiled none more: its count of 0 does not read turn 1)
    expect(exiled(s)).toEqual(['Test Spell B']);
  });
});

describe('CR 700.2: "create a 1/1 red Officer creature token for each dilemma you\'ve faced this turn" and the free casts of Captain Benjamin Sisko', () => {
  const CAPTAIN = synthetic('Test Station Captain', 'Legendary Creature — Human Officer', '{0}', "At the beginning of your end step, create a 1/1 red Officer creature token for each dilemma you've faced this turn.\n{T}: Exile the top three cards of your library. You may cast any number of spells with mana value less than or equal to the number of Officers you control from among those cards without paying their mana costs.", { power: '2', toughness: '2' });
  const CHARM = synthetic('Test Twin Charm', 'Instant', '{0}', 'Choose one —\n• You gain 2 life.\n• You gain 3 life.');
  const SALVE = synthetic('Test Plain Salve', 'Instant', '{0}', 'You gain 1 life.');
  const TOKENS = synthetic('Test Little Bolt', 'Instant', '{1}', 'You gain 5 life.');
  const BIG = synthetic('Test Great Bolt', 'Instant', '{3}', 'You gain 7 life.');
  const OFFICER = synthetic('Test Junior Officer', 'Creature — Human Officer', '{0}', '', { power: '1', toughness: '1' });
  const DEFS = [CAPTAIN, CHARM, SALVE, TOKENS, BIG, OFFICER];
  const officers = (s: GameState, p: PlayerId = 'p1'): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && getChars(s, id)!.subtypes.includes('Officer')).length;
  const tokens = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;

  it('both abilities are automated', () => expect(full(CAPTAIN), JSON.stringify(CAPTAIN.automation)).toBe(true));
  it('CR 700.2: two modal spells cast this turn are two dilemmas: two Officer tokens at the end step', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Station Captain'], hand: ['Test Twin Charm', 'Test Twin Charm'] } });
    s = resolveAll(castWith(s, 'Test Twin Charm', [mode('0')]));
    s = resolveAll(castWith(s, 'Test Twin Charm', [mode('1')]));
    s = passUntil(s, (t) => t.turn.step === 'end', 'the end step');
    s = resolveStack(s);
    expect(tokens(s)).toBe(2);
  });
  it('negative: a spell without modes and no spell at all are no dilemmas: no token', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Station Captain'], hand: ['Test Plain Salve'] } });
    s = resolveAll(castWith(s, 'Test Plain Salve'));
    s = passUntil(s, (t) => t.turn.step === 'end', 'the end step');
    s = resolveStack(s);
    expect(tokens(s)).toBe(0);
  });
  it('negative: "this turn": a dilemma of an earlier turn counts nothing; an opponent\'s dilemma neither', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Station Captain'], hand: ['Test Twin Charm'] }, p2: { hand: ['Test Twin Charm'] } });
    s = resolveAll(castWith(s, 'Test Twin Charm', [mode('0')]));
    s = passUntil(s, (t) => t.turn.number === 2 && t.turn.step === 'main1', 'the next turn');
    s = resolveStack(s);
    expect(tokens(s)).toBe(1); // the end step of the first turn
    s = resolveAll(castWith(s, 'Test Twin Charm', [mode('0')], undefined, 'p2'));
    s = passUntil(s, (t) => t.turn.number === 3 && t.turn.step === 'end', 'the end step of the third turn');
    s = resolveStack(s);
    expect(tokens(s)).toBe(1); // no dilemma of p1 on turn 3, none of p2 counts
  });
  it('negative: an opponent\'s dilemma on YOUR turn, before your end step, is not yours: only your own dilemma counts (the actor of the action is read)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Station Captain'], hand: ['Test Twin Charm'] }, p2: { hand: ['Test Twin Charm'] } });
    s = pass(s); // p1 passes priority in the first main phase: p2 may cast an instant in p1's turn
    expect(s.pending?.kind).toBe('priority');
    expect(s.pending && 'player' in s.pending ? s.pending.player : null).toBe('p2');
    s = resolveAll(castWith(s, 'Test Twin Charm', [mode('0')], undefined, 'p2'));
    expect(s.turn.number).toBe(1);
    s = passUntil(s, (t) => t.turn.step === 'end', 'the end step');
    s = resolveStack(s);
    expect(tokens(s)).toBe(0); // p2 faced a dilemma this turn, p1 none
    // and the same turn with a dilemma of p1 added counts one, not two
    let t = scenario([], { defs: DEFS, p1: { battlefield: ['Test Station Captain'], hand: ['Test Twin Charm'] }, p2: { hand: ['Test Twin Charm'] } });
    t = pass(t);
    t = resolveAll(castWith(t, 'Test Twin Charm', [mode('0')], undefined, 'p2'));
    t = resolveAll(castWith(t, 'Test Twin Charm', [mode('1')]));
    t = passUntil(t, (u) => u.turn.step === 'end', 'the end step');
    t = resolveStack(t);
    expect(tokens(t)).toBe(1);
  });
  it('mana value less than or equal to the number of Officers you control: with 1 Officer only the {1} spell may be cast, free; the lands and the {3} spell stay', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Station Captain'], library: ['Test Little Bolt', 'Test Great Bolt', 'Test Plain Salve', 'Plains'] } });
    const captain = onField(s, 'Test Station Captain');
    expect(officers(s)).toBe(1); // the Captain itself is an Officer
    s = resolveTop(activate(s, captain, []));
    // the choice among the exiled nonland cards of mana value 1 or less (Little Bolt {1}, Plain Salve {0}); Great Bolt {3} and the land are not offered
    expect(s.pending?.kind).toBe('chooseObjects');
    const options = (s.pending as { options: ObjectId[] }).options.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
    expect(options).toEqual(['Test Little Bolt', 'Test Plain Salve']);
    const bolt = (s.pending as { options: ObjectId[] }).options.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Little Bolt')!;
    const salve = (s.pending as { options: ObjectId[] }).options.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Plain Salve')!;
    s = drive(answer(s, pick(bolt, salve)));
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(20 + 5 + 1); // both cast for free: 5 + 1 life
    expect(zoneOf(s, 'Test Great Bolt')).toEqual(['exile']);
  });
  it('the limit counts the Officers you control as you choose: three Officers make the {3} spell castable', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Station Captain', 'Test Junior Officer', 'Test Junior Officer'], library: ['Test Great Bolt', 'Plains', 'Plains'] } });
    expect(officers(s)).toBe(3);
    s = resolveTop(activate(s, onField(s, 'Test Station Captain'), []));
    expect(s.pending?.kind).toBe('chooseObjects');
    const options = (s.pending as { options: ObjectId[] }).options.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(options).toEqual(['Test Great Bolt']);
  });
});

describe('CR 202.3, 702.85a, 712.12, 715.3: the limit of "mana value less than or equal to the number of Officers you control" is the mana value of the face or half cast (Captain Benjamin Sisko)', () => {
  const CAPTAIN = synthetic('Test Station Captain', 'Legendary Creature — Human Officer', '{0}', "{T}: Exile the top three cards of your library. You may cast any number of spells with mana value less than or equal to the number of Officers you control from among those cards without paying their mana costs.", { power: '2', toughness: '2' });
  const OFFICER = synthetic('Test Junior Officer', 'Creature — Human Officer', '{0}', '', { power: '1', toughness: '1' });
  const SMALL_FRONT = twoFaced('modal_dfc', face('Test Small Aspect', '{1}', 'Instant', 'You gain 1 life.'), face('Test Grand Aspect', '{6}', 'Instant', 'You gain 9 life.'));
  const DEAR_FRONT = twoFaced('modal_dfc', face('Test Dear Front', '{6}', 'Instant', 'You gain 9 life.'), face('Test Cheap Back', '{1}', 'Instant', 'You gain 1 life.'));
  const SPLIT = twoFaced('split', face('Test Brief Flame', '{1}{R}', 'Instant', 'You gain 2 life.'), face('Test Long Frost', '{4}{U}', 'Instant', 'You gain 7 life.'));
  const GIANT = twoFaced('adventure', face('Test Little Giant', '{W}', 'Creature — Giant', '', { power: '2', toughness: '2' }), face('Test Big Chop', '{2}{W}', 'Instant — Adventure', 'You gain 4 life.'));
  const DEFS = [CAPTAIN, OFFICER, SMALL_FRONT, DEAR_FRONT, SPLIT, GIANT];
  const board = (top: string, officers: number): GameState => scenario(['Plains'], { defs: DEFS, p1: { battlefield: ['Test Station Captain', ...Array(officers - 1).fill('Test Junior Officer')] as string[], library: [top, 'Plains', 'Plains', 'Plains'] } });
  /** Activate the Captain, pick every card offered, and let the casts resolve: what is on the stack after the first cast, and what was offered. */
  function exileAndCast(s0: GameState): { offered: string[]; stack: { name: string; face: number }[]; life: number } {
    let s = resolveTop(activate(s0, onField(s0, 'Test Station Captain'), []));
    if (s.pending?.kind !== 'chooseObjects') return { offered: [], stack: stackFaces(s), life: lifeOf(s, 'p1') };
    const options = (s.pending as { options: ObjectId[] }).options;
    const offered = options.map((id) => s.defs[s.objects[id]!.defId]!.name);
    s = drive(answer(s, pick(...options)));
    const stack = stackFaces(s);
    s = resolveAll(s);
    return { offered, stack, life: lifeOf(s, 'p1') };
  }

  it('the cards are automated', () => { for (const d of [CAPTAIN, SMALL_FRONT, DEAR_FRONT, SPLIT, GIANT]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true); });
  it('a modal double-faced card with a cheap front and a dear back: only the front is cast (1 Officer); the back, which would be cast for free otherwise, is not', () => {
    const r = exileAndCast(board('Test Small Aspect // Test Grand Aspect', 1));
    expect(r.offered).toEqual(['Test Small Aspect // Test Grand Aspect']);
    expect(r.stack).toEqual([{ name: 'Test Small Aspect // Test Grand Aspect', face: 0 }]);
    expect(r.life).toBe(21); // the front's 1 life, not the back's 9
  });
  it('and with a dear front and a cheap back the card is offered, for its back (a card is offered when ANY of its faces is within the limit)', () => {
    const r = exileAndCast(board('Test Dear Front // Test Cheap Back', 1));
    expect(r.offered).toEqual(['Test Dear Front // Test Cheap Back']);
    expect(r.stack).toEqual([{ name: 'Test Dear Front // Test Cheap Back', face: 1 }]);
    expect(r.life).toBe(21);
  });
  it('a card with no face of the limit or less is not offered at all (the dear front and back with 1 Officer, a split card of 2 and 7 with one)', () => {
    const none = twoFaced('modal_dfc', face('Test Pricey Front', '{4}', 'Instant', 'You gain 1 life.'), face('Test Pricey Back', '{5}', 'Instant', 'You gain 2 life.'));
    const s = scenario(['Plains'], { defs: [CAPTAIN, none], p1: { battlefield: ['Test Station Captain'], library: ['Test Pricey Front // Test Pricey Back', 'Plains', 'Plains'] } });
    expect(exileAndCast(s).offered).toEqual([]);
  });
  it('a split card with one cheap half (2) and one dear half (7, 9 together): offered with 2 Officers, and only the cheap half is cast; with 1 Officer neither is', () => {
    const r = exileAndCast(board('Test Brief Flame // Test Long Frost', 2));
    expect(r.offered).toEqual(['Test Brief Flame // Test Long Frost']);
    expect(r.stack).toEqual([{ name: 'Test Brief Flame // Test Long Frost', face: 0 }]);
    expect(r.life).toBe(22);
    expect(exileAndCast(board('Test Brief Flame // Test Long Frost', 1)).offered).toEqual([]);
  });
  it('an Adventurer (creature 1, Adventure 3) with 1 Officer is cast as the creature, never as its Adventure; the Adventure is not cast for free at 1', () => {
    const r = exileAndCast(board('Test Little Giant // Test Big Chop', 1));
    expect(r.offered).toEqual(['Test Little Giant // Test Big Chop']);
    expect(r.stack).toEqual([{ name: 'Test Little Giant // Test Big Chop', face: 0 }]);
    expect(r.life).toBe(20); // no 4 life of the Adventure
  });
});

describe('CR 108.3, 400.7, 601.2f, 611.2b: Zero, Incorporeal Sensate: look at the hand, exile a nonland card; its owner may play it for as long as it remains exiled, paying {2} more', () => {
  const SENSATE = synthetic('Test Medusan Sensate', 'Legendary Artifact Creature — Medusan Scientist', '{0}', 'When this creature enters, look at target opponent\'s hand. You may exile a nonland card from it. For as long as that card remains exiled, its owner may play it. A spell cast this way costs {2} more to cast.', { power: '2', toughness: '2' });
  const BOLT = synthetic('Test Plain Bolt', 'Instant', '{R}', 'You gain 3 life.');
  const FIELDWORK = synthetic('Test Odd Job', 'Sorcery', '{1}', 'You gain 2 life.');
  const ROVER = synthetic('Test Exile Rover', 'Creature — Eldrazi Horror', '{3}', 'You may cast this card from exile.', { power: '3', toughness: '3' });
  const DEFS = [SENSATE, BOLT, FIELDWORK, ROVER];
  const SETUP = (opp: Parameters<typeof scenario>[1] extends infer O ? O : never) => opp;

  /** p1 casts the Sensate (a {0} creature), targets p2, and exiles `name` from p2's hand (answers: the target, then the pick). */
  function exileFromHand(opponent: { hand: string[]; battlefield?: string[] }, name: string | null): GameState {
    let s = scenario(['Mountain', 'Plains'], { defs: DEFS, p1: { hand: ['Test Medusan Sensate'] }, p2: { hand: opponent.hand, battlefield: opponent.battlefield ?? [] } });
    s = castWith(s, 'Test Medusan Sensate');
    s = resolveTop(s); // the creature spell
    s = drive(s, [target('p2')]);
    s = resolveTop(s);
    if (s.pending?.kind === 'chooseObjects') {
      const options = (s.pending as { options: ObjectId[] }).options;
      const chosen = name === null ? [] : [options.find((id) => s.defs[s.objects[id]!.defId]!.name === name)!];
      s = drive(answer(s, pick(...chosen)));
    }
    return s;
  }

  it('the card is automated', () => expect(full(SENSATE), JSON.stringify(SENSATE.automation)).toBe(true));
  it('only nonland cards of the hand may be exiled: a land is not offered', () => {
    let s = scenario(['Mountain', 'Plains'], { defs: DEFS, p1: { hand: ['Test Medusan Sensate'] }, p2: { hand: ['Mountain', 'Test Plain Bolt'] } });
    s = castWith(s, 'Test Medusan Sensate');
    s = resolveTop(s);
    s = drive(s, [target('p2')]);
    s = resolveTop(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const names = (s.pending as { options: ObjectId[] }).options.map((id) => s.defs[s.objects[id]!.defId]!.name);
    expect(names).toEqual(['Test Plain Bolt']);
  });
  it('CR 108.3: the owner (not you) may cast the exiled card, paying its cost and {2} more; with the mana for its own cost only it is not castable', () => {
    let s = exileFromHand({ hand: ['Test Plain Bolt'], battlefield: ['Mountain', 'Mountain'] }, 'Test Plain Bolt');
    expect(zoneOf(s, 'Test Plain Bolt')).toEqual(['exile']);
    expect(castActions(s, 'p1', 'Test Plain Bolt')).toEqual([]); // the controller of the Sensate has no permission
    s = advanceTo(s, 2, 'main1');
    expect(castActions(s, 'p2', 'Test Plain Bolt')).toEqual([]); // {R} + {2} is three mana: two Mountains are not enough
    let t = exileFromHand({ hand: ['Test Plain Bolt'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, 'Test Plain Bolt');
    t = advanceTo(t, 2, 'main1');
    const cast = castActions(t, 'p2', 'Test Plain Bolt');
    expect(cast.length).toBe(1);
    const before = lifeOf(t, 'p2');
    t = resolveAll(pay(act(t, cast[0]!)));
    expect(lifeOf(t, 'p2')).toBe(before + 3);
    expect(zoneOf(t, 'Test Plain Bolt')).toEqual(['graveyard']);
    expect(t.players.find((p) => p.id === 'p2')!.manaPool.length).toBe(0);
  });
  it('CR 400.7: the permission ends when the card leaves exile (cast): a copy of the same name elsewhere is not covered', () => {
    let s = exileFromHand({ hand: ['Test Plain Bolt', 'Test Plain Bolt'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain'] }, 'Test Plain Bolt');
    s = advanceTo(s, 2, 'main1');
    const hand = s.zones.hand.p2!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Plain Bolt');
    expect(hand).toHaveLength(1);
    // the other Bolt is cast from the hand for {R} only (no {2} more): the increase belongs to the permission of the exiled one
    const fromHand = castActions(s, 'p2', 'Test Plain Bolt').find((a) => (a as { card?: string }).card === hand[0]);
    expect(fromHand).toBeDefined();
    let t = pay(act(s, fromHand!));
    expect(t.players.find((p) => p.id === 'p2')!.manaPool.length).toBe(0);
    expect(6 - t.zones.battlefield.filter((id) => t.objects[id]!.controller === 'p2' && t.objects[id]!.tapped).length).toBe(5); // one Mountain tapped: no increase
  });
  it('CR 601.3: a card with its own "You may cast this card from exile" exiled this way is cast with it at its own cost: the {2} more is for a spell cast through the Sensate\'s permission', () => {
    // the Rover costs {3}: its owner has exactly three lands (the control: a card without that ability exiled the same way needs {R}+{2} = three, a card of cost {3} needs five)
    let s = exileFromHand({ hand: ['Test Exile Rover'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, 'Test Exile Rover');
    expect(zoneOf(s, 'Test Exile Rover')).toEqual(['exile']);
    s = advanceTo(s, 2, 'main1');
    const cast = castActions(s, 'p2', 'Test Exile Rover');
    expect(cast.length).toBe(1);
    s = pay(act(s, cast[0]!));
    expect(zoneOf(s, 'Test Exile Rover')).toEqual(['stack']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2' && s.objects[id]!.tapped).length).toBe(3); // {3}, not {5}
    // with two lands it is not castable either way
    let t = exileFromHand({ hand: ['Test Exile Rover'], battlefield: ['Mountain', 'Mountain'] }, 'Test Exile Rover');
    t = advanceTo(t, 2, 'main1');
    expect(castActions(t, 'p2', 'Test Exile Rover')).toEqual([]);
    // the same card exiled with no Sensate is castable by the same permission for the same cost (the control)
    let u = scenario(['Mountain'], { defs: DEFS, p2: { exile: ['Test Exile Rover'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } });
    u = advanceTo(u, 2, 'main1');
    expect(castActions(u, 'p2', 'Test Exile Rover').length).toBe(1);
  });
  it('the card exiled is chosen by you; you may choose none: nothing is exiled and nobody gets a permission', () => {
    const s = exileFromHand({ hand: ['Test Plain Bolt'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, null);
    expect(zoneOf(s, 'Test Plain Bolt')).toEqual(['hand']);
  });
  it('the permission is a play permission: timing is the card\'s own (a sorcery in exile is cast in its owner\'s main phase only)', () => {
    let s = exileFromHand({ hand: ['Test Odd Job'], battlefield: ['Mountain', 'Mountain', 'Mountain'] }, 'Test Odd Job');
    expect(castActions(s, 'p2', 'Test Odd Job')).toEqual([]); // p1's turn: a sorcery cannot be cast
    s = advanceTo(s, 2, 'main1');
    expect(castActions(s, 'p2', 'Test Odd Job').length).toBe(1);
  });
});

describe('CR 406.1, 608.2c; assimilate (Star Trek reminder text): The Borg Queen exiles from the top of an opponent\'s library until a creature card, assimilates it, and the rest go to the bottom', () => {
  const QUEEN = synthetic('Test Hive Sovereign', 'Legendary Artifact Creature — Borg Noble', '{0}', 'Artifact creatures you control get +2/+2.\nWhenever this creature enters or attacks, target opponent exiles cards from the top of their library until they exile a creature card. Assimilate that card. They put the rest on the bottom in a random order. (To assimilate a card, put it onto the battlefield under your control with a +1/+1 counter. It\'s a Borg artifact creature and loses all other creature types.)', { power: '4', toughness: '4' });
  const DRONE = synthetic('Test Assimilated Elf', 'Creature — Elf Druid', '{G}', '', { power: '1', toughness: '1' });
  const RITUAL = synthetic('Test Odd Ritual', 'Sorcery', '{1}', 'You gain 1 life.');
  const DEFS = [QUEEN, DRONE, RITUAL];

  function enter(library: string[]): GameState {
    let s = scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Hive Sovereign'] }, p2: { library } });
    s = castWith(s, 'Test Hive Sovereign');
    s = resolveTop(s);
    s = drive(s, [target('p2')]);
    return resolveAll(s);
  }
  const libraryNames = (s: GameState, p: PlayerId): string[] => s.zones.library[p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);

  it('the card is automated', () => expect(full(QUEEN), JSON.stringify(QUEEN.automation)).toBe(true));
  it('the first creature card is assimilated: under your control, +1/+1 counter, a Borg artifact creature with Borg its only creature type; the rest are on the bottom', () => {
    const s = enter(['Forest', 'Test Odd Ritual', 'Test Assimilated Elf', 'Test Odd Ritual']);
    const elf = onField(s, 'Test Assimilated Elf');
    expect(s.objects[elf]!.controller).toBe('p1');
    expect(s.objects[elf]!.owner).toBe('p2');
    expect(s.objects[elf]!.counters['+1/+1']).toBe(1);
    const c = getChars(s, elf)!;
    expect([...c.types].sort()).toEqual(['Artifact', 'Creature']);
    expect(subtypes(s, elf)).toEqual(['Borg']);
    expect(`${c.power}/${c.toughness}`).toBe('4/4'); // 1/1, the counter, and the Queen's +2/+2 for artifact creatures
    // the exiled Forest and Ritual (two cards) are the last two cards of their owner's library; the Ritual below the creature was never exiled and is now on top
    const lib = libraryNames(s, 'p2');
    expect(lib.slice(0, 1)).toEqual(['Test Odd Ritual']);
    expect(lib.slice(-2).sort()).toEqual(['Forest', 'Test Odd Ritual']);
    expect(s.zones.exile).toHaveLength(0);
    expect(zoneOf(s, 'Test Assimilated Elf')).toEqual(['battlefield']);
  });
  it('with no creature card in their library every card is exiled and then put back on the bottom (the library is the same cards): nothing is assimilated', () => {
    const s = enter(['Forest', 'Test Odd Ritual']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.defs[s.objects[id]!.defId]!.name !== 'Test Hive Sovereign')).toHaveLength(0);
    expect(s.zones.exile).toHaveLength(0);
    // (the scenario adds twenty Plains below the cards it is given: all 22 cards were exiled, then put back on the bottom in a random order)
    expect(s.zones.library.p2!.length).toBe(22);
    expect(libraryNames(s, 'p2').filter((n) => n !== 'Plains').sort()).toEqual(['Forest', 'Test Odd Ritual']);
  });
  it('the creature card found first is the one assimilated; a second creature card stays in the library', () => {
    const s = enter(['Test Assimilated Elf', 'Test Assimilated Elf']);
    expect(countOn(s, 'Test Assimilated Elf', 'p1')).toBe(1);
    expect(libraryNames(s, 'p2')[0]).toBe('Test Assimilated Elf'); // the second one was never exiled: still on top
    expect(s.zones.exile).toHaveLength(0);
  });
  it('the attack trigger does it again (the card enters or attacks)', () => {
    let s = enter(['Test Odd Ritual', 'Test Assimilated Elf', 'Test Assimilated Elf', 'Test Assimilated Elf']); // (p2 draws the second Elf in turn 2)
    s = advanceTo(s, 3, 'main1');
    const queen = onField(s, 'Test Hive Sovereign');
    s = passUntil(s, (t) => t.pending?.kind === 'declareAttackers' && t.pending.player === 'p1', 'the attack');
    s = resolveStack(mpDrive(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: queen, defender: 'p2' }] }), [target('p2')]));
    expect(countOn(s, 'Test Assimilated Elf', 'p1')).toBe(2);
  });
});

describe('CR 118.9, 601.2b, 101.2, 614.17b: Scotty, Miracle Worker: during your main phase each instant and sorcery card in your graveyard has beam me up, for its mana cost', () => {
  const ENGINEER = synthetic('Test Chief Engineer', 'Legendary Creature — Human Artificer', '{1}{U}{U}', "During your main phase, each card in your graveyard has beam me up. The beam me up cost is equal to that spell's mana cost. Test Chief Engineer can't be beamed up to cast a spell this way. (Only instant and sorcery spells can be cast this way. You may cast a card from your graveyard for its beam me up cost if you also return another creature you control to its owner's hand. Then exile that spell.)", { power: '2', toughness: '3' });
  const SIGNAL = synthetic('Test Hailing Signal', 'Sorcery', '{1}{U}', 'You gain 2 life.');
  const FLASH = synthetic('Test Quick Signal', 'Instant', '{U}', 'You gain 1 life.');
  const OWN = synthetic('Test Own Transport', 'Sorcery', '{3}', 'You gain 4 life.\nBeam me up {1} (You may cast this card from your graveyard for {1} if you also return a creature you control to its owner\'s hand. Then exile this spell.)');
  const ENSIGN = synthetic('Test Ensign', 'Creature — Vulcan Officer', '{1}', '', { power: '2', toughness: '2' });
  const BEAST = synthetic('Test Graveyard Beast', 'Creature — Beast', '{U}', '', { power: '2', toughness: '2' });
  const DEFS = [ENGINEER, SIGNAL, FLASH, OWN, ENSIGN, BEAST];
  const beamed = (s: GameState, name: string): Action | undefined =>
    castActions(s, 'p1', name).find((a) => ((a as { method?: string }).method ?? '').startsWith('beam me up')); // (the second way of one name is "beam me up:2")
  const board = (extra: { battlefield?: string[]; graveyard?: string[] } = {}): GameState =>
    scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Island', 'Island', 'Island', ...(extra.battlefield ?? [])], graveyard: extra.graveyard ?? ['Test Hailing Signal'] } });

  it('the card is automated; keeping the grantor out of the choice is a capability of the keyword', () => {
    expect(full(ENGINEER), JSON.stringify(ENGINEER.automation)).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:keyword.costIsManaCost')).toBe(true);
  });
  it('a sorcery card in your graveyard is cast for its mana cost, returning ANOTHER creature (the only candidate is the Ensign, not Scotty); the card is exiled after it resolves', () => {
    let s = board({ battlefield: ['Test Chief Engineer', 'Test Ensign'] });
    const engineer = onField(s, 'Test Chief Engineer');
    const cast = beamed(s, 'Test Hailing Signal');
    expect(cast).toBeDefined();
    s = pay(act(s, cast!));
    expect(s.zones.stack).toHaveLength(1);
    expect(zoneOf(s, 'Test Ensign')).toEqual(['hand']);
    expect(s.objects[engineer]!.zone).toBe('battlefield');
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(zoneOf(s, 'Test Hailing Signal')).toEqual(['exile']);
  });
  it('CR 614.17b: with Scotty alone on the battlefield there is no creature to return: not castable; with a second creature it is', () => {
    let s = board({ battlefield: ['Test Chief Engineer'] });
    expect(beamed(s, 'Test Hailing Signal')).toBeUndefined();
    s = board({ battlefield: ['Test Chief Engineer', 'Test Ensign'] });
    expect(beamed(s, 'Test Hailing Signal')).toBeDefined();
  });
  it('an instant card works too (cast in your main phase for {U}); a creature card in your graveyard has the ability but cannot be cast this way', () => {
    const s = board({ battlefield: ['Test Chief Engineer', 'Test Ensign'], graveyard: ['Test Quick Signal', 'Test Graveyard Beast'] });
    expect(beamed(s, 'Test Quick Signal')).toBeDefined();
    expect(beamed(s, 'Test Graveyard Beast')).toBeUndefined();
    expect(castActions(s, 'p1', 'Test Graveyard Beast')).toEqual([]);
  });
  it('CR 118.9, 601.2b: the cost is the mana cost of the spell cast: a split card\'s half costs its own, not both halves\' together; the dear half is not offered with three lands', () => {
    const FLAME = twoFaced('split', face('Test Quick Flame', '{1}{U}', 'Instant', 'You gain 2 life.'), face('Test Slow Frost', '{3}{U}', 'Instant', 'You gain 3 life.'));
    let s = scenario(['Island'], { defs: [...DEFS, FLAME], p1: { battlefield: ['Island', 'Island', 'Island', 'Test Chief Engineer', 'Test Ensign'], graveyard: ['Test Quick Flame // Test Slow Frost'] } });
    const acts = castActions(s, 'p1', 'Test Quick Flame // Test Slow Frost').filter((a) => ((a as { method?: string }).method ?? '').startsWith('beam me up'));
    expect(acts.map((a) => (a as { face?: number }).face ?? 0)).toEqual([0]); // {3}{U} is four mana: only the first half
    s = pay(act(s, acts[0]!));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.tapped).length).toBe(2); // {1}{U}, not {1}{U}{3}{U}
    expect(zoneOf(s, 'Test Ensign')).toEqual(['hand']);
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(22);
    expect(zoneOf(s, 'Test Quick Flame // Test Slow Frost')).toEqual(['exile']);
    // with five lands both halves are offered, the second for its own four mana
    const t = scenario(['Island'], { defs: [...DEFS, FLAME], p1: { battlefield: ['Island', 'Island', 'Island', 'Island', 'Island', 'Test Chief Engineer', 'Test Ensign'], graveyard: ['Test Quick Flame // Test Slow Frost'] } });
    const both = castActions(t, 'p1', 'Test Quick Flame // Test Slow Frost').filter((a) => ((a as { method?: string }).method ?? '').startsWith('beam me up'));
    expect(both.map((a) => (a as { face?: number }).face ?? 0).sort()).toEqual([0, 1]);
  });
  it('CR 715.3: an Adventurer in your graveyard is cast as its Adventure for the Adventure\'s mana cost, not the creature\'s', () => {
    const CHOP = twoFaced('adventure', face('Test Gloomy Giant', '{4}{U}', 'Creature — Giant', '', { power: '4', toughness: '4' }), face('Test Quick Chop', '{U}', 'Instant — Adventure', 'You gain 2 life.'));
    let s = scenario(['Island'], { defs: [...DEFS, CHOP], p1: { battlefield: ['Island', 'Test Chief Engineer', 'Test Ensign'], graveyard: ['Test Gloomy Giant // Test Quick Chop'] } });
    const acts = castActions(s, 'p1', 'Test Gloomy Giant // Test Quick Chop').filter((a) => ((a as { method?: string }).method ?? '').startsWith('beam me up'));
    expect(acts.map((a) => (a as { face?: number }).face ?? 0)).toEqual([1]); // the creature is no instant or sorcery; the Adventure costs {U}
    s = pay(act(s, acts[0]!));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.tapped).length).toBe(1);
    s = resolveAll(s);
    expect(lifeOf(s, 'p1')).toBe(22);
  });
  it('"during your main phase": not in the opponent\'s turn (even an instant), not in your combat', () => {
    let s = board({ battlefield: ['Test Chief Engineer', 'Test Ensign'], graveyard: ['Test Quick Signal'] });
    expect(beamed(s, 'Test Quick Signal')).toBeDefined();
    s = advanceTo(s, 1, 'beginCombat');
    expect(beamed(s, 'Test Quick Signal')).toBeUndefined();
    s = advanceTo(s, 2, 'main1');
    expect(beamed(s, 'Test Quick Signal')).toBeUndefined();
    s = advanceTo(s, 3, 'main1');
    expect(beamed(s, 'Test Quick Signal')).toBeDefined();
  });
  it('without Scotty the card has no beam me up at all; the opponent\'s graveyard gets none ("your graveyard")', () => {
    const s = board({ battlefield: ['Test Ensign'] });
    expect(beamed(s, 'Test Hailing Signal')).toBeUndefined();
    const t = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Island', 'Island', 'Island', 'Test Chief Engineer', 'Test Ensign'] }, p2: { graveyard: ['Test Hailing Signal'] } });
    expect(castActions(t, 'p1', 'Test Hailing Signal')).toEqual([]);
  });
  it('"to cast a spell this way": Scotty may be returned for a printed beam me up of a card (a card with both: two ways, the player chooses)', () => {
    let s = scenario(['Island'], { defs: DEFS, p1: { battlefield: ['Island', 'Island', 'Island', 'Test Chief Engineer'], graveyard: ['Test Own Transport'] } });
    // the printed beam me up costs {1}; Scotty is the only creature and may be returned for it
    const printed = beamed(s, 'Test Own Transport');
    expect(printed).toBeDefined();
    s = pay(act(s, printed!));
    expect(zoneOf(s, 'Test Chief Engineer')).toEqual(['hand']);
  });
});
