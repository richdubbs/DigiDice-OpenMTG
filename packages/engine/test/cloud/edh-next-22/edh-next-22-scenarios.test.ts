/**
 * Commander lane edh-next, round edh-next-22: the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive Rules of
 * 2026-09-25 (see the round's record).
 *
 *   CR 614.12, 707.2, 707.5         "You may have ~ enter as a copy of any creature card in a graveyard." (Body Double)
 *   CR 614.12, 707.2, 400.7         "You may have ~ enter as a copy of any permanent that entered this turn." (Sakashima's Protege)
 *   CR 614.12, 707.9a, 603.6a       "You may have ~ enter tapped as a copy of any creature on the battlefield, except it has "When this creature enters, ..."" (Callidus Assassin)
 *   CR 401.2, 406.3, 609.4b         "... look at the top card of their library, then exile it face down. For as long as it remains exiled, you may play it, and mana of any type can be spent to cast that spell." (Dream-Thief's Bandana)
 *   CR 701.23a, 205.4a, 202.3       "You may search your library for a nonlegendary green creature card with mana value 3 or less, put it onto the battlefield, then shuffle." (Woodland Bellower)
 *   CR 102.3, 608.2h, 701.23a       "Search your library for up to X Plains cards, where X is the number of players who control more lands than you." (Oreskos Explorer)
 *   CR 708.2, 111.1, 603.10a        "Until end of turn, face-up nontoken creatures you control gain "When this creature dies, manifest the top card of your library."" (Whisperwood Elemental)
 *   CR 614.15, 701.20e, 601.2a      "... If this spell was cast from anywhere other than your hand, put each of those cards into your hand instead." (See the Truth)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, findAll, legal, pass, put, scenario } from '../../m3/scenario';
import { attackUnblocked } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const chars = (s: GameState, id: ObjectId) => getChars(s, id)!;
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });

interface Picks {
  yes?: boolean;
  pick?: (options: ObjectId[], s: GameState) => ObjectId[];
  targets?: TargetChoice[][];
  /** Each time a `chooseObjects` decision is asked, the options are recorded here. */
  seen?: ObjectId[][];
  /** The card names of those options, read when the decision is asked. */
  names?: string[];
}
/** Answer every decision until a player has priority: yes/no by `yes`, objects by `pick`, targets in order from `targets`, mana automatically. */
function drive(s0: GameState, o: Picks = {}): GameState {
  let s = s0;
  const tq = [...(o.targets ?? [])];
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number; max?: number };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') {
      o.seen?.push([...(p.options ?? [])]);
      for (const id of p.options ?? []) o.names?.push(s.defs[s.objects[id]!.defId]?.name ?? '');
      s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options!, s) : p.options!.slice(0, Math.max(p.min ?? 0, 1)).slice(0, p.max) });
    } else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: tq.shift() ?? [] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as unknown as { items: { id: string }[] }).items.map((i) => i.id) } as DecisionAnswer);
    else throw new Error(`unexpected decision ${JSON.stringify(s.pending)}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Picks = {}): GameState {
  let s = drive(s0, o);
  for (let guard = 0; guard < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, o);
  return s;
}
/** Cast the card `name` from p1's hand, paying with `mana` put in the pool, and resolve everything. */
function castAndResolve(s0: GameState, name: string, o: Picks = {}, mana: string[] = []): GameState {
  for (const m of mana) s0.players[0]!.manaPool.push({ type: m } as never);
  return resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o);
}
const onBf = (s: GameState, defId: string, controller: 'p1' | 'p2'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === controller && s.objects[id]!.defId === defId);
const pickName = (name: string) => (options: ObjectId[], s: GameState): ObjectId[] => [options.find((id) => s.defs[s.objects[id]!.defId]?.name === name) ?? options[0]!];

describe('CR 614.12, 707.2, 707.5: "You may have ~ enter as a copy of any creature card in a graveyard."', () => {
  const TWIN = card('Test Body Twin', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature card in a graveyard.', { pt: ['0', '0'], cost: '{0}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const GIANT = card('Test Giant', 'Creature — Giant', 'Trample', { pt: ['4', '4'] });
  const RELIC = card('Test Relic', 'Artifact', '');
  const defs = [TWIN, BEAR, GIANT, RELIC];
  it('is automated', () => expect(full(TWIN)).toBe(true));
  it("enters as a copy of a creature card in an opponent's graveyard: its name, power, toughness and abilities, and the card stays in the graveyard", () => {
    const s0 = scenario([], { p1: { hand: ['Test Body Twin'] }, p2: { graveyard: ['Test Giant'] }, defs });
    const r = castAndResolve(s0, 'Test Body Twin', { yes: true });
    const twin = r.zones.battlefield.find((id) => r.objects[id]!.defId === 'Test Body Twin')!;
    expect(chars(r, twin).name).toBe('Test Giant');
    expect([Number(chars(r, twin).power), Number(chars(r, twin).toughness)]).toEqual([4, 4]);
    expect(chars(r, twin).keywords.map((k) => k.keyword)).toContain('trample');
    expect(findAll(r, 'Test Giant', 'graveyard', 'p2')).toHaveLength(1);
  });
  it('negative: only creature cards in a graveyard are choices (an artifact card is not); declining or no creature card leaves the card itself, 0/0', () => {
    const seen: ObjectId[][] = [];
    const s0 = scenario([], { p1: { hand: ['Test Body Twin'], graveyard: ['Test Relic'] }, p2: { graveyard: ['Test Bear', 'Test Relic'] }, defs });
    const r = castAndResolve(s0, 'Test Body Twin', { yes: true, seen });
    const twin = r.zones.battlefield.find((id) => r.objects[id]!.defId === 'Test Body Twin')!;
    expect(chars(r, twin).name).toBe('Test Bear');
    expect(seen.every((o) => o.every((id) => chars(r, id).types.includes('Creature')))).toBe(true);
    const s1 = scenario([], { p1: { hand: ['Test Body Twin'], graveyard: ['Test Relic'] }, defs });
    const r1 = castAndResolve(s1, 'Test Body Twin', { yes: true });
    expect(r1.zones.battlefield.some((id) => r1.objects[id]!.defId === 'Test Body Twin')).toBe(false); // a 0/0 dies as a state-based action (CR 704.5f)
    const s2 = scenario([], { p1: { hand: ['Test Body Twin'] }, p2: { graveyard: ['Test Bear'] }, defs });
    const r2 = castAndResolve(s2, 'Test Body Twin', { pick: () => [] });
    expect(r2.zones.battlefield.some((id) => r2.objects[id]!.defId === 'Test Body Twin')).toBe(false); // declined: still the 0/0 card
  });
});

describe('CR 614.12, 707.2, 400.7: "You may have ~ enter as a copy of any permanent that entered this turn."', () => {
  const PROTEGE = card('Test Quick Twin', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any permanent that entered this turn.', { pt: ['0', '0'], cost: '{0}' });
  const OLD = card('Test Old Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const NEW = card('Test New Giant', 'Creature — Giant', '', { pt: ['4', '4'], cost: '{0}' });
  const defs = [PROTEGE, OLD, NEW];
  it('is automated', () => expect(full(PROTEGE)).toBe(true));
  it('copies a permanent that entered this turn; a permanent that was already there is not a choice', () => {
    const seen: ObjectId[][] = [];
    const s0 = scenario([], { p1: { hand: ['Test New Giant', 'Test Quick Twin'] }, p2: { battlefield: ['Test Old Bear'] }, defs });
    const s1 = castAndResolve(s0, 'Test New Giant');
    const giant = s1.zones.battlefield.find((id) => s1.objects[id]!.defId === 'Test New Giant')!;
    const r = castAndResolve(s1, 'Test Quick Twin', { yes: true, seen });
    const twin = r.zones.battlefield.find((id) => r.objects[id]!.defId === 'Test Quick Twin')!;
    expect(chars(r, twin).name).toBe('Test New Giant');
    expect(seen.flat()).toContain(giant);
    expect(seen.flat().some((id) => chars(r, id).name === 'Test Old Bear')).toBe(false);
  });
  it('negative: with nothing that entered this turn there is no choice, and the 0/0 card dies', () => {
    const s0 = scenario([], { p1: { hand: ['Test Quick Twin'] }, p2: { battlefield: ['Test Old Bear'] }, defs });
    const r = castAndResolve(s0, 'Test Quick Twin', { yes: true });
    expect(r.zones.battlefield.some((id) => r.objects[id]!.defId === 'Test Quick Twin')).toBe(false);
  });
});

describe('CR 614.12, 707.9a, 603.6a: "You may have ~ enter tapped as a copy of any creature on the battlefield, except it has "When this creature enters, destroy up to one other target creature with the same name as this creature.""', () => {
  const ASSASSIN = card('Test Poly Assassin', 'Creature — Shapeshifter', 'You may have this creature enter tapped as a copy of any creature on the battlefield, except it has "When this creature enters, destroy up to one other target creature with the same name as this creature."', { pt: ['1', '1'], cost: '{0}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['3', '3'] });
  const defs = [ASSASSIN, BEAR, WOLF];
  it('is automated', () => expect(full(ASSASSIN)).toBe(true));
  it('enters tapped as a copy of the Bear and its copied trigger destroys another Bear (not the Wolf, not itself)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Poly Assassin'] }, p2: { battlefield: ['Test Bear', 'Test Wolf'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const wolf = find(s0, 'Test Wolf', 'battlefield', 'p2');
    const r = castAndResolve(s0, 'Test Poly Assassin', { yes: true, pick: pickName('Test Bear'), targets: [[obj(bear)]] });
    const copy = r.zones.battlefield.find((id) => r.objects[id]!.defId === 'Test Poly Assassin')!;
    expect(chars(r, copy).name).toBe('Test Bear');
    expect(r.objects[copy]!.tapped).toBe(true);
    expect(r.zones.battlefield).not.toContain(bear);
    expect(r.zones.battlefield).toContain(wolf);
  });
  it('negative: declining the copy leaves an untapped 1/1 Test Poly Assassin and nothing is destroyed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Poly Assassin'] }, p2: { battlefield: ['Test Bear'] }, defs });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const r = castAndResolve(s0, 'Test Poly Assassin', { pick: () => [] });
    const me = r.zones.battlefield.find((id) => r.objects[id]!.defId === 'Test Poly Assassin')!;
    expect(chars(r, me).name).toBe('Test Poly Assassin');
    expect(r.objects[me]!.tapped).toBe(false);
    expect(r.zones.battlefield).toContain(bear);
  });
});

describe('CR 401.2, 406.3, 609.4b: "Whenever ~ deals combat damage to a player, look at the top card of their library, then exile it face down. For as long as it remains exiled, you may play it, and mana of any type can be spent to cast that spell."', () => {
  const THIEF = card('Test Dream Thief', 'Creature — Rogue', "Whenever this creature deals combat damage to a player, look at the top card of their library, then exile it face down. For as long as it remains exiled, you may play it, and mana of any type can be spent to cast that spell.", { pt: ['2', '2'] });
  const PRIZE = card('Test Red Prize', 'Instant', 'You gain 3 life.', { cost: '{R}', colors: ['R'] });
  const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.', { cost: '{G}', colors: ['G'] });
  const defs = [THIEF, PRIZE, FILLER];
  const play = (): GameState => {
    const s0 = scenario([], { p1: { battlefield: ['Test Dream Thief'] }, p2: { library: ['Test Red Prize', 'Test Filler'] }, defs });
    return drive(attackUnblocked(s0, [find(s0, 'Test Dream Thief', 'battlefield', 'p1')]), { yes: true });
  };
  it('is automated', () => expect(full(THIEF)).toBe(true));
  it("exiles the defending player's top card face down (not your own library's) and lets you cast it with mana of another type", () => {
    const s = play();
    const exiled = s.zones.exile.filter((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Red Prize');
    expect(exiled).toHaveLength(1);
    expect(s.objects[exiled[0]!]!.faceDown).toBe(true);
    expect(s.zones.library.p2!.some((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Filler')).toBe(true);
    // any type of mana pays for the red spell: one green mana
    s.players[0]!.manaPool.push({ type: 'G' } as never);
    const castable = legal(s, 'p1', 'cast').some((a) => a.object === exiled[0]);
    expect(castable).toBe(true);
  });
  it('negative: the exiled card is not castable by the opponent, and without the permission red mana is still needed (a plain card in hand is not helped)', () => {
    const s = play();
    const exiled = s.zones.exile.filter((id) => s.defs[s.objects[id]!.defId]?.name === 'Test Red Prize')[0]!;
    expect(legal(s, 'p2', 'cast').some((a) => a.object === exiled)).toBe(false);
    const s2 = scenario([], { p1: { hand: ['Test Red Prize'] }, defs });
    s2.players[0]!.manaPool.push({ type: 'G' } as never);
    expect(legal(s2, 'p1', 'cast').some((a) => a.object === find(s2, 'Test Red Prize', 'hand', 'p1'))).toBe(false);
  });
});

describe('CR 701.23a, 205.4a, 202.3: "When this creature enters, you may search your library for a nonlegendary green creature card with mana value 3 or less, put it onto the battlefield, then shuffle."', () => {
  const BELLOWER = card('Test Bellower', 'Creature — Beast', 'When this creature enters, you may search your library for a nonlegendary green creature card with mana value 3 or less, put it onto the battlefield, then shuffle.', { pt: ['4', '4'], cost: '{0}', colors: ['G'] });
  const SPROUT = card('Test Sprout', 'Creature — Plant', '', { pt: ['1', '1'], cost: '{G}', colors: ['G'] });
  const KING = card('Test Sprout King', 'Legendary Creature — Plant', '', { pt: ['1', '1'], cost: '{G}', colors: ['G'] });
  const BLUE = card('Test Blue Sprout', 'Creature — Plant', '', { pt: ['1', '1'], cost: '{U}', colors: ['U'] });
  const BIG = card('Test Big Sprout', 'Creature — Plant', '', { pt: ['5', '5'], cost: '{3}{G}', colors: ['G'] });
  const defs = [BELLOWER, SPROUT, KING, BLUE, BIG];
  it('is automated', () => expect(full(BELLOWER)).toBe(true));
  it('may fetch only a green, nonlegendary creature card with mana value 3 or less: the others in the library are not options', () => {
    const names: string[] = [];
    const s0 = scenario([], { p1: { hand: ['Test Bellower'], library: ['Test Sprout King', 'Test Blue Sprout', 'Test Big Sprout', 'Test Sprout'] }, defs });
    const r = castAndResolve(s0, 'Test Bellower', { yes: true, names });
    expect(onBf(r, 'Test Sprout', 'p1')).toHaveLength(1);
    const options = names;
    expect(options).toContain('Test Sprout');
    for (const n of ['Test Sprout King', 'Test Blue Sprout', 'Test Big Sprout']) expect(options).not.toContain(n);
  });
  it('negative: declining the search leaves the library as it is', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bellower'], library: ['Test Sprout'] }, defs });
    const r = castAndResolve(s0, 'Test Bellower', { pick: () => [], yes: false });
    expect(onBf(r, 'Test Sprout', 'p1')).toHaveLength(0);
  });
});

describe('CR 102.3, 608.2h, 701.23a: "When this creature enters, search your library for up to X Plains cards, where X is the number of players who control more lands than you."', () => {
  const EXPLORER = card('Test Land Scout', 'Creature — Scout', 'When this creature enters, search your library for up to X Plains cards, where X is the number of players who control more lands than you. Reveal those cards, put them into your hand, then shuffle.', { pt: ['2', '2'], cost: '{0}' });
  const defs = [EXPLORER];
  const handNames = (s: GameState): string[] => s.zones.hand.p1!.map((id) => s.defs[s.objects[id]!.defId]!.name);
  it('is automated', () => expect(full(EXPLORER)).toBe(true));
  it('counts each player who controls more lands than you, once (not a player with the same number or fewer)', () => {
    // p1 controls 1 Plains; p2 controls 3 (more): X = 1
    const s0 = scenario([], { p1: { hand: ['Test Land Scout'], battlefield: ['Plains'], library: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Plains', 'Plains', 'Plains'] }, defs });
    const r = castAndResolve(s0, 'Test Land Scout', { yes: true, pick: (o) => o.slice(0, 1) });
    expect(handNames(r).filter((n) => n === 'Plains')).toHaveLength(1);
    // equal lands: X = 0
    const s1 = scenario([], { p1: { hand: ['Test Land Scout'], battlefield: ['Plains', 'Plains'], library: ['Plains', 'Plains'] }, p2: { battlefield: ['Plains', 'Plains'] }, defs });
    const r1 = castAndResolve(s1, 'Test Land Scout', { yes: true, pick: () => [] });
    expect(handNames(r1).filter((n) => n === 'Plains')).toHaveLength(0);
  });
});

describe('CR 708.2, 111.1, 603.10a: "Sacrifice ~: Until end of turn, face-up nontoken creatures you control gain "When this creature dies, manifest the top card of your library.""', () => {
  const ELEMENTAL = card('Test Manifest Spirit', 'Creature — Elemental', 'Sacrifice this creature: Until end of turn, face-up nontoken creatures you control gain "When this creature dies, manifest the top card of your library."', { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const SHAMAN = card('Test Shaman', 'Creature — Shaman', 'Create a 1/1 token.', { pt: ['1', '1'] });
  const KILL = card('Test Kill Spell', 'Instant', 'Destroy target creature.', { cost: '{0}' });
  const defs = [ELEMENTAL, BEAR, SHAMAN, KILL];
  const count = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1').length;
  it('is automated', () => expect(full(ELEMENTAL)).toBe(true));
  it('a face-up nontoken creature that dies afterwards manifests the top card; the creature that was sacrificed to pay does not (it had left)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Manifest Spirit', 'Test Bear'], hand: ['Test Kill Spell'] }, defs });
    const spirit = find(s0, 'Test Manifest Spirit', 'battlefield', 'p1');
    let s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: spirit, ability: 'p:0:0' } as never), { yes: true });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    const before = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown === true).length;
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kill Spell', 'hand', 'p1') }), { targets: [[obj(bear)]] });
    expect(s.zones.battlefield).not.toContain(bear);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.faceDown === true).length).toBe(before + 1);
  });
  it('negative: a creature that entered after the ability resolved is not given the trigger (the set is fixed as it resolves, CR 611.2c)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Manifest Spirit'], hand: ['Test Kill Spell'] }, defs });
    const spirit = find(s0, 'Test Manifest Spirit', 'battlefield', 'p1');
    let s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: spirit, ability: 'p:0:0' } as never), { yes: true });
    const late = put(s, 'p1', 'battlefield', 'Test Bear');
    const before = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown === true).length;
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kill Spell', 'hand', 'p1') }), { targets: [[obj(late)]] });
    expect(s.zones.battlefield).not.toContain(late);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.faceDown === true).length).toBe(before);
    void count;
  });
});

describe('CR 614.15, 701.20e, 601.2a: "Look at the top three cards of your library. Put one of those cards into your hand and the rest on the bottom of your library in any order. If this spell was cast from anywhere other than your hand, put each of those cards into your hand instead."', () => {
  const TRUTH = card('Test Glimpse', 'Sorcery', 'Look at the top three cards of your library. Put one of those cards into your hand and the rest on the bottom of your library in any order. If this spell was cast from anywhere other than your hand, put each of those cards into your hand instead.', { cost: '{0}' });
  const A = card('Test Card A', 'Artifact', '');
  const B = card('Test Card B', 'Artifact', '');
  const C = card('Test Card C', 'Artifact', '');
  const defs = [TRUTH, A, B, C];
  const hand = (s: GameState): string[] => s.zones.hand.p1!.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
  it('is automated', () => expect(full(TRUTH)).toBe(true));
  it('cast from your hand: one of the three goes to your hand and the other two to the bottom', () => {
    const s0 = scenario([], { p1: { hand: ['Test Glimpse'], library: ['Test Card A', 'Test Card B', 'Test Card C'] }, defs });
    const r = castAndResolve(s0, 'Test Glimpse', { pick: (o) => [o[0]!] });
    expect(hand(r)).toHaveLength(1);
    expect(hand(r)[0]).toMatch(/^Test Card /);
  });
  it('cast from your graveyard (flashback): each of the three goes to your hand', () => {
    const FLASH = card('Test Glimpse Again', 'Sorcery', 'Look at the top three cards of your library. Put one of those cards into your hand and the rest on the bottom of your library in any order. If this spell was cast from anywhere other than your hand, put each of those cards into your hand instead.\nFlashback {0}', { cost: '{0}' });
    expect(full(FLASH)).toBe(true);
    const s0 = scenario([], { p1: { graveyard: ['Test Glimpse Again'], library: ['Test Card A', 'Test Card B', 'Test Card C'] }, defs: [FLASH, A, B, C] });
    const cast = legal(s0, 'p1', 'cast').find((a) => a.object === find(s0, 'Test Glimpse Again', 'graveyard', 'p1'));
    expect(cast).toBeDefined();
    const r = resolveAll(act(s0, cast!.action), {});
    expect(hand(r)).toEqual(['Test Card A', 'Test Card B', 'Test Card C']);
  });
});

describe('CR 111.1, 708.2, 611.2c: Whisperwood negative cases (token and face-down creatures)', () => {
  const ELEMENTAL = card('Test Manifest Spirit', 'Creature — Elemental', 'Sacrifice this creature: Until end of turn, face-up nontoken creatures you control gain "When this creature dies, manifest the top card of your library."', { pt: ['1', '1'] });
  const MAKER = card('Test Token Maker', 'Creature — Shaman', '{0}: Create a 1/1 white Soldier creature token.', { pt: ['1', '1'] });
  const KILL = card('Test Kill Spell', 'Instant', 'Destroy target creature.', { cost: '{0}' });
  it('a creature token that exists when the ability resolves does not manifest when it dies', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Manifest Spirit', 'Test Token Maker'], hand: ['Test Kill Spell'] }, defs: [ELEMENTAL, MAKER, KILL] });
    let s = resolveAll(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Token Maker', 'battlefield', 'p1'), ability: 'p:0:0' } as never), {});
    const token = s.zones.battlefield.find((id) => s.objects[id]!.controller === 'p1' && s.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    s = resolveAll(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Manifest Spirit', 'battlefield', 'p1'), ability: 'p:0:0' } as never), { yes: true });
    const before = s.zones.battlefield.filter((id) => s.objects[id]!.faceDown === true).length;
    s = resolveAll(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kill Spell', 'hand', 'p1') }), { targets: [[obj(token)]] });
    expect(s.zones.battlefield).not.toContain(token);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.faceDown === true).length).toBe(before);
  });
});
