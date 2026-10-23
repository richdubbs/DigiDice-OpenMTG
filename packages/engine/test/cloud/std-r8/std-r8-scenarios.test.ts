/**
 * Standard round 8 (the render gate and antecedents): the readings the round's antecedent rules give, and the cost changes its renderer readings let through,
 * played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after
 * the rule it checks, with its negative case.
 *
 *   CR 601.2f, 107.3       "This spell costs {X} less to cast, where X is the number of artifact cards in your graveyard." (family cost-where-x)
 *   CR 205.3, 601.2f       "Elf and Goblin spells you cast cost {1} less to cast." (family subtype-list-spells)
 *   CR 109.2, 608.2c       "... exile one or more artifact cards from your graveyard. When you do, each other creature gets -X/-X ..., where X is the number of
 *                          cards exiled this way." (the graveyard cards are no antecedent of "other"; the count of the chosen cards in exile)
 *   CR 608.2c              "Then if that creature is a Goblin, put a +1/+1 counter on it." (the object the condition tests)
 *   CR 701.20a, 608.2c     "Reveal the top card of your library. If it's a land card, put it onto the battlefield tapped. Otherwise, you may put that card into
 *                          your graveyard." (the revealed card is the focus)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, legal, pass, put, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer the decisions that come up until priority (payments automatic; targets in order; other choices the first allowed, or `yes`). */
function drive(s0: GameState, targets: ObjectId[][] = [], yes = true): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, targets?: ObjectId[][], yes = true): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), targets, yes);
  return s;
}
const cast = (s: GameState, name: string, targets?: ObjectId[][], yes = true): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, yes), targets, yes);
const canCast = (s: GameState, name: string): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, name, 'hand', 'p1'));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id); return `${c.power}/${c.toughness}`; };
const plusOnes = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;

const RELIC = card('Test Relic', 'Artifact', '');
const IDOL = card('Test Idol', 'Artifact Creature — Golem', '', { pt: ['1', '1'] });

describe('CR 601.2f, 107.3: "This spell costs {X} less to cast, where X is the number of artifact cards in your graveyard." (family cost-where-x)', () => {
  const STUDY = card('Test Study', 'Sorcery', 'This spell costs {X} less to cast, where X is the number of artifact cards in your graveyard.\nDraw two cards.', { cost: '{4}' });
  it('is understood', () => expect(noManual(STUDY)).toBe(true));
  it('two artifact cards in your graveyard: castable with two lands', () => {
    const s = scenario([], { defs: [STUDY, RELIC], p1: { hand: ['Test Study'], battlefield: ['Plains', 'Plains'], graveyard: ['Test Relic', 'Test Relic'] } });
    expect(canCast(s, 'Test Study')).toBe(true);
  });
  it('one artifact card (and a land card, which is no artifact): not castable with two lands', () => {
    const s = scenario([], { defs: [STUDY, RELIC], p1: { hand: ['Test Study'], battlefield: ['Plains', 'Plains'], graveyard: ['Test Relic', 'Plains'] } });
    expect(canCast(s, 'Test Study')).toBe(false);
  });
});

describe('CR 205.3, 601.2f: "Elf and Goblin spells you cast cost {1} less to cast." (family subtype-list-spells: each spell with either subtype)', () => {
  const CHIEF = card('Test Chieftain', 'Creature — Human', 'Elf and Goblin spells you cast cost {1} less to cast.', { pt: ['1', '1'] });
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['2', '2'], cost: '{2}' });
  const ORC = card('Test Orc', 'Creature — Orc', '', { pt: ['2', '2'], cost: '{2}' });
  it('is understood', () => expect(noManual(CHIEF)).toBe(true));
  it('an Elf spell costs {1} less: castable with one land; an Orc spell is not', () => {
    const s = scenario([], { defs: [CHIEF, ELF, ORC], p1: { hand: ['Test Elf', 'Test Orc'], battlefield: ['Test Chieftain', 'Plains'] } });
    expect(canCast(s, 'Test Elf')).toBe(true);
    expect(canCast(s, 'Test Orc')).toBe(false);
  });
});

describe('CR 109.2, 400.1, 608.2c: "each other creature" after an exile of graveyard cards; "the number of cards exiled this way" counts them in exile', () => {
  const SPECTRE = card('Test Spectre', 'Creature — Spirit', 'When this creature enters, you may exile one or more artifact cards from your graveyard. When you do, each other creature gets -X/-X until end of turn, where X is the number of cards exiled this way.', { pt: ['2', '2'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['4', '4'] });
  it('is understood', () => expect(noManual(SPECTRE)).toBe(true));
  it('two artifact cards exiled: every other creature, yours and the opponent\'s, gets -2/-2; the source is not changed', () => {
    const s0 = scenario([], { defs: [SPECTRE, BEAR, RELIC, IDOL], p1: { hand: ['Test Spectre'], battlefield: ['Test Bear'], graveyard: ['Test Relic', 'Test Idol'] }, p2: { battlefield: ['Test Bear'] } });
    const s = cast(s0, 'Test Spectre');
    expect(s.zones.graveyard.p1!.length).toBe(0);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe('2/2');
    expect(pt(s, find(s, 'Test Spectre', 'battlefield'))).toBe('2/2');
  });
  it('the option declined: nothing is exiled and no creature changes (the reflexive trigger never happens, CR 603.12)', () => {
    const s0 = scenario([], { defs: [SPECTRE, BEAR, RELIC], p1: { hand: ['Test Spectre'], graveyard: ['Test Relic'] }, p2: { battlefield: ['Test Bear'] } });
    const s = cast(s0, 'Test Spectre', [], false);
    expect(s.zones.graveyard.p1!.length).toBe(1);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe('4/4');
  });
});

describe('CR 608.2c: "Then if that creature is a Goblin, put a +1/+1 counter on it." (the object the condition tests, never the trigger\'s own object)', () => {
  const WARDEN = card('Test Warden', 'Creature — Human', 'When this creature enters, tap target creature. Then if that creature is a Goblin, put a +1/+1 counter on it.', { pt: ['2', '2'] });
  const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
  const ORC = card('Test Brute', 'Creature — Orc', '', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(WARDEN)).toBe(true));
  it('a Goblin target: it is tapped and gets the counter; the Warden gets none', () => {
    const s0 = scenario([], { defs: [WARDEN, GOBLIN], p1: { hand: ['Test Warden'] }, p2: { battlefield: ['Test Goblin'] } });
    const goblin = find(s0, 'Test Goblin', 'battlefield', 'p2');
    const s = cast(s0, 'Test Warden', [[goblin]]);
    expect(s.objects[goblin]!.tapped).toBe(true);
    expect(plusOnes(s, goblin)).toBe(1);
    expect(plusOnes(s, find(s, 'Test Warden', 'battlefield'))).toBe(0);
  });
  it('a target that is no Goblin: tapped, no counter on anything', () => {
    const s0 = scenario([], { defs: [WARDEN, ORC], p1: { hand: ['Test Warden'] }, p2: { battlefield: ['Test Brute'] } });
    const brute = find(s0, 'Test Brute', 'battlefield', 'p2');
    const s = cast(s0, 'Test Warden', [[brute]]);
    expect(s.objects[brute]!.tapped).toBe(true);
    expect(plusOnes(s, brute)).toBe(0);
    expect(plusOnes(s, find(s, 'Test Warden', 'battlefield'))).toBe(0);
  });
});

describe('CR 701.20a, 608.2c: the card revealed on top of your library is what "it" and "that card" name', () => {
  const SEER = card('Test Seer', 'Creature — Human', 'When this creature enters, reveal the top card of your library. If it\'s a land card, put it onto the battlefield tapped. Otherwise, you may put that card into your graveyard.', { pt: ['1', '1'] });
  /** Put a card of `name` on top of your library (index 0, CR 401.1). */
  const onTop = (s: GameState, name: string): ObjectId => { const id = put(s, 'p1', 'library', name); s.zones.library.p1 = [id, ...s.zones.library.p1!.filter((x) => x !== id)]; return id; };
  it('is understood', () => expect(noManual(SEER)).toBe(true));
  it('a land card on top: it enters tapped, the Seer is not moved', () => {
    const s0 = scenario([], { defs: [SEER], p1: { hand: ['Test Seer'] } });
    onTop(s0, 'Plains');
    const s = cast(s0, 'Test Seer');
    const lands = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains');
    expect(lands.length).toBe(1); // CR 400.7: a new object on the battlefield
    expect(s.objects[lands[0]!]!.tapped).toBe(true);
    expect(s.objects[find(s, 'Test Seer', 'battlefield')]!.zone).toBe('battlefield');
  });
  it('a nonland card on top: with "yes" it goes to the graveyard, and no land is put onto the battlefield', () => {
    const s0 = scenario([], { defs: [SEER, RELIC], p1: { hand: ['Test Seer'] } });
    onTop(s0, 'Test Relic');
    const s = cast(s0, 'Test Seer');
    expect(s.zones.graveyard.p1!.map((id) => s.objects[id]!.defId)).toEqual(['Test Relic']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains').length).toBe(0);
  });
});
