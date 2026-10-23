/**
 * Merge wave 8, audit D2 (docs/audits/2026-10-18-STD.md): Miasma Demon ("When this creature enters, you may discard any number of cards. When you do, up to that
 * many target creatures each get -2/-2 until end of turn.") allowed 0 to 1 targets however many cards were discarded, and it triggered after 0 discards.
 *
 *   Fault 1: "up to that many target" was read as the triggering event's amount by the target hole itself (r3-choose), around the "that many" resolver of
 *   lowering pass 5; the hole now emits the number anaphor and pass 5 resolves it by the unique-candidate rule (design 6.4) over the numbers known as the
 *   targets are chosen (CR 601.2c, 603.3d; a reflexive trigger's targets after the instructions before it, CR 603.12).
 *   Fault 2: the `may` step reported "done" as soon as the player said yes; "if you do" / "when you do" ask whether the optional action was carried out
 *   (CR 603.12, 608.2c): discarding no card is not "you do".
 *
 *   CR 603.12      a reflexive trigger triggers only if the action happened ("when you do"); its targets are chosen as it is put on the stack
 *   CR 601.2c      the number of targets is known as they are chosen: "that many" is the cards discarded
 *   CR 608.2c, 608.2d  an optional action the player chose but that did nothing was not done
 *   CR 609.3       an instruction that can't be carried out in full does as much as possible
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type ChooseTargetsDecision, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function oracle(name: string, mana_cost: string, type_line: string, oracle_text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost, type_line, oracle_text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const MIASMA = oracle('Miasma Demon', '{4}{B}{B}', 'Creature — Demon',
  'Flying\nWhen this creature enters, you may discard any number of cards. When you do, up to that many target creatures each get -2/-2 until end of turn.', ['5', '4']);
const FEAST = oracle('Heroic Feast', '{2}{G}', 'Enchantment',
  'When this enchantment enters, create a Food token. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\nWhenever you gain life, choose up to that many target creatures you control. Put a +1/+1 counter on each of them.');
const GAIN3 = oracle('Test Feast Day', '{0}', 'Sorcery', 'You gain 3 life.');
// fault 2: the "you may ... If you do / When you do" family (synthetic wordings, design 6.10)
const OFFERING = oracle('Test Offering', '{0}', 'Sorcery', 'You may sacrifice any number of creatures. If you do, draw a card.');
const TITHE = oracle('Test Tithe', '{0}', 'Sorcery', 'You may discard a card. If you do, draw two cards.');
const EXILER = oracle('Test Exiler', '{0}', 'Sorcery', 'You may exile the top two cards of your library. If you do, you gain 2 life.');
const PAYER = oracle('Test Payer', '{0}', 'Sorcery', 'You may exile two cards from your graveyard. If you do, you gain 2 life.');
const ASKER = oracle('Test Asker', '{0}', 'Sorcery', 'You may draw a card. If you do, you lose 1 life.');
const DEFS = [MIASMA, FEAST, GAIN3, OFFERING, TITHE, EXILER, PAYER, ASKER];

const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const lifeOf = (s: GameState, p = 'p1'): number => s.players.find((x) => x.id === p)!.life;
const hand = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;

/** Pay, pass and answer yes until a decision `stop` comes up, or the stack is empty with priority. */
function until(s0: GameState, stop: (s: GameState) => boolean, picks: { discard?: ObjectId[]; sacrifice?: ObjectId[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 60; guard++) {
    if (stop(s)) return s;
    const d = s.pending;
    if (!d) break;
    if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: picks.discard ?? picks.sacrifice ?? [] });
    else if (d.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return s;
}
const targetsAsked = (s: GameState): boolean => s.pending?.kind === 'chooseTargets';

function miasma(discards: number): { s: GameState; bob: ObjectId[] } {
  const s0 = scenario(['Swamp', 'Shock', 'Giant Growth', 'Lightning Bolt', 'Grizzly Bears', 'Hill Giant', 'Serra Angel'], {
    p1: { hand: ['Miasma Demon', 'Shock', 'Giant Growth', 'Lightning Bolt'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp'] },
    p2: { battlefield: ['Grizzly Bears', 'Hill Giant', 'Serra Angel'] }, defs: DEFS,
  });
  const cards = ['Shock', 'Giant Growth', 'Lightning Bolt'].slice(0, discards).map((n) => find(s0, n, 'hand'));
  const bob = ['Grizzly Bears', 'Hill Giant', 'Serra Angel'].map((n) => find(s0, n, 'battlefield'));
  const s = until(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Miasma Demon', 'hand') }), targetsAsked, { discard: cards });
  return { s, bob };
}

describe('the cards are automated', () => {
  it('every card of this file plays fully', () => {
    for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
});

describe('audit D2 fault 1: "up to that many target creatures" after "discard any number of cards. When you do" is the cards discarded (CR 603.12, 601.2c)', () => {
  it('Miasma Demon, 3 cards discarded: up to 3 targets, and each of them gets -2/-2', () => {
    const { s, bob } = miasma(3);
    expect(targetsAsked(s)).toBe(true);
    const d = s.pending as ChooseTargetsDecision;
    expect([d.min, d.max]).toEqual([0, 3]);
    const r = until(answer(s, { kind: 'chooseTargets', targets: bob.map((id) => ({ kind: 'object' as const, id })) }), () => false);
    expect(r.zones.battlefield).not.toContain(bob[0]); // Grizzly Bears 0/0
    expect(pt(r, bob[1]!)).toBe('1/1');
    expect(pt(r, bob[2]!)).toBe('2/2');
  });
  it('Miasma Demon, 1 card discarded: up to 1 target', () => {
    const { s } = miasma(1);
    expect(targetsAsked(s)).toBe(true);
    expect((s.pending as ChooseTargetsDecision).max).toBe(1);
  });
  it('Heroic Feast is unchanged: "choose up to that many target creatures you control" after gaining 3 life is up to 3 (the event amount, its one candidate)', () => {
    const s0 = scenario(['Forest', 'Grizzly Bears', 'Hill Giant', 'Serra Angel', 'Llanowar Elves'], {
      p1: { hand: ['Test Feast Day'], battlefield: ['Heroic Feast', 'Grizzly Bears', 'Hill Giant', 'Serra Angel', 'Llanowar Elves'] }, defs: DEFS,
    });
    const s = until(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Feast Day', 'hand') }), targetsAsked);
    expect(targetsAsked(s)).toBe(true);
    expect((s.pending as ChooseTargetsDecision).max).toBe(3);
  });
});

describe('audit D2 fault 2: "if you do" / "when you do" ask whether the optional action was carried out (CR 603.12, 608.2c)', () => {
  it('Miasma Demon, yes but no card discarded: no reflexive trigger at all, Bob\'s creatures are untouched', () => {
    const { s, bob } = miasma(0);
    expect(targetsAsked(s)).toBe(false);
    expect(s.zones.stack).toHaveLength(0);
    expect(s.log.some((l) => /reflexive triggered ability triggers/.test(l.text))).toBe(false);
    expect(pt(s, bob[0]!)).toBe('2/2');
  });
  it('"You may sacrifice any number of creatures. If you do, draw a card.": yes and none sacrificed draws nothing; one sacrificed draws', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: ['Test Offering'], battlefield: ['Grizzly Bears'] }, defs: DEFS });
    const none = until(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Offering', 'hand') }), () => false, { sacrifice: [] });
    expect(hand(none)).toBe(0);
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const one = until(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Offering', 'hand') }), () => false, { sacrifice: [bears] });
    expect(hand(one)).toBe(1);
  });
  it('"You may discard a card. If you do, draw two cards." with an empty hand: the discard can\'t be done, nothing is drawn', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Tithe'] }, defs: DEFS });
    const s = until(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tithe', 'hand') }), () => false);
    expect(hand(s)).toBe(0);
  });
  it('an action that only partly happens is done: "You may exile the top two cards of your library" with one card there exiles it, and "if you do" holds (CR 609.3)', () => {
    let s0 = scenario(['Plains'], { p1: { hand: ['Test Exiler'] }, defs: DEFS });
    s0 = { ...s0, zones: { ...s0.zones, library: { ...s0.zones.library, p1: s0.zones.library.p1!.slice(0, 1) } } };
    const life = lifeOf(s0);
    const s = until(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Exiler', 'hand') }), () => false);
    expect(s.zones.library.p1).toHaveLength(0);
    expect(lifeOf(s)).toBe(life + 2);
  });
  it('a cost that cannot be paid in full is not paid: "You may exile two cards from your graveyard" with one there exiles nothing and gains nothing (CR 118.3)', () => {
    const s0 = scenario(['Plains', 'Shock'], { p1: { hand: ['Test Payer'], graveyard: ['Shock'] }, defs: DEFS });
    const life = lifeOf(s0);
    const s = until(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Payer', 'hand') }), () => false);
    expect(s.zones.graveyard.p1!.some((id) => s.objects[id]!.defId === 'Shock')).toBe(true);
    expect(lifeOf(s)).toBe(life);
  });

  it('a plain yes/no still counts: "You may draw a card. If you do, you lose 1 life." (yes: draw and lose 1; no: neither)', () => {
    const s0 = scenario(['Plains'], { p1: { hand: ['Test Asker'] }, defs: DEFS });
    const life = lifeOf(s0);
    const yes = until(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Asker', 'hand') }), () => false);
    expect([hand(yes), lifeOf(yes)]).toEqual([1, life - 1]);
    let no = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Asker', 'hand') });
    for (let guard = 0; guard < 10 && no.pending?.kind !== 'yesNo'; guard++) no = no.pending?.kind === 'payCost' ? answer(no, { kind: 'payCost', auto: true }) : pass(no);
    no = until(answer(no, { kind: 'yesNo', yes: false }), () => false);
    expect([hand(no), lifeOf(no)]).toEqual([0, life]);
  });
});
