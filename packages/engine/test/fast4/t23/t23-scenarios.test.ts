/**
 * FAST4 T23: the trigger clauses of parser/templates/zz-fast4/t23.json and the intervening "if" clauses, trigger events and filters the package added to the
 * hole grammars, played through the engine with synthetic cards compiled by the game's default compiler (invented wordings, design 6.10).
 *
 *   CR 603.4            an intervening "if" is checked when the ability triggers and again as it resolves; "that player" is the player of the trigger event
 *   CR 603.2, 105.2     "Whenever you cast a green spell or a Forest you control enters": either event; "a spell that's both green and blue": each color
 *   CR 613.4b, 613.1f   "~ has base power and toughness 5/3 until end of turn and gains trample until end of turn" (layers 7b and 6, CR 514.2)
 *   CR 607.2a, 105.2    "a spell of the chosen color": the color chosen as the permanent entered
 *   CR 603.2c, 603.10a  "Whenever one or more creature cards leave your graveyard": once per batch, only your creature cards
 *   CR 603.2, 111.1     "Whenever ~ or another nontoken Cat you control enters"
 *   CR 115.9b           "an instant or sorcery spell that targets a creature"
 *   CR 603.4, 603.10a   "a creature died under your control this turn", "three or more creatures died this turn", "two or more nonland permanents entered
 *                       the battlefield under your control this turn" (a creature put onto the battlefield from an opponent's graveyard under your control
 *                       counts, CR 108.4a, 110.2), "a permanent left the battlefield under your control this turn", "an opponent lost life this turn",
 *                       "you haven't cast a spell from your hand this turn", "~ didn't enter the battlefield this turn", "creatures you control have total
 *                       power 8 or greater" (CR 208.1)
 *   CR 602.5b           the same conditions as activation restrictions stay attested by the controller (onlyIf ask), as before T23
 *   CR 115.9b, 115.1    "Counter target spell that targets a creature"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type Color, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, findAll, legal, pass, put, scenario } from '../../m3/scenario';
import { lifeOf, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
/** Every ability of the card automated, and the card full. */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => getChars(s, id)!.keywords.some((x) => x.keyword === k);
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;

/** Answer the decisions that come up (targets, costs, then `answers` in order); stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty (each object resolves after both players pass), answering what comes up. */
function resolveAll(s0: GameState, targets: TargetChoice[] = [], answers: DecisionAnswer[] = []): GameState {
  let s = settle(s0, targets, answers);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), targets, answers);
  expect(s.zones.stack.length).toBe(0);
  return s;
}
const cast = (s: GameState, name: string, targets: TargetChoice[] = [], player = 'p1'): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), targets);
const atStep = (s: GameState, step: GameState['turn']['step']): GameState => advanceTo(s, s.turn.number, step);
/** The end step of the current turn with its triggers resolved. */
const endStep = (s: GameState, targets: TargetChoice[] = []): GameState => resolveAll(advanceTo(s, s.turn.number, 'end'), targets);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '5'] });
const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
const GREEN = card('Test Green Sip', 'Instant', 'You gain 0 life.', { colors: ['G'] });
const RED = card('Test Red Sip', 'Instant', 'You gain 0 life.', { colors: ['R'] });
const KELP = card('Test Kelp Sip', 'Instant', 'You gain 0 life.', { colors: ['G', 'U'] });
const WOODS = card('Test Woods', 'Land — Forest', '');

describe('CR 603.4: "At the beginning of each opponent\'s upkeep, if that player has two or fewer cards in hand, ~ deals 3 damage to that player."', () => {
  const MUSE = card('Test Ember Muse', 'Creature — Spirit', "At the beginning of each opponent's upkeep, if that player has two or fewer cards in hand, this creature deals 3 damage to that player.", { pt: ['3', '3'] });
  const game = (hand: string[]): GameState => scenario([], { p1: { battlefield: ['Test Ember Muse'] }, p2: { hand }, defs: [MUSE, BEAR] });
  it('is automated; the opponent with two cards in hand is dealt 3 damage in their upkeep', () => {
    expect(full(MUSE)).toBe(true);
    const s = resolveAll(advanceTo(game(['Test Bear', 'Test Bear']), 2, 'upkeep'));
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
  it('with three cards in hand it does not trigger', () => {
    const s = advanceTo(game(['Test Bear', 'Test Bear', 'Test Bear']), 2, 'upkeep');
    expect(s.zones.stack.length).toBe(0);
    expect(lifeOf(resolveAll(s), 'p2')).toBe(20);
  });
  it('the condition is checked again as it resolves: a third card in hand by then and it does nothing', () => {
    let s = advanceTo(game(['Test Bear', 'Test Bear']), 2, 'upkeep');
    expect(s.zones.stack.length).toBe(1);
    s = tweak(s, (t) => { put(t, 'p2', 'hand', 'Test Bear'); });
    expect(lifeOf(resolveAll(s), 'p2')).toBe(20);
  });
  it('not in its controller\'s own upkeep', () => {
    const s = advanceTo(scenario([], { p1: { battlefield: ['Test Ember Muse'] }, defs: [MUSE] }), 3, 'upkeep');
    expect(s.zones.stack.length).toBe(0);
  });
});

describe('CR 603.2, 105.2: "Whenever you cast a green spell or a Forest you control enters, you gain 1 life."', () => {
  const STAFF = card('Test Grove Staff', 'Artifact', 'Whenever you cast a green spell or a Forest you control enters, you gain 1 life.');
  it('is automated; a green spell and a Forest each trigger it, a red spell and an opponent\'s Forest do not', () => {
    expect(full(STAFF)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Grove Staff'], hand: ['Test Green Sip', 'Test Red Sip', 'Test Woods'] }, p2: { hand: ['Test Woods', 'Test Green Sip'] }, defs: [STAFF, GREEN, RED, WOODS] });
    s = resolveAll(cast(s, 'Test Green Sip'));
    expect(lifeOf(s, 'p1')).toBe(21);
    s = resolveAll(cast(s, 'Test Red Sip'));
    expect(lifeOf(s, 'p1')).toBe(21);
    s = resolveAll(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Woods', 'hand', 'p1') }));
    expect(lifeOf(s, 'p1')).toBe(22);
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(act(s, { type: 'playLand', player: 'p2', card: find(s, 'Test Woods', 'hand', 'p2') }));
    s = resolveAll(cast(s, 'Test Green Sip', [], 'p2'));
    expect(lifeOf(s, 'p1')).toBe(22);
  });
});

describe('CR 105.2, 613.4b, 613.1f: "Whenever you cast a spell that\'s both green and blue, ~ has base power and toughness 5/3 until end of turn and gains trample until end of turn."', () => {
  const MIMIC = card('Test Tide Mimic', 'Creature — Shapeshifter', "Whenever you cast a spell that's both green and blue, this creature has base power and toughness 5/3 until end of turn and gains trample until end of turn.", { pt: ['2', '1'] });
  it('is automated; only a spell of both colors triggers it, and the change lasts until end of turn', () => {
    expect(full(MIMIC)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Tide Mimic', 'Test Ogre'], hand: ['Test Green Sip', 'Test Kelp Sip'] }, defs: [MIMIC, GREEN, KELP, OGRE] });
    const mimic = find(s, 'Test Tide Mimic', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Green Sip'));
    expect(pt(s, mimic)).toBe('2/1');
    expect(hasKeyword(s, mimic, 'trample')).toBe(false);
    s = resolveAll(cast(s, 'Test Kelp Sip'));
    expect(pt(s, mimic)).toBe('5/3');
    expect(hasKeyword(s, mimic, 'trample')).toBe(true);
    // CR 613.4c after 613.4b: a +1/+1 counter applies on top of the base 5/3
    s = tweak(s, (t) => { t.objects[mimic]!.counters['+1/+1'] = 1; });
    expect(pt(s, mimic)).toBe('6/4');
    s = advanceTo(s, 2, 'upkeep');
    expect(pt(s, mimic)).toBe('3/2');
    expect(hasKeyword(s, mimic, 'trample')).toBe(false);
  });
});

describe('CR 607.2a, 105.2: "As ~ enters, choose a color. Whenever you cast a spell of the chosen color, you gain 1 life."', () => {
  const MARE = card('Test Gem Mare', 'Creature — Horse', 'As this creature enters, choose a color.\nWhenever you cast a spell of the chosen color, you gain 1 life.', { pt: ['1', '3'] });
  it('is automated; a spell of the color chosen as it entered triggers it, another color does not', () => {
    expect(full(MARE)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Gem Mare', 'Test Green Sip', 'Test Red Sip'] }, defs: [MARE, GREEN, RED] });
    s = cast(s, 'Test Gem Mare');
    s = pass(pass(s));
    const p = s.pending as unknown as { kind: string; options?: unknown[] };
    const green: DecisionAnswer = p.kind === 'chooseColor'
      ? ({ kind: 'chooseColor', color: 'G' } as unknown as DecisionAnswer)
      : ({ kind: 'chooseOption', index: (p.options ?? []).findIndex((o) => /green|^G$/i.test(typeof o === 'string' ? o : JSON.stringify(o))) } as unknown as DecisionAnswer);
    s = resolveAll(answer(s, green));
    expect(lifeOf(s, 'p1')).toBe(20);
    s = resolveAll(cast(s, 'Test Red Sip'));
    expect(lifeOf(s, 'p1')).toBe(20);
    s = resolveAll(cast(s, 'Test Green Sip'));
    expect(lifeOf(s, 'p1')).toBe(21);
  });
});

describe('CR 603.2c, 603.10a, 400.3: "Whenever one or more creature cards leave your graveyard, each opponent loses 1 life and you gain 1 life."', () => {
  const TOLL = card('Test Bone Toll', 'Enchantment', 'Whenever one or more creature cards leave your graveyard, each opponent loses 1 life and you gain 1 life.');
  const SWEEP = card('Test Grave Sweep', 'Sorcery', "Exile target player's graveyard.");
  const PLUCK = card('Test Grave Pluck', 'Instant', 'Exile target card from a graveyard.');
  it('is automated; once for several creature cards leaving together, not for a land card or an opponent\'s creature card', () => {
    expect(full(TOLL)).toBe(true);
    let s = scenario([], {
      p1: { battlefield: ['Test Bone Toll'], hand: ['Test Grave Pluck', 'Test Grave Pluck', 'Test Grave Sweep'], graveyard: ['Test Bear', 'Test Ogre', 'Test Woods', 'Test Bear'] },
      p2: { graveyard: ['Test Bear'] }, defs: [TOLL, SWEEP, PLUCK, BEAR, OGRE, WOODS],
    });
    expect(full(PLUCK) && full(SWEEP)).toBe(true);
    s = resolveAll(cast(s, 'Test Grave Pluck', [obj(find(s, 'Test Woods', 'graveyard', 'p1'))]));
    expect(lifeOf(s, 'p1')).toBe(20);
    s = resolveAll(cast(s, 'Test Grave Pluck', [obj(find(s, 'Test Bear', 'graveyard', 'p2'))]));
    expect(lifeOf(s, 'p1')).toBe(20);
    s = resolveAll(cast(s, 'Test Grave Sweep', [{ kind: 'player', id: 'p1' }]));
    expect(s.zones.graveyard['p1']!.filter((id) => /Bear|Ogre/.test(s.objects[id]!.defId)).length).toBe(0);
    expect(lifeOf(s, 'p1')).toBe(21);
    expect(lifeOf(s, 'p2')).toBe(19);
  });
});

describe('CR 603.2, 111.1: "Whenever ~ or another nontoken Cat you control enters, create a 1/1 white Cat creature token."', () => {
  const ELDER = card('Test Pride Elder', 'Legendary Creature — Cat', 'Whenever this creature or another nontoken Cat you control enters, create a 1/1 white Cat creature token.', { pt: ['2', '2'] });
  const KITTEN = card('Test Kitten', 'Creature — Cat', '', { pt: ['1', '1'] });
  const tokens = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length;
  it('is automated; it triggers for itself and for a nontoken Cat, not for the Cat tokens it makes or a non-Cat', () => {
    expect(full(ELDER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Pride Elder', 'Test Kitten', 'Test Bear'] }, defs: [ELDER, KITTEN, BEAR] });
    s = resolveAll(cast(s, 'Test Pride Elder'));
    expect(tokens(s)).toBe(1);
    s = resolveAll(cast(s, 'Test Kitten'));
    expect(tokens(s)).toBe(2);
    s = resolveAll(cast(s, 'Test Bear'));
    expect(tokens(s)).toBe(2);
  });
});

describe('CR 115.9b: "Whenever you cast an instant or sorcery spell that targets a creature, put a +1/+1 counter on ~."', () => {
  const MAGE = card('Test Scorn Mage', 'Creature — Human Wizard', 'Whenever you cast an instant or sorcery spell that targets a creature, put a +1/+1 counter on this creature.', { pt: ['1', '1'] });
  const PUMP = card('Test Pump', 'Instant', 'Target creature gets +1/+1 until end of turn.');
  const INSIGHT = card('Test Insight', 'Instant', 'Target player draws a card.');
  it('is automated; a spell that targets a creature triggers it, one that targets a player does not', () => {
    expect(full(MAGE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Scorn Mage', 'Test Bear'], hand: ['Test Pump', 'Test Insight'] }, defs: [MAGE, PUMP, INSIGHT, BEAR] });
    const mage = find(s, 'Test Scorn Mage', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Test Insight', [{ kind: 'player', id: 'p1' }]));
    expect(s.objects[mage]!.counters['+1/+1'] ?? 0).toBe(0);
    s = resolveAll(cast(s, 'Test Pump', [obj(find(s, 'Test Bear', 'battlefield', 'p1'))]));
    expect(s.objects[mage]!.counters['+1/+1'] ?? 0).toBe(1);
  });
});

describe('CR 603.4, 603.10a: history conditions at the beginning of the end step', () => {
  const DRAWER = (name: string, cond: string, step = 'At the beginning of your end step'): CardDef => card(name, 'Creature — Human', `${step}, if ${cond}, draw a card.`, { pt: ['1', '1'] });
  it('"a creature died under your control this turn": your creature dying counts, an opponent\'s does not', () => {
    const SCHOLAR = DRAWER('Test Grave Scholar', 'a creature died under your control this turn');
    expect(full(SCHOLAR)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Grave Scholar', 'Test Bear'], hand: ['Test Kill'] }, p2: { battlefield: ['Test Bear'] }, defs: [SCHOLAR, BEAR, KILL] });
    const theirs = resolveAll(cast(s0, 'Test Kill', [obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]));
    expect(handSize(endStep(theirs), 'p1')).toBe(handSize(theirs, 'p1'));
    const mine = resolveAll(cast(s0, 'Test Kill', [obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]));
    expect(handSize(endStep(mine), 'p1')).toBe(handSize(mine, 'p1') + 1);
  });
  it('"three or more creatures died this turn": anyone\'s creatures, counted one each', () => {
    const RECALL = DRAWER('Test Blood Recall', 'three or more creatures died this turn', 'At the beginning of each end step');
    const WIPE = card('Test Wipe', 'Sorcery', 'Destroy all creatures.');
    expect(full(RECALL)).toBe(true);
    const game = (p2: string[]): GameState => scenario([], { p1: { battlefield: [{ name: 'Test Blood Recall', counters: {} }, 'Test Bear'], hand: ['Test Wipe'] }, p2: { battlefield: p2 }, defs: [RECALL, BEAR, WIPE] });
    // the Recall dies too; a new one is put onto the battlefield to watch the end step (the history of the turn is the game's, not the permanent's)
    let s = resolveAll(cast(game(['Test Bear', 'Test Bear']), 'Test Wipe'));
    s = tweak(s, (t) => { put(t, 'p1', 'battlefield', 'Test Blood Recall'); });
    expect(handSize(endStep(s), 'p1')).toBe(handSize(s, 'p1') + 1); // the Recall, a Bear and two Bears of p2: four died
    let u = resolveAll(cast(scenario([], { p1: { hand: ['Test Wipe'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] }, defs: [RECALL, BEAR, WIPE] }), 'Test Wipe'));
    u = tweak(u, (t) => { put(t, 'p1', 'battlefield', 'Test Blood Recall'); });
    expect(handSize(endStep(u), 'p1')).toBe(handSize(u, 'p1')); // two died
  });
  it('"two or more nonland permanents entered the battlefield under your control this turn": tokens count, lands and an opponent\'s permanents do not', () => {
    const HOST = DRAWER('Test Revel Host', 'two or more nonland permanents entered the battlefield under your control this turn');
    const TOKENS = card('Test Two Pups', 'Sorcery', 'Create two 1/1 green Dog creature tokens.');
    expect(full(HOST)).toBe(true);
    const game = (hand: string[], p2hand: string[] = []): GameState => scenario([], { p1: { battlefield: ['Test Revel Host'], hand }, p2: { hand: p2hand }, defs: [HOST, BEAR, WOODS, TOKENS] });
    let s = resolveAll(cast(game(['Test Bear', 'Test Bear']), 'Test Bear'));
    s = resolveAll(cast(s, 'Test Bear'));
    expect(handSize(endStep(s), 'p1')).toBe(handSize(s, 'p1') + 1);
    let t = resolveAll(cast(game(['Test Bear', 'Test Woods']), 'Test Bear'));
    t = act(t, { type: 'playLand', player: 'p1', card: find(t, 'Test Woods', 'hand', 'p1') });
    expect(handSize(endStep(t), 'p1')).toBe(handSize(t, 'p1'));
    const u = resolveAll(cast(game(['Test Two Pups']), 'Test Two Pups'));
    expect(handSize(endStep(u), 'p1')).toBe(handSize(u, 'p1') + 1);
  });
  it('a creature put onto the battlefield from an opponent\'s graveyard under your control entered under your control (CR 108.4a, 110.2)', () => {
    const HOST = DRAWER('Test Revel Host', 'two or more nonland permanents entered the battlefield under your control this turn');
    const RAISE = card('Test Raise', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control.');
    expect(full(RAISE)).toBe(true);
    let s = scenario([], { p1: { battlefield: ['Test Revel Host'], hand: ['Test Raise', 'Test Bear'] }, p2: { graveyard: ['Test Ogre'] }, defs: [HOST, BEAR, OGRE, RAISE] });
    s = resolveAll(cast(s, 'Test Raise', [obj(find(s, 'Test Ogre', 'graveyard', 'p2'))]));
    expect(s.objects[find(s, 'Test Ogre', 'battlefield')]!.controller).toBe('p1');
    s = resolveAll(cast(s, 'Test Bear'));
    expect(handSize(endStep(s), 'p1')).toBe(handSize(s, 'p1') + 1);
  });
  it('"a permanent left the battlefield under your control this turn": yours leaving counts, an opponent\'s does not', () => {
    const EXTERM = DRAWER('Test Exterminator', 'a permanent left the battlefield under your control this turn');
    const BOUNCE = card('Test Bounce', 'Instant', "Return target creature to its owner's hand.");
    expect(full(EXTERM)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Exterminator', 'Test Bear'], hand: ['Test Bounce'] }, p2: { battlefield: ['Test Bear'] }, defs: [EXTERM, BEAR, BOUNCE] });
    const theirs = resolveAll(cast(s0, 'Test Bounce', [obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]));
    expect(handSize(endStep(theirs), 'p1')).toBe(handSize(theirs, 'p1'));
    const mine = resolveAll(cast(s0, 'Test Bounce', [obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]));
    expect(handSize(endStep(mine), 'p1')).toBe(handSize(mine, 'p1') + 1);
  });
  it('"an opponent lost life this turn": not your own life loss', () => {
    const THIEF = DRAWER('Test Blood Thief', 'an opponent lost life this turn');
    const DRAIN = card('Test Drain', 'Instant', 'Target player loses 2 life.');
    expect(full(THIEF)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Blood Thief'], hand: ['Test Drain'] }, defs: [THIEF, DRAIN] });
    const self = resolveAll(cast(s0, 'Test Drain', [{ kind: 'player', id: 'p1' }]));
    expect(handSize(endStep(self), 'p1')).toBe(handSize(self, 'p1'));
    const opp = resolveAll(cast(s0, 'Test Drain', [{ kind: 'player', id: 'p2' }]));
    expect(handSize(endStep(opp), 'p1')).toBe(handSize(opp, 'p1') + 1);
  });
  it('"you haven\'t cast a spell from your hand this turn": a spell cast from your hand turns it off', () => {
    const CRAB = DRAWER('Test Canyon Crab', "you haven't cast a spell from your hand this turn");
    expect(full(CRAB)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Canyon Crab'], hand: ['Test Green Sip'] }, defs: [CRAB, GREEN] });
    expect(handSize(endStep(s0), 'p1')).toBe(handSize(s0, 'p1') + 1);
    const s = resolveAll(cast(s0, 'Test Green Sip'));
    expect(handSize(endStep(s), 'p1')).toBe(handSize(s, 'p1'));
  });
});

describe('CR 603.4, 400.7: "At the beginning of your end step, if ~ didn\'t enter the battlefield this turn, return it to its owner\'s hand."', () => {
  const CACTUS = card('Test Needle Cactus', 'Creature — Plant', "At the beginning of your end step, if this creature didn't enter the battlefield this turn, return it to its owner's hand.", { pt: ['1', '1'] });
  it('is automated; it stays the turn it entered and returns on a later turn', () => {
    expect(full(CACTUS)).toBe(true);
    const cast0 = resolveAll(cast(scenario([], { p1: { hand: ['Test Needle Cactus'] }, defs: [CACTUS] }), 'Test Needle Cactus'));
    let s = endStep(cast0);
    expect(findAll(s, 'Test Needle Cactus', 'battlefield').length).toBe(1);
    const old = endStep(scenario([], { p1: { battlefield: ['Test Needle Cactus'] }, defs: [CACTUS] }));
    expect(findAll(old, 'Test Needle Cactus', 'battlefield').length).toBe(0);
    expect(findAll(old, 'Test Needle Cactus', 'hand').length).toBe(1);
    s = endStep(advanceTo(s, 3, 'main1'));
    expect(findAll(s, 'Test Needle Cactus', 'hand').length).toBe(1);
  });
});

describe('CR 603.4, 208.1: "At the beginning of combat on your turn, if creatures you control have total power 8 or greater, target creature you control gains haste until end of turn."', () => {
  const CALLER = card('Test Hunt Caller', 'Creature — Human', 'At the beginning of combat on your turn, if creatures you control have total power 8 or greater, target creature you control gains haste until end of turn.', { pt: ['3', '2'] });
  it('is automated; it triggers with total power 8 (3 + 5) and not with 7 (an opponent\'s creatures do not count)', () => {
    expect(full(CALLER)).toBe(true);
    const fresh = scenario([], { p1: { battlefield: ['Test Hunt Caller', 'Test Ogre'] }, defs: [CALLER, OGRE] });
    const t = resolveAll(atStep(fresh, 'beginCombat'), [obj(find(fresh, 'Test Ogre', 'battlefield', 'p1'))]);
    expect(hasKeyword(t, find(t, 'Test Ogre', 'battlefield', 'p1'), 'haste')).toBe(true);
    const weak = scenario([], { p1: { battlefield: ['Test Hunt Caller', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: [CALLER, OGRE, BEAR] });
    const u = atStep(weak, 'beginCombat');
    expect(u.zones.stack.length).toBe(0);
  });
});

describe("CR 602.5b: as activation restrictions the new conditions are read where the announcement can read them (a total since std-ry5, this turn's history since std-blb)", () => {
  const onlyIf = (d: CardDef): unknown => (d.faces[0]!.abilities.find((x) => x.kind === 'activated') as { onlyIf?: unknown } | undefined)?.onlyIf;
  it('"... creatures you control have total power 8 or greater" is read as the ability is activated since std-ry5 (formidable, announce.qty.stat.sum.each; it was attested from T23 on); "Activate only if an opponent lost life this turn" is read from the turn\'s history since std-tdm / std-blb (model/forms.ts#turnHistoryAtAnnouncement)', () => {
    const PIT = card('Test Pit Brawler', 'Creature — Human', '{0}: You gain 1 life. Activate only if an opponent lost life this turn.', { pt: ['1', '1'] });
    const SCARRED = card('Test Scarred Bear', 'Creature — Bear', '{0}: You gain 1 life. Activate only if creatures you control have total power 8 or greater.', { pt: ['3', '2'] });
    expect(onlyIf(PIT)).toEqual({ cond: 'happened', event: { ev: 'life', change: 'loss', player: 'opponent' }, scope: 'turn' });
    expect(onlyIf(SCARRED)).toEqual({ cond: 'compare', left: { q: 'stat', stat: 'power', of: { ref: 'each', filter: { types: ['Creature'], controller: 'you' } }, sum: true }, op: '>=', right: 8 });
    expect(PIT.automation.level).toBe('full');
    expect(SCARRED.automation.level).toBe('full');
  });
});

describe('CR 115.9b, 115.1: "Counter target spell that targets a creature." (the filter of a target, parser/holes/filter.ts)', () => {
  const SNARE = card('Test Snare', 'Instant', 'Counter target spell that targets a creature.');
  const PUMP = card('Test Pump', 'Instant', 'Target creature gets +1/+1 until end of turn.');
  const INSIGHT = card('Test Insight', 'Instant', 'Target player draws a card.');
  it('is automated; a spell that targets a creature can be its target, a spell that targets a player cannot', () => {
    expect(full(SNARE)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'], hand: ['Test Pump', 'Test Insight'] }, p2: { hand: ['Test Snare'] }, defs: [SNARE, PUMP, INSIGHT, BEAR] });
    const targetable = (s: GameState, spell: string): boolean => {
      const t = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Snare', 'hand', 'p2') });
      const p = t.pending as unknown as { kind: string; options?: unknown; specs?: unknown };
      return JSON.stringify(p).includes(`"${find(s, spell, 'stack', 'p1')}"`);
    };
    let s = cast(s0, 'Test Pump', [obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]);
    s = pass(s); // p2 has priority with the Pump on the stack
    expect(targetable(s, 'Test Pump')).toBe(true);
    let u = cast(s0, 'Test Insight', [{ kind: 'player', id: 'p1' }]);
    u = pass(u);
    expect(() => targetable(u, 'Test Insight')).toThrow(); // no legal target: the spell can't be cast (CR 601.2c)
  });
});
