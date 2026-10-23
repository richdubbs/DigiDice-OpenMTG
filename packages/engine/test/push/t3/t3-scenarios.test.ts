/**
 * T3 (push wave): the promoted and new templates, and the fixes the review needed, played through applyAction with synthetic cards compiled by the game's
 * default compiler (wordings are invented, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 608.2d         "you may remove a counter ... If you do" is not offered without the counter
 *   CR 608.2h, 400.7  "draw cards equal to the number of counters on it" after it died reads it as it last existed
 *   CR 603.2          "Whenever you discard a card" triggers once per card
 *   CR 509.1b         "can block only creatures with flying"
 *   CR 603.7a         "at the beginning of the next turn's upkeep"
 *   CR 509.1, 509.3b-d  "attacks or blocks, it gets ..." is the object itself; "blocks or becomes blocked by a white creature" shares the noun phrase
 *   CR 707.10f        a copy of a triggering spell that can be a permanent spell is not automated (op:copy.permanentSpell)
 */
import { describe, expect, it } from 'vitest';
import { capabilitiesOf, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, pass, passBoth, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, toStep } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const hand = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const life = (s: GameState, p = 'p1'): number => s.players.find((x) => x.id === p)!.life;
const castWithTargets = (s: GameState, name: string, targets: ObjectId[] = []): GameState => {
  let t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') });
  while (t.pending && t.pending.kind !== 'priority') {
    if (t.pending.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object', id })) });
    else if (t.pending.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    else break;
  }
  return t;
};
const level = (d: CardDef): string => d.automation.level;

describe('CR 608.2d: what "you may" offers', () => {
  const TRADE = card('Test Counter Trade', 'Instant', 'You may remove a +1/+1 counter from target creature you control. If you do, draw a card.');

  it('CR 608.2d: the compiled cards are fully automated (ch.may, stable since T3)', () => {
    expect(level(TRADE)).toBe('full');
  });

  it('CR 608.2d: removing a +1/+1 counter can\'t be chosen without one: no question, no card drawn', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Counter Trade'], battlefield: ['Grizzly Bears'] }, defs: [TRADE] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = castWithTargets(s0, 'Test Counter Trade', [bears]);
    const before = hand(s);
    s = passBoth(s);
    expect(s.pending?.kind).toBe('priority');
    expect(hand(s)).toBe(before);
  });

  it('CR 608.2d: with the counter the player is asked; "yes" removes it and draws', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Counter Trade'], battlefield: [{ name: 'Grizzly Bears', counters: { '+1/+1': 1 } }] }, defs: [TRADE] });
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    let s = castWithTargets(s0, 'Test Counter Trade', [bears]);
    const before = hand(s);
    s = passBoth(s);
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(s.objects[bears]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(hand(s)).toBe(before + 1);
  });
});

describe('CR 608.2h, 400.7: a quantity about an object that left reads its last known information', () => {
  const HOARD = card('Test Hoarding Beetle', 'Creature — Insect', 'When this creature dies, draw cards equal to the number of +1/+1 counters on it.', ['1', '1']);
  it('CR 608.2h: "draw cards equal to the number of +1/+1 counters on it" after it died draws as many as it had (eff.draw.equal.you)', () => {
    expect(level(HOARD)).toBe('full');
    const s0 = scenario(['Doom Blade'], { p1: { hand: ['Doom Blade'], battlefield: [{ name: 'Test Hoarding Beetle', counters: { '+1/+1': 2 } }, 'Swamp', 'Swamp'] }, defs: [HOARD, card('Swamp', 'Basic Land — Swamp', '({T}: Add {B}.)')] });
    const beetle = find(s0, 'Test Hoarding Beetle', 'battlefield');
    let s = castWithTargets(s0, 'Doom Blade', [beetle]);
    const before = hand(s);
    s = passBoth(s); // Doom Blade resolves; the dies trigger goes on the stack
    s = passBoth(s); // the trigger resolves
    expect(hand(s)).toBe(before + 2);
  });
});

describe('CR 608.2h, 701.6a: "draw cards equal to that spell\'s mana value" after countering it', () => {
  const SNARE = card('Test Mind Snare', 'Instant', "Counter target creature spell. Draw cards equal to that spell's mana value.");
  const TWO = card('Test Two Drop', 'Creature — Golem', '', ['2', '2'], '{2}');
  it('CR 608.2h: the countered spell\'s mana value (2) is read as it last existed on the stack', () => {
    expect(level(SNARE)).toBe('full');
    const s0 = scenario([], { p1: { hand: ['Test Two Drop', 'Test Mind Snare'], battlefield: ['Plains', 'Plains'] }, defs: [SNARE, TWO] });
    let s = castWithTargets(s0, 'Test Two Drop');
    const spell = s.zones.stack[s.zones.stack.length - 1]!;
    s = castWithTargets(s, 'Test Mind Snare', [spell]);
    const before = hand(s);
    s = passBoth(s);
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Two Drop')).toBe(true);
    expect(hand(s)).toBe(before + 2);
  });
});

describe('CR 603.2: "Whenever you discard a card" triggers for each card', () => {
  const ALTAR = card('Test Discard Altar', 'Enchantment', 'Whenever you discard a card, you gain 1 life.');
  const DUMP = card('Test Double Dump', 'Sorcery', 'Discard two cards.');
  it('CR 603.2, 701.9a: discarding two cards gains 2 life (trg.you.discard)', () => {
    expect(level(ALTAR)).toBe('full');
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Double Dump', 'Plains', 'Plains'], battlefield: ['Test Discard Altar'] }, defs: [ALTAR, DUMP] });
    let s = castWithTargets(s0, 'Test Double Dump');
    s = passBoth(s); // two cards discarded (the whole hand): two triggers to order (CR 603.3b)
    expect(s.pending?.kind).toBe('order');
    s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((i) => i.id) });
    expect(s.zones.stack.length).toBe(2);
    while (s.zones.stack.length > 0) s = passBoth(s);
    expect(life(s)).toBe(22);
  });
});

describe('CR 509.1b: "can block only creatures with flying" (rst.blockonly)', () => {
  const TERN = card('Test Sky Picket', 'Creature — Bird', 'Flying\nThis creature can block only creatures with flying.', ['1', '1']);
  const KITE = card('Test Kite', 'Creature — Bird', 'Flying', ['1', '1']);
  const OX = card('Test Ox', 'Creature — Ox', '', ['1', '1']);
  const blockOptions = (s: GameState, blocker: ObjectId): ObjectId[] =>
    (s.pending as { candidates: { id: ObjectId; attackers: ObjectId[] }[] }).candidates.find((c) => c.id === blocker)?.attackers ?? [];

  it('CR 509.1b: it is offered as a blocker for a creature with flying only', () => {
    expect(level(TERN)).toBe('full');
    const s0 = scenario([], { p1: { battlefield: ['Test Kite', 'Test Ox'] }, p2: { battlefield: ['Test Sky Picket'] }, defs: [TERN, KITE, OX] });
    const [kite, ox, picket] = [find(s0, 'Test Kite', 'battlefield'), find(s0, 'Test Ox', 'battlefield'), find(s0, 'Test Sky Picket', 'battlefield')];
    let s = declareAttackers(toDeclareAttackers(s0), [[kite], [ox]]);
    s = toDeclareBlockers(s);
    expect(blockOptions(s, picket)).toEqual([kite]);
  });
});

describe('CR 603.7a, 503.1: "at the beginning of the next turn\'s upkeep" (dl.nextTurnUpkeep.tail)', () => {
  const LETTER = card('Test Slow Letter', 'Sorcery', "Draw a card at the beginning of the next turn's upkeep.");
  it('CR 603.7a: cast in the first main phase, the card is drawn in the upkeep of the next turn (the opponent\'s), not before', () => {
    expect(level(LETTER)).toBe('full');
    const s0 = scenario([], { p1: { hand: ['Test Slow Letter'] }, defs: [LETTER] });
    let s = castWithTargets(s0, 'Test Slow Letter');
    s = passBoth(s);
    const after = hand(s);
    s = toStep(s, 'end');
    expect(hand(s)).toBe(after);
    while (!(s.turn.number === 2 && s.turn.step === 'upkeep' && s.zones.stack.length === 0 && s.pending?.kind === 'priority' && s.log.some((l) => /delayed triggered ability/i.test(l.text)))) s = pass(s);
    s = passBoth(s);
    expect(s.turn.number).toBe(2);
    expect(hand(s)).toBe(after + 1);
  });
});

describe('CR 509.1, 509.3b, 509.3d: who "it" is in "attacks or blocks", and the shared noun phrase of "blocks or becomes blocked by"', () => {
  const BRAWLER = card('Test Brawler', 'Creature — Ogre', 'Whenever this creature attacks or blocks, it gets +1/+1 until end of turn.', ['2', '2']);
  const HOUND = card('Test Pale Hound', 'Creature — Dog', 'Whenever this creature blocks or becomes blocked by a white creature, this creature gains first strike until end of turn.', ['2', '2']);
  const BLACK = card('Test Black Raider', 'Creature — Zombie', '', ['2', '2']);

  it('CR 509.1: when it blocks, the blocker gets +1/+1, not the creature it blocks', async () => {
    const { getChars } = await import('../../../src/index');
    expect(level(BRAWLER)).toBe('full');
    const s0 = scenario([], { p1: { battlefield: ['Test Black Raider'] }, p2: { battlefield: ['Test Brawler'] }, defs: [BRAWLER, BLACK] });
    const [raider, brawler] = [find(s0, 'Test Black Raider', 'battlefield'), find(s0, 'Test Brawler', 'battlefield')];
    let s = declareAttackers(toDeclareAttackers(s0), [[raider]]);
    s = declareBlockers(toDeclareBlockers(s), [[brawler, raider]]);
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.stack.length).toBe(1);
    s = passBoth(s);
    expect(Number(getChars(s, brawler).power)).toBe(3);
    expect(Number(getChars(s, raider).power)).toBe(2);
  });

  it('CR 509.3b, 509.3d: blocking a creature that is not white does not trigger "blocks or becomes blocked by a white creature"', async () => {
    const { getChars } = await import('../../../src/index');
    expect(level(HOUND)).toBe('full');
    const s0 = scenario([], { p1: { battlefield: ['Test Black Raider'] }, p2: { battlefield: ['Test Pale Hound'] }, defs: [HOUND, BLACK] });
    const [raider, hound] = [find(s0, 'Test Black Raider', 'battlefield'), find(s0, 'Test Pale Hound', 'battlefield')];
    let s = declareAttackers(toDeclareAttackers(s0), [[raider]]);
    s = declareBlockers(toDeclareBlockers(s), [[hound, raider]]);
    expect(s.zones.stack.length).toBe(0);
    expect(getChars(s, hound).keywords.some((k) => k.keyword === 'first strike')).toBe(false);
  });
});

describe('CR 707.10f: copying the triggering spell', () => {
  it('CR 707.10f: "copy that spell" of a trigger that can see an artifact spell needs op:copy.permanentSpell (M6-2 runs it: the copy becomes a token, test/m6/copy); of instant spells only it does not', () => {
    const ART = card('Test Artifact Echo', 'Enchantment', 'Whenever you cast an artifact spell, copy that spell.');
    const INS = card('Test Instant Echo', 'Enchantment', 'Whenever you cast an instant spell, copy that spell. You may choose new targets for the copy.');
    expect(capabilitiesOf(ART.faces[0]!.abilities[0]!)).toContain('op:copy.permanentSpell');
    expect(level(ART)).toBe('full'); // M6-2 registered op:copy.permanentSpell
    expect(level(INS)).toBe('full');
  });
});

describe('CR 608.2c: "If C, you may X. If you do, Y." no longer makes the whole effect manual', () => {
  it('CR 608.2c: the damage before it stays automated; FAST5 T78: the "if you do" sentence moves into the branch of the "if" after the `may` (parser/lower/conditions.ts#foldMayInIf), so the card is fully automated', () => {
    const BOLT = card('Test Spark Raccoon', 'Instant', 'This spell deals 3 damage to any target. If you control a Forest, you may discard a card. If you do, draw a card.');
    const steps = (BOLT.faces[0]!.abilities[0] as { effect: { steps: { op: string; then?: { op: string }[] }[] } }).effect.steps;
    expect(steps.map((x) => x.op)).toEqual(['damage', 'if']);
    expect(steps[1]!.then!.map((x) => x.op)).toEqual(['may', 'if']);
    expect(JSON.stringify(BOLT.faces)).not.toContain('"op":"manual"');
    expect(level(BOLT)).toBe('full');
  });
});
