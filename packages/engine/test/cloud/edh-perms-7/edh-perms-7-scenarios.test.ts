/**
 * Commander lane edh-perms, round edh-perms-7: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * CR cites from memory, unverified (rules/cr/ is not in the cloud checkout), except where a ruling is named.
 *
 *   CR 707.9b, 205.1a, 702.122a   "enter as a copy of a creature an opponent controls, except it's a Vehicle artifact with crew 3 and it loses all other card types" (the copy is no creature)
 *   CR 707.9f, 702.63a            "except it has vanishing 3 if that creature doesn't have vanishing" (judged on the copy without the exception)
 *   CR 707.9b, 111.1, 613.4b      "create a tapped token that's a copy of that card, except it's a 4/4 black Zombie" (the discarded card, size, color and creature type set)
 *   CR 205.3m, 608.2h, 613.4c     "each creature that isn't an A, B, C, or D gets -1/-1 until end of turn for each creature you control that's an A, B, C, or D"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[]; keywords?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: opts.keywords ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const chars = (s: GameState, id: ObjectId) => getChars(s, id);
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => chars(s, id).name === name);
const stat = (s: GameState, id: ObjectId): string => `${chars(s, id).power}/${chars(s, id).toughness}`;

/** Answer every decision: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: { yes?: boolean; pick?: (options: ObjectId[], s: GameState) => ObjectId[]; targets?: ObjectId[][] } = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options, s) : p.options.slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (tq.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
const cast = (s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const FADER = card('Test Fader', 'Creature — Spirit', 'Vanishing 2', { pt: ['3', '3'], keywords: ['Vanishing'] });
const MECH = card('Test Mech', 'Artifact — Vehicle', 'You may have this Vehicle enter as a copy of a creature an opponent controls, except it\'s a Vehicle artifact with crew 3 and it loses all other card types.\nCrew 3', { pt: ['5', '5'] });
const DUPE = card('Test Dupe', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield, except it has vanishing 3 if that creature doesn\'t have vanishing.', { pt: ['0', '0'] });
const VOID = card('Test Voider', 'Sorcery', 'Discard a card.');
const GRAVEHOUND = card('Test Gravehound', 'Creature — Dog', 'Whenever you discard a creature card, you may pay {2}{U}. If you do, create a tapped token that\'s a copy of that card, except it\'s a 4/4 black Zombie.', { pt: ['1', '1'] });
const RELIC = card('Test Relic', 'Artifact', '');
const RAT = card('Test Rat', 'Creature — Rat', '', { pt: ['1', '1'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['5', '5'] });
const SHIFTER = card('Test Shifter', 'Creature — Shapeshifter', 'Changeling', { pt: ['4', '4'], keywords: ['Changeling'] });
const PLAGUE = card('Test Plague', 'Sorcery', 'Create two 1/1 green Squirrel creature tokens. Then each creature that isn\'t an Insect, Rat, Spider, or Squirrel gets -1/-1 until end of turn for each creature you control that\'s an Insect, Rat, Spider, or Squirrel.');
const defs = [BEAR, FADER, MECH, DUPE, VOID, GRAVEHOUND, RELIC, RAT, OGRE, SHIFTER, PLAGUE];

describe('CR 707.9b, 205.1a, 702.122a: "enter as a copy of a creature an opponent controls, except it\'s a Vehicle artifact with crew 3 and it loses all other card types"', () => {
  it('is fully automated', () => expect(full(MECH)).toBe(true));
  it('it enters as a copy of the opponent\'s Bear: the Bear\'s name and size, an artifact Vehicle only (no creature, no Bear), with crew 3', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Mech'] }, p2: { battlefield: ['Test Bear'] } }), 'Test Mech');
    const copies = onField(s, 'Test Bear');
    expect(copies.length).toBe(2);
    const mech = copies.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Mech')!;
    const c = chars(s, mech);
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).toEqual(['Vehicle']);
    expect([c.power, c.toughness]).toEqual(['2', '2']);
    expect(c.keywords.some((k) => k.keyword === 'crew' && k.amount === 3)).toBe(true);
    expect(s.objects[mech]!.controller).toBe('p1');
    expect(chars(s, onField(s, 'Test Bear').find((id) => id !== mech)!).types).toEqual(['Creature']); // the original is untouched
  });
  it('the negative cases: declining the copy keeps the Mech; no opposing creature (only your own) keeps the Mech too', () => {
    const declined = cast(scenario([], { defs, p1: { hand: ['Test Mech'] }, p2: { battlefield: ['Test Bear'] } }), 'Test Mech', { pick: () => [] });
    expect(onField(declined, 'Test Mech').length).toBe(1);
    expect(chars(declined, onField(declined, 'Test Mech')[0]!).types).toEqual(['Artifact']);
    const own = cast(scenario([], { defs, p1: { hand: ['Test Mech'], battlefield: ['Test Bear'] } }), 'Test Mech');
    expect(onField(own, 'Test Mech').length).toBe(1);
    expect(onField(own, 'Test Bear').length).toBe(1);
  });
});

describe('CR 707.9f, 702.63a: "enter as a copy of any creature on the battlefield, except it has vanishing 3 if that creature doesn\'t have vanishing"', () => {
  it('is fully automated', () => expect(full(DUPE)).toBe(true));
  it('a copy of a creature without vanishing gets vanishing 3', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Dupe'], battlefield: ['Test Bear'] } }), 'Test Dupe');
    const copy = onField(s, 'Test Bear').find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Dupe')!;
    expect(chars(s, copy).keywords.filter((k) => k.keyword === 'vanishing').map((k) => k.amount)).toEqual([3]);
  });
  it('the negative case: a copy of a creature that has vanishing 2 keeps that vanishing 2 and does not get a second one', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Dupe'], battlefield: ['Test Fader'] } }), 'Test Dupe');
    const copy = onField(s, 'Test Fader').find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Dupe')!;
    expect(chars(s, copy).keywords.filter((k) => k.keyword === 'vanishing').map((k) => k.amount)).toEqual([2]);
  });
  it('declining the copy leaves the Dupe a 0/0 (it dies, CR 704.5f); nothing else changes', () => {
    const s = cast(scenario([], { defs, p1: { hand: ['Test Dupe'], battlefield: ['Test Bear'] } }), 'Test Dupe', { pick: () => [] });
    expect(onField(s, 'Test Dupe').length).toBe(0);
    expect(onField(s, 'Test Bear').length).toBe(1);
  });
});

describe('CR 707.9b, 111.1, 613.4b: "Whenever you discard a creature card, you may pay {2}{U}. If you do, create a tapped token that\'s a copy of that card, except it\'s a 4/4 black Zombie."', () => {
  it('is fully automated', () => expect(full(GRAVEHOUND)).toBe(true));
  const setup = (hand: string[]) => scenario([], { defs, p1: { hand, battlefield: ['Test Gravehound'] } });
  const withMana = (s: GameState): GameState => { for (const m of ['C', 'C', 'U']) s.players[0]!.manaPool.push({ type: m } as never); return s; };
  it('discarding a creature card and paying: a tapped token copy that is a 4/4 black Zombie (the copied creature types gone)', () => {
    const s0 = withMana(setup(['Test Voider', 'Test Bear']));
    const s = cast(s0, 'Test Voider', { pick: (opts, st) => opts.filter((id) => st.defs[st.objects[id]!.defId]!.name === 'Test Bear') });
    const tokens = onField(s, 'Test Bear').filter((id) => s.objects[id]!.kind === 'token');
    expect(tokens.length).toBe(1);
    const c = chars(s, tokens[0]!);
    expect([c.power, c.toughness]).toEqual(['4', '4']);
    expect(c.colors).toEqual(['B']);
    expect(c.subtypes).toEqual(['Zombie']);
    expect(c.types).toEqual(['Creature']);
    expect(s.objects[tokens[0]!]!.tapped).toBe(true);
  });
  it('the negative cases: declining the payment makes no token; discarding a noncreature card does not trigger', () => {
    const declined = cast(withMana(setup(['Test Voider', 'Test Bear'])), 'Test Voider', { yes: false, pick: (opts, st) => opts.filter((id) => st.defs[st.objects[id]!.defId]!.name === 'Test Bear') });
    expect(onField(declined, 'Test Bear').length).toBe(0);
    const artifact = cast(withMana(setup(['Test Voider', 'Test Relic'])), 'Test Voider', { pick: (opts, st) => opts.filter((id) => st.defs[st.objects[id]!.defId]!.name === 'Test Relic') });
    expect(onField(artifact, 'Test Relic').length).toBe(0);
  });
});

describe('CR 205.3m, 608.2h, 613.4c: "Create two 1/1 Squirrel tokens. Then each creature that isn\'t an Insect, Rat, Spider, or Squirrel gets -1/-1 until end of turn for each creature you control that\'s an Insect, Rat, Spider, or Squirrel."', () => {
  it('is fully automated', () => expect(full(PLAGUE)).toBe(true));
  it('with a Rat, a Changeling (every creature type) and the two new Squirrels (four), every other creature of either player gets -4/-4; the listed types and the Changeling are untouched', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Plague'], battlefield: ['Test Rat', 'Test Ogre', 'Test Shifter'] }, p2: { battlefield: ['Test Ogre', 'Test Bear'] } });
    s = cast(s, 'Test Plague');
    const ogres = onField(s, 'Test Ogre');
    expect(ogres.map((id) => [s.objects[id]!.controller, stat(s, id)]).sort()).toEqual([['p1', '1/1'], ['p2', '1/1']]);
    expect(onField(s, 'Test Bear').length).toBe(0); // 2/2 -4/-4 dies
    expect(stat(s, onField(s, 'Test Rat')[0]!)).toBe('1/1');
    expect(stat(s, onField(s, 'Test Shifter')[0]!)).toBe('4/4');
    const squirrels = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(squirrels.length).toBe(2);
    for (const id of squirrels) expect(stat(s, id)).toBe('1/1');
  });
  it('the negative case: with no listed creature of yours other than the tokens, the count is two (a Changeling would add one more)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Plague'], battlefield: ['Test Ogre'] } });
    s = cast(s, 'Test Plague');
    expect(stat(s, onField(s, 'Test Ogre')[0]!)).toBe('3/3');
  });
});
