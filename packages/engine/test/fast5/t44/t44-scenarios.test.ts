/**
 * FAST5 T44: optional costs during resolution ("you may sacrifice another creature", "pay N life", "exile N cards from your graveyard", "sacrifice an artifact
 * or discard a card") with their "if you do" / "when you do" followers, played through the engine with synthetic cards (wordings invented, design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, battlefieldNames, find, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };
const kinds: string[] = [];

/** Answer the decisions that come up: targets from `targets`, object choices from `picks`, then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  const groups = [...(opts.targets ?? [])];
  const picks = [...(opts.picks ?? [])];
  const queue = [...(opts.answers ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    kinds.push(s.pending.kind);
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const cast = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}): GameState => settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), opts);
/** Cast, resolve the spell (a permanent spell), then resolve what it triggered. */
const castAndResolve = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}): GameState => {
  let s = cast(s0, name);
  s = settle(pass(pass(s)), opts);
  if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = settle(pass(pass(s)), opts);
  return s;
};
const handSize = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2'], '{1}');
const ROCK = card('Test Rock', 'Artifact', '');
const ISLE = card('Test Isle', 'Land', '');

describe('CR 118.12, 701.21a: "you may sacrifice another creature. If you do, ..." (the source is never a choice)', () => {
  const HUNTER = card('Test Hunter', 'Creature — Vampire', 'When Test Hunter enters, you may sacrifice another creature. If you do, draw two cards.', ['2', '2']);
  it('is automated', () => expect(automated(HUNTER)).toBe(true));
  it('with another creature: sacrifices it and draws two', () => {
    const s0 = scenario([], { p1: { hand: ['Test Hunter'], battlefield: ['Test Elf'] }, defs: [HUNTER, ELF] });
    const s = castAndResolve(s0, 'Test Hunter', { answers: [yes] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Hunter');
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Elf');
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Elf');
    expect(handSize(s)).toBe(2);
  });
  it('declined: nothing is sacrificed, nothing is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Hunter'], battlefield: ['Test Elf'] }, defs: [HUNTER, ELF] });
    const s = castAndResolve(s0, 'Test Hunter', { answers: [no] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Elf');
    expect(handSize(s)).toBe(0);
  });
  it('with no other creature the source itself cannot be sacrificed and there is no question (CR 118.3)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Hunter'] }, defs: [HUNTER] });
    const s = castAndResolve(s0, 'Test Hunter', { answers: [yes] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Hunter');
    expect(handSize(s)).toBe(0);
  });
});

describe('CR 118.12, 119.4: "you may pay N life" and "you may pay {M} and N life"', () => {
  const OWL = card('Test Owl', 'Creature — Bird', 'When Test Owl enters, you may pay 3 life. If you do, draw a card and put a +1/+1 counter on Test Owl.', ['1', '1']);
  const GRIM = card('Test Grim', 'Creature — Horror', 'When Test Grim enters, you may pay {1} and 2 life. If you do, you gain 5 life.', ['1', '1']);
  it('are automated', () => {
    expect(automated(OWL)).toBe(true);
    expect(automated(GRIM)).toBe(true);
  });
  it('paying the life: it is lost, then the follower does both things (draw and counter)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Owl'] }, defs: [OWL] });
    const s = castAndResolve(s0, 'Test Owl', { answers: [yes] });
    expect(life(s, 'p1')).toBe(17);
    expect(handSize(s)).toBe(1);
    expect(s.objects[find(s, 'Test Owl', 'battlefield')]!.counters['+1/+1']).toBe(1);
  });
  it('declining: no life is lost and nothing follows', () => {
    const s0 = scenario([], { p1: { hand: ['Test Owl'] }, defs: [OWL] });
    const s = castAndResolve(s0, 'Test Owl', { answers: [no] });
    expect(life(s, 'p1')).toBe(20);
    expect(handSize(s)).toBe(0);
    expect(s.objects[find(s, 'Test Owl', 'battlefield')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('a player with less life than the cost cannot pay it (CR 119.4): no question, no follower', () => {
    const s0 = scenario([], { p1: { hand: ['Test Owl'] }, defs: [OWL], life: 2 });
    const s = castAndResolve(s0, 'Test Owl', { answers: [yes] });
    expect(life(s, 'p1')).toBe(2);
    expect(handSize(s)).toBe(0);
  });
  it('mana and life together: both are paid; with no mana available the payment is not offered', () => {
    const withMana = scenario([], { p1: { hand: ['Test Grim'], battlefield: ['Plains'] }, defs: [GRIM] });
    // one Plains pays for the creature spell? it costs {0}: the Plains stays untapped for the payment
    const s = castAndResolve(withMana, 'Test Grim', { answers: [yes] });
    expect(life(s, 'p1')).toBe(20 - 2 + 5);
    expect(s.objects[find(s, 'Plains', 'battlefield', 'p1')]!.tapped).toBe(true);
    const without = scenario([], { p1: { hand: ['Test Grim'] }, defs: [GRIM] });
    const t = castAndResolve(without, 'Test Grim', { answers: [yes] });
    expect(life(t, 'p1')).toBe(20);
  });
});

describe('CR 118.12, 406.2: "you may exile N cards from your graveyard" and "you may exile a creature card from your graveyard"', () => {
  const SCULPTOR = card('Test Sculptor', 'Creature — Bird', 'At the beginning of your upkeep, you may exile two cards from your graveyard. If you do, put a +1/+1 counter on Test Sculptor.', ['1', '1']);
  const TRAWLER = card('Test Trawler', 'Creature — Human', 'When Test Trawler enters, you may exile a creature card from your graveyard. When you do, return target artifact card from your graveyard to your hand.', ['1', '1']);
  it('are automated', () => {
    expect(automated(SCULPTOR)).toBe(true);
    expect(automated(TRAWLER)).toBe(true);
  });
  it('the typed card is chosen among the creature cards only; the reflexive trigger returns the artifact', () => {
    const s0 = scenario([], { p1: { hand: ['Test Trawler'], graveyard: ['Test Elf', 'Test Rock'] }, defs: [TRAWLER, ELF, ROCK] });
    const rock = find(s0, 'Test Rock', 'graveyard', 'p1');
    let s = castAndResolve(s0, 'Test Trawler', { answers: [yes], targets: [[obj(rock)]] });
    if (s.zones.stack.length > 0) s = settle(pass(pass(s)));
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Elf']);
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Rock');
  });
  it('with no creature card in the graveyard the cost cannot be paid: the reflexive trigger never happens', () => {
    const s0 = scenario([], { p1: { hand: ['Test Trawler'], graveyard: ['Test Rock'] }, defs: [TRAWLER, ROCK] });
    const s = castAndResolve(s0, 'Test Trawler', { answers: [yes] });
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Rock']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
  });
});

describe('CR 118.12: "you may sacrifice an artifact or discard a card. If you do, ..." (one of two costs; the follower follows either)', () => {
  const VISION = card('Test Vision', 'Instant', 'You may sacrifice an artifact or discard a card. If you do, draw two cards.');
  const MIRTH = card('Test Mirth', 'Instant', 'You may sacrifice a token or a land. If you do, you gain 4 life.');
  it('are automated', () => {
    expect(automated(VISION)).toBe(true);
    expect(automated(MIRTH)).toBe(true);
  });
  it('sacrificing the artifact pays the first cost: the follower happens once', () => {
    const s0 = scenario([], { p1: { hand: ['Test Vision', 'Test Elf'], battlefield: ['Test Rock'] }, defs: [VISION, ELF, ROCK] });
    const s = settle(pass(pass(cast(s0, 'Test Vision'))), { answers: [yes] });
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Rock');
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Elf');
    expect(handSize(s)).toBe(3);
  });
  it('declining the sacrifice and discarding pays the second cost: the same follower happens once', () => {
    const s0 = scenario([], { p1: { hand: ['Test Vision', 'Test Elf'], battlefield: ['Test Rock'] }, defs: [VISION, ELF, ROCK] });
    const s = settle(pass(pass(cast(s0, 'Test Vision'))), { answers: [no, yes] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Rock');
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Elf');
    expect(handSize(s)).toBe(2);
  });
  it('declining both: nothing is paid and nothing follows', () => {
    const s0 = scenario([], { p1: { hand: ['Test Vision', 'Test Elf'], battlefield: ['Test Rock'] }, defs: [VISION, ELF, ROCK] });
    const s = settle(pass(pass(cast(s0, 'Test Vision'))), { answers: [no, no] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Rock');
    expect(handSize(s)).toBe(1);
  });
  it('with no artifact only the discard is offered (CR 118.3); with no card either, nothing', () => {
    const noRock = scenario([], { p1: { hand: ['Test Vision', 'Test Elf'] }, defs: [VISION, ELF] });
    const s = settle(pass(pass(cast(noRock, 'Test Vision'))), { answers: [yes] });
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Elf');
    expect(handSize(s)).toBe(2);
    const bare = scenario([], { p1: { hand: ['Test Vision'] }, defs: [VISION] });
    const t = settle(pass(pass(cast(bare, 'Test Vision'))), { answers: [yes] });
    expect(handSize(t)).toBe(0);
  });
  it('"a token or a land": a land is sacrificed, a nonland nontoken permanent is not a choice', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mirth'], battlefield: ['Test Rock', 'Test Isle'] }, defs: [MIRTH, ROCK, ISLE] });
    const s = settle(pass(pass(cast(s0, 'Test Mirth'))), { answers: [yes] });
    expect(battlefieldNames(s, 'p1')).toEqual(['Test Rock']);
    expect(life(s, 'p1')).toBe(24);
    const only = scenario([], { p1: { hand: ['Test Mirth'], battlefield: ['Test Rock'] }, defs: [MIRTH, ROCK] });
    const t = settle(pass(pass(cast(only, 'Test Mirth'))), { answers: [yes] });
    expect(battlefieldNames(t, 'p1')).toEqual(['Test Rock']);
    expect(life(t, 'p1')).toBe(20);
  });
});

describe('CR 118.12, 603.12: a reflexive trigger after "you may sacrifice another creature" and "scry 2, then draw a card" after "you may pay"', () => {
  const LAWBRINGER = card('Test Lawbringer', 'Creature — Vampire', 'When Test Lawbringer enters, you may sacrifice another creature. When you do, destroy target nonland permanent.', ['2', '2']);
  const CHILL = card('Test Chill', 'Enchantment', 'When Test Chill enters, you may pay {1}. If you do, scry 1, then draw a card.');
  it('are automated', () => {
    expect(automated(LAWBRINGER)).toBe(true);
    expect(automated(CHILL)).toBe(true);
  });
  it('the sacrifice puts the reflexive trigger on the stack with its own target (CR 603.12a)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Lawbringer'], battlefield: ['Test Elf'] }, p2: { battlefield: ['Test Rock'] }, defs: [LAWBRINGER, ELF, ROCK] });
    const rock = find(s0, 'Test Rock', 'battlefield', 'p2');
    let s = castAndResolve(s0, 'Test Lawbringer', { answers: [yes], targets: [[obj(rock)]] });
    if (s.zones.stack.length > 0) s = settle(pass(pass(s)));
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Elf');
    expect(battlefieldNames(s, 'p2')).not.toContain('Test Rock');
  });
  it('declined: no reflexive trigger, the target survives', () => {
    const s0 = scenario([], { p1: { hand: ['Test Lawbringer'], battlefield: ['Test Elf'] }, p2: { battlefield: ['Test Rock'] }, defs: [LAWBRINGER, ELF, ROCK] });
    const s = castAndResolve(s0, 'Test Lawbringer', { answers: [no] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Elf');
    expect(battlefieldNames(s, 'p2')).toContain('Test Rock');
  });
  it('"If you do, scry 1, then draw a card" is conditional as a whole', () => {
    const paid = scenario([], { p1: { hand: ['Test Chill'], battlefield: ['Plains'] }, defs: [CHILL] });
    const s = castAndResolve(paid, 'Test Chill', { answers: [yes], picks: [[]] });
    expect(handSize(s)).toBe(1);
    const declined = castAndResolve(paid, 'Test Chill', { answers: [no] });
    expect(handSize(declined)).toBe(0);
  });
});
