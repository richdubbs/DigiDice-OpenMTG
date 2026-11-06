/**
 * Commander EDHREC ranks 26,501-27,000, round edh-c-37: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), read in the session.
 *
 *   CR 701.20e, 205.3m, 608.2c    kinship: "you may look at the top card of your library. If it shares a creature type with ~, you may reveal it. If you do, ..."
 *   CR 702.104a-b, 614.12a        tribute N and "if tribute wasn't paid"
 *   CR 107.4, 202.1, 700.5        "the number of <color> mana symbols in the mana costs of <objects>"
 *   CR 118.12, 406.2, 608.2d      "you may exile two creature cards from your graveyard. If you do, draw a card."
 *   CR 305.7, 613.1d              "All Mountains are Plains."
 *   CR 508.1d, 611.2a, 702.96     "Target creature you don't control gets -2/-0 until end of turn and attacks this turn if able." (with overload)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, lands, pass, put, scenario, target, tweak, cast, drive, resolveAll } from '../../m6/dfc/support';
import { toDeclareAttackers } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d);
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const topOf = (s: GameState, p: string): string => s.zones.library[p]![0]!;
const ptOf = (s: GameState, id: string): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

/** Pass to the end step of the active player's turn, then answer the yes/no decisions in order until the stack is empty again. */
function endStep(s0: GameState, yes: boolean[]): GameState {
  let s = s0;
  for (let i = 0; i < 60 && !(s.turn.step === 'end' || s.pending?.kind === 'yesNo'); i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = pass(s);
  }
  const queue = [...yes];
  for (let i = 0; i < 20 && (s.zones.stack.length > 0 || s.pending?.kind === 'yesNo'); i++) {
    if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: queue.shift() ?? false });
    else s = pass(s);
  }
  return s;
}

describe('CR 701.20e, 205.3m, 608.2c: kinship ("look at the top card, if it shares a creature type with ~, you may reveal it, if you do, ...")', () => {
  const KIN = card('Test Tide Scout', 'Creature — Merfolk Scout', 'At the beginning of your end step, you may look at the top card of your library. If it shares a creature type with this creature, you may reveal it. If you do, you gain 5 life.', { pt: ['2', '2'] });
  const SAME = card('Test Tide Elder', 'Creature — Merfolk Elder', '', { pt: ['1', '1'] });
  const OTHER = card('Test Hill Brute', 'Creature — Giant', '', { pt: ['3', '3'] });
  const CHANGER = card('Test Many Faced', 'Creature — Shapeshifter', 'Changeling', { pt: ['1', '1'] });
  const board = (top: string): GameState => scenario(['Plains'], { defs: [KIN, SAME, OTHER, CHANGER], p1: { battlefield: ['Test Tide Scout'], library: [top] } });
  it('are full', () => { expect(full(KIN)).toBe(true); });
  it('the top card shares a type: look, reveal, then the last sentence happens; the card stays on top', () => {
    const s0 = board('Test Tide Elder');
    const s = endStep(s0, [true, true]);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 5);
    expect(s.defs[s.objects[topOf(s, 'p1')]!.defId]!.name).toBe('Test Tide Elder');
  });
  it('a changeling shares every creature type', () => {
    const s0 = board('Test Many Faced');
    expect(lifeOf(endStep(s0, [true, true]), 'p1')).toBe(lifeOf(s0, 'p1') + 5);
  });
  it('negative: the top card shares no type, so there is nothing to reveal (no second question, no effect)', () => {
    const s0 = board('Test Hill Brute');
    const s = endStep(s0, [true, true]);
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
  it('negative: a land shares no creature type', () => {
    const s0 = board('Plains');
    expect(lifeOf(endStep(s0, [true, true]), 'p1')).toBe(lifeOf(s0, 'p1'));
  });
  it('negative: not looking (declining the first "may") means nothing is compared, even when the top card shares a type', () => {
    const s0 = board('Test Tide Elder');
    expect(lifeOf(endStep(s0, [false, true]), 'p1')).toBe(lifeOf(s0, 'p1'));
  });
  it('negative: looking but not revealing does not do the last sentence (the ruling: you do not have to reveal it)', () => {
    const s0 = board('Test Tide Elder');
    expect(lifeOf(endStep(s0, [true, false]), 'p1')).toBe(lifeOf(s0, 'p1'));
  });
});

describe('CR 702.104a-b, 614.12a: tribute N and "if tribute wasn\'t paid"', () => {
  const BRUTE = card('Test Tribute Giant', 'Creature — Giant', 'Tribute 2\nWhen this creature enters, if tribute wasn\'t paid, you gain 5 life.', { pt: ['3', '3'] });
  const board = (players = 2): GameState => (players === 2
    ? scenario([], { defs: [BRUTE], p1: { hand: ['Test Tribute Giant'] } })
    : scenario([], { defs: [BRUTE], p1: { hand: ['Test Tribute Giant'] } }));
  const counters = (s: GameState): number => { const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === 'Test Tribute Giant')!; return s.objects[id]!.counters['+1/+1'] ?? 0; };
  it('is full', () => { expect(full(BRUTE)).toBe(true); });
  it('the opponent (not the controller) is asked; paying: it enters with two +1/+1 counters and the trigger does not happen', () => {
    const s0 = board();
    const s1 = cast(s0, 'Test Tribute Giant');
    const s2 = resolveAllAsking(s1, true);
    expect(counters(s2)).toBe(2);
    expect(lifeOf(s2, 'p1')).toBe(lifeOf(s0, 'p1'));
  });
  it('declining: no counters, and "if tribute wasn\'t paid" happens', () => {
    const s0 = board();
    const s2 = resolveAllAsking(cast(s0, 'Test Tribute Giant'), false);
    expect(counters(s2)).toBe(0);
    expect(lifeOf(s2, 'p1')).toBe(lifeOf(s0, 'p1') + 5);
  });
  it('the question goes to the opponent', () => {
    const s1 = resolveUntilYesNo(cast(board(), 'Test Tribute Giant'));
    expect(s1.pending?.kind).toBe('yesNo');
    expect(s1.pending?.player).toBe('p2');
  });
  it('four players: the controller chooses which opponent is asked, and only that one', () => {
    const s0 = mpScenario({ players: 4, seed: 'tr', defs: [BRUTE], zones: { p1: { hand: ['Test Tribute Giant'] } } });
    let t = cast(s0, 'Test Tribute Giant');
    for (let i = 0; i < 6 && t.pending?.kind === 'priority'; i++) t = pass(t);
    expect(t.pending?.kind).toBe('chooseOption');
    expect(t.pending?.player).toBe('p1');
    t = answer(t, { kind: 'chooseOption', ids: ['p3'] });
    expect(t.pending?.kind).toBe('yesNo');
    expect(t.pending?.player).toBe('p3');
  });
  it('the trigger still resolves when the creature has left the battlefield (ruling 2014-02-01)', () => {
    const s0 = board();
    let t = resolveUntilYesNo(cast(s0, 'Test Tribute Giant'));
    t = answer(t, { kind: 'yesNo', yes: false });
    expect(t.zones.stack.length).toBe(1);
    t = tweak(t, (x) => {
      const id = x.zones.battlefield.find((y) => x.objects[y]!.defId === 'Test Tribute Giant')!;
      x.zones.battlefield = x.zones.battlefield.filter((y) => y !== id);
      x.objects[id]!.zone = 'graveyard';
      x.zones.graveyard['p1']!.push(id);
    });
    const done = resolveAll(t);
    expect(lifeOf(done, 'p1')).toBe(lifeOf(s0, 'p1') + 5);
  });
  it('negative: a creature without the keyword gets no question and the condition word alone does nothing (no link: the card is not full)', () => {
    const NOKW = card('Test Plain Giant', 'Creature — Giant', 'When this creature enters, if tribute wasn\'t paid, you gain 5 life.', { pt: ['3', '3'] });
    expect(full(NOKW)).toBe(false);
  });
  function resolveUntilYesNo(s: GameState): GameState {
    let t = s;
    for (let i = 0; i < 10 && t.pending?.kind !== 'yesNo'; i++) { if (t.pending?.kind === 'priority') t = pass(t); else break; }
    return t;
  }
  function resolveAllAsking(s: GameState, pays: boolean): GameState {
    let t = resolveUntilYesNo(s);
    expect(t.pending?.kind).toBe('yesNo');
    t = answer(t, { kind: 'yesNo', yes: pays });
    for (let i = 0; i < 12 && (t.zones.stack.length > 0 || (t.pending && t.pending.kind !== 'priority')); i++) {
      if (t.pending?.kind === 'priority') t = pass(t);
      else break;
    }
    return t;
  }
});

describe('CR 107.4, 202.1: "the number of <color> mana symbols in the mana costs of <objects>"', () => {
  const IMP = card('Test Ember Imp', 'Creature — Imp', 'Haste\nWhen this creature enters, it gets +X/+0 until end of turn, where X is the number of red mana symbols in the mana costs of permanents you control.', { pt: ['1', '1'] });
  const RED2 = card('Test Red Rock', 'Artifact', '', { cost: '{R}{R}', colors: ['R'] });
  const HYB = card('Test Hybrid Rock', 'Artifact', '', { cost: '{2}{R/G}', colors: ['R', 'G'] });
  const BLUE = card('Test Blue Rock', 'Artifact', '', { cost: '{U}{U}', colors: ['U'] });
  const REDHAND = card('Test Red Spell', 'Sorcery', '', { cost: '{R}{R}{R}', colors: ['R'] });
  const STALKER = card('Test Dark Wisp', 'Creature — Spirit', "Test Dark Wisp's power and toughness are each equal to the number of black mana symbols in the mana costs of cards in your graveyard.", { pt: ['*', '*'] });
  const BLK = card('Test Black Card', 'Sorcery', '', { cost: '{1}{B}{B}', colors: ['B'] });
  const BLK2 = card('Test Black Rock', 'Artifact', '', { cost: '{B}', colors: ['B'] });
  it('are full', () => { expect(full(IMP)).toBe(true); expect(full(STALKER)).toBe(true); });
  it('counts the symbols of permanents you control (hybrid once each); not a card in hand, not the opponent\'s permanents', () => {
    const s0 = scenario([], { defs: [IMP, RED2, HYB, BLUE, REDHAND], p1: { hand: ['Test Ember Imp', 'Test Red Spell'], battlefield: ['Test Red Rock', 'Test Hybrid Rock', 'Test Blue Rock'] }, p2: { battlefield: ['Test Red Rock'] } });
    const s1 = resolveAll(cast(s0, 'Test Ember Imp'));
    expect(ptOf(s1, find(s1, 'Test Ember Imp', 'battlefield', 'p1'))).toBe('4/1'); // 1 + (RR + R/G = 3)
  });
  it('the amount is fixed as the ability resolves: another red permanent later does not change it', () => {
    const s0 = scenario([], { defs: [IMP, RED2, HYB, BLUE, REDHAND], p1: { hand: ['Test Ember Imp'], battlefield: ['Test Red Rock'] } });
    const s1 = resolveAll(cast(s0, 'Test Ember Imp'));
    const imp = find(s1, 'Test Ember Imp', 'battlefield', 'p1');
    expect(ptOf(s1, imp)).toBe('3/1');
    const s2 = tweak(s1, (t) => { put(t, 'p1', 'battlefield', 'Test Hybrid Rock'); });
    expect(ptOf(s2, imp)).toBe('3/1');
  });
  it('a characteristic-defining count of the cards in your graveyard: yours only, mana cost symbols only, it follows the graveyard', () => {
    const s0 = scenario([], { defs: [STALKER, BLK, BLK2], p1: { battlefield: ['Test Dark Wisp', 'Test Black Rock'], graveyard: ['Test Black Card'] }, p2: { graveyard: ['Test Black Card'] } });
    const id = find(s0, 'Test Dark Wisp', 'battlefield', 'p1');
    expect(ptOf(s0, id)).toBe('2/2'); // {1}{B}{B}: two black symbols; the battlefield artifact and the opponent's card do not count
    const s1 = tweak(s0, (t) => { put(t, 'p1', 'graveyard', 'Test Black Rock'); });
    expect(ptOf(s1, id)).toBe('3/3');
  });
});

describe('CR 118.12, 406.2, 608.2d: "you may exile two creature cards from your graveyard. If you do, draw a card."', () => {
  const SKAAB = card('Test Grave Drake', 'Creature — Drake', 'When this creature enters, you may exile two creature cards from your graveyard. If you do, draw a card.', { pt: ['2', '2'] });
  const DEAD = card('Test Dead Ogre', 'Creature — Ogre', '', { pt: ['2', '2'] });
  const SPELL = card('Test Dead Spell', 'Sorcery', '');
  const game = (gy: string[]): GameState => scenario(['Plains'], { defs: [SKAAB, DEAD, SPELL], p1: { hand: ['Test Grave Drake'], graveyard: gy } });
  const handAfter = (s: GameState): number => s.zones.hand['p1']!.length;
  it('is full', () => { expect(full(SKAAB)).toBe(true); });
  it('two creature cards in the graveyard: exiled, and a card is drawn', () => {
    const s0 = game(['Test Dead Ogre', 'Test Dead Ogre']);
    const s1 = cast(s0, 'Test Grave Drake');
    const s2 = resolveAll(s1, [{ kind: 'yesNo', yes: true }, { kind: 'chooseObjects', ids: s1.zones.graveyard['p1']!.slice(0, 2) }]);
    expect(s2.zones.graveyard['p1']!.length).toBe(0);
    expect(s2.zones.exile.length).toBe(2);
    expect(handAfter(s2)).toBe(handAfter(s0)); // the creature left the hand, one card drawn
  });
  it('negative: declining the "may" exiles nothing and draws nothing', () => {
    const s0 = game(['Test Dead Ogre', 'Test Dead Ogre']);
    const s2 = resolveAll(cast(s0, 'Test Grave Drake'), [{ kind: 'yesNo', yes: false }]);
    expect(s2.zones.graveyard['p1']!.length).toBe(2);
    expect(s2.zones.exile.length).toBe(0);
    expect(handAfter(s2)).toBe(handAfter(s0) - 1);
  });
  it('negative: one creature card and a noncreature card cannot pay; nothing is exiled or drawn', () => {
    const s0 = game(['Test Dead Ogre', 'Test Dead Spell']);
    const s2 = resolveAll(cast(s0, 'Test Grave Drake'));
    expect(s2.zones.graveyard['p1']!.length).toBe(2);
    expect(s2.zones.exile.length).toBe(0);
    expect(handAfter(s2)).toBe(handAfter(s0) - 1);
  });
});

describe('CR 305.7, 613.1d: "All Mountains are Plains."', () => {
  const CONV = card('Test Land Warp', 'Enchantment', 'All Mountains are Plains.', { cost: '{0}' });
  it('is full', () => { expect(full(CONV)).toBe(true); });
  it('a Mountain becomes a Plains (no longer a Mountain); a Forest is not changed', () => {
    const s0 = scenario(['Mountain', 'Forest'], { defs: [CONV], p1: { battlefield: ['Test Land Warp', 'Mountain'] }, p2: { battlefield: ['Mountain', 'Forest'] } });
    const mine = find(s0, 'Mountain', 'battlefield', 'p1');
    const theirs = find(s0, 'Mountain', 'battlefield', 'p2');
    const forest = find(s0, 'Forest', 'battlefield', 'p2');
    expect(getChars(s0, mine)!.subtypes).toEqual(['Plains']);
    expect(getChars(s0, theirs)!.subtypes).toEqual(['Plains']);
    expect(getChars(s0, forest)!.subtypes).toEqual(['Forest']);
  });
  it('negative: without the enchantment a Mountain is a Mountain', () => {
    const s0 = scenario(['Mountain'], { defs: [CONV], p1: { battlefield: ['Mountain'] } });
    expect(getChars(s0, find(s0, 'Mountain', 'battlefield', 'p1'))!.subtypes).toEqual(['Mountain']);
  });
});

describe('CR 508.1d, 611.2a, 702.96: "gets -2/-0 until end of turn and attacks this turn if able"', () => {
  const RILE = card('Test Goad Charm', 'Instant', "Target creature you don't control gets -2/-0 until end of turn and attacks this turn if able.\nOverload {2}{R}", { cost: '{R}', colors: ['R'] });
  const OGRE = card('Test Plain Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
  const required = (s: GameState): string[] => {
    const t = toDeclareAttackers(s);
    const d = t.pending as unknown as { requirements?: { kind: string; creature: string }[] };
    return (d.requirements ?? []).filter((r) => r.kind === 'attack').map((r) => r.creature);
  };
  // p2 casts it in p1's first main phase on p1's creatures ("you don't control" is p2's view)
  const board = (): GameState => scenario(['Mountain'], { defs: [RILE, OGRE], p1: { battlefield: ['Test Plain Ogre', 'Test Plain Ogre'] }, p2: { hand: ['Test Goad Charm'], battlefield: lands('Mountain', 3) } });
  it('is full', () => { expect(full(RILE)).toBe(true); });
  it('the targeted creature gets -2/-0 and must attack this turn; the other one is free to stay home', () => {
    const s0 = board();
    const ogre = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Plain Ogre');
    const s1 = cast(pass(s0), 'Test Goad Charm', [target(ogre[0]!)], 'p2');
    const s2 = resolveAll(s1);
    expect(ptOf(s2, ogre[0]!)).toBe('1/3');
    expect(required(s2)).toEqual([ogre[0]]);
  });
  it('negative: without it nothing is required of a creature', () => {
    expect(required(board())).toEqual([]);
  });
  it('overloaded: every creature you don\'t control gets -2/-0 and must attack (the requirement is a group, not the one target)', () => {
    const s0 = board();
    const ogre = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Plain Ogre');
    const s1 = drive(act(pass(s0), { type: 'cast', player: 'p2', card: find(pass(s0), 'Test Goad Charm', 'hand', 'p2'), method: 'overload' }), []);
    const s2 = resolveAll(s1);
    for (const o of ogre) expect(ptOf(s2, o)).toBe('1/3');
    expect([...required(s2)].sort()).toEqual([...ogre].sort());
  });
});

describe('the other chroma and tribute shapes of the top 30,000 (played with synthetic cards)', () => {
  it('chroma damage: "deals damage to target creature equal to the number of red mana symbols in the mana costs of permanents you control" counts yours only', () => {
    const SHAMAN = card('Test Spark Shaman', 'Creature — Shaman', 'When this creature enters, it deals damage to target creature equal to the number of red mana symbols in the mana costs of permanents you control.', { pt: ['1', '1'] });
    const ROCK = card('Test Red Rock', 'Artifact', '', { cost: '{R}{R}', colors: ['R'] });
    const BEAR = card('Test Big Bear', 'Creature — Bear', '', { pt: ['5', '5'] });
    expect(full(SHAMAN)).toBe(true);
    const s0 = scenario([], { defs: [SHAMAN, ROCK, BEAR], p1: { hand: ['Test Spark Shaman'], battlefield: ['Test Red Rock'] }, p2: { battlefield: ['Test Big Bear', 'Test Red Rock'] } });
    const bear = find(s0, 'Test Big Bear', 'battlefield', 'p2');
    const s1 = resolveAll(cast(s0, 'Test Spark Shaman'), [target(bear)]);
    expect(s1.objects[bear]!.damage).toBe(2);
  });
  it('chroma characteristic-defining count of permanents you control', () => {
    const CRUX = card('Test Green Crux', 'Creature — Elemental', "Test Green Crux's power and toughness are each equal to the number of green mana symbols in the mana costs of permanents you control.", { pt: ['*', '*'] });
    const TREE = card('Test Green Tree', 'Artifact', '', { cost: '{G}{G}{G}', colors: ['G'] });
    expect(full(CRUX)).toBe(true);
    const s0 = scenario([], { defs: [CRUX, TREE], p1: { battlefield: ['Test Green Crux', 'Test Green Tree'] }, p2: { battlefield: ['Test Green Tree'] } });
    expect(ptOf(s0, find(s0, 'Test Green Crux', 'battlefield', 'p1'))).toBe('3/3');
  });
  it('tribute variants: fight and a free cast of an instant from hand happen only when tribute was not paid', () => {
    const FIGHTER = card('Test Tribute Fighter', 'Creature — Giant', "Tribute 3\nWhen this creature enters, if tribute wasn't paid, you may have this creature fight another target creature.", { pt: ['3', '3'] });
    const CASTER = card('Test Tribute Mage', 'Creature — Wizard', "Tribute 2\nWhen this creature enters, if tribute wasn't paid, you may cast an instant or sorcery spell from your hand without paying its mana cost.", { pt: ['1', '1'] });
    expect(full(FIGHTER)).toBe(true);
    expect(full(CASTER)).toBe(true);
    const BEAR = card('Test Big Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
    const s0 = scenario([], { defs: [FIGHTER, BEAR], p1: { hand: ['Test Tribute Fighter'] }, p2: { battlefield: ['Test Big Bear'] } });
    const bear = find(s0, 'Test Big Bear', 'battlefield', 'p2');
    let t = cast(s0, 'Test Tribute Fighter');
    for (let i = 0; i < 6 && t.pending?.kind === 'priority'; i++) t = pass(t);
    t = answer(t, { kind: 'yesNo', yes: true }); // tribute paid: three counters, the trigger does not happen
    t = resolveAll(t);
    expect(t.objects[bear]!.damage).toBe(0);
  });
});
