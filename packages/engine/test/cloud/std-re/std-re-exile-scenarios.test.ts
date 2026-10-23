/**
 * Standard round E (std-re): the readings the round's renderer and parser changes let through, played through the engine with synthetic cards compiled by the
 * game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks, with its negative case.
 *
 *   CR 608.2c, 107.3     "You may discard your hand. Draw X cards, where X is the number of cards discarded this way. ~ deals X damage to each opponent." (the count
 *                        of what the discard moved, the same X both times; none when the option is declined)
 *   CR 205.3m, 607.2d    "As ~ enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk." and "a permanent you control of the chosen type"
 *   CR 701.17a, 715.1    "Mill four cards. Then put all cards that have an Adventure from among the milled cards into your hand." (the milled cards only)
 *   CR 607.2a, 608.2g    "Whenever this creature attacks, you may cast an Ally spell from among cards you own exiled with this creature." (the cards its other ability
 *                        exiled; one card you own, cast paying its costs)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, life, pass, put, scenario, zoneNames } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** The option lists of the name choices asked so far (CR 607.2d: a closed list). */
const names: string[][] = [];

/** Answer the decisions that come up until priority (payments automatic; targets in order; option `pick` (else the first allowed), or `yes`). */
function drive(s0: GameState, targets: ObjectId[][] = [], yes = true, pick?: string): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: (q.shift() ?? []).map((id) => ({ kind: 'object' as const, id })) });
    else if (p.kind === 'chooseOption') {
      const want = pick === undefined ? undefined : p.options.find((o) => JSON.stringify(o).includes(pick));
      s = answer(s, { kind: 'chooseOption', ids: want ? [want.id] : p.options.slice(0, p.min).map((o) => o.id) });
    } else if (p.kind === 'chooseName') {
      names.push(p.options ?? []);
      s = answer(s, { kind: 'chooseName', name: pick ?? p.options?.[0] ?? 'Bear' });
    } else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.max) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, yes = true, pick?: string): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), [], yes, pick);
  return s;
}
const cast = (s: GameState, name: string, yes = true, pick?: string): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), [], yes, pick), yes, pick);

const FILLER = card('Test Pebble', 'Artifact', '');

describe('CR 608.2c, 107.3: "Draw X cards, where X is the number of cards discarded this way. ~ deals X damage to each opponent." (one X, the discarded count)', () => {
  const SAGE = card('Test Sage', 'Creature — Dwarf', 'When this creature enters, you may discard your hand. Draw X cards, where X is the number of cards discarded this way. This creature deals X damage to each opponent.', { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(SAGE)).toBe(true));
  it('three cards discarded: three drawn, and each opponent is dealt 3 damage', () => {
    const s0 = scenario([], { defs: [SAGE, FILLER], p1: { hand: ['Test Sage', 'Test Pebble', 'Test Pebble', 'Test Pebble'], library: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] } });
    const before = life(s0, 'p2');
    const s = cast(s0, 'Test Sage');
    expect(zoneNames(s, 'graveyard', 'p1')).toEqual(['Test Pebble', 'Test Pebble', 'Test Pebble']);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Plains', 'Plains', 'Plains']);
    expect(life(s, 'p2')).toBe(before - 3);
  });
  it('the option declined: nothing is discarded, no card drawn and no damage (X is 0, CR 107.3)', () => {
    const s0 = scenario([], { defs: [SAGE, FILLER], p1: { hand: ['Test Sage', 'Test Pebble', 'Test Pebble'], library: ['Plains', 'Plains', 'Plains'] } });
    const before = life(s0, 'p2');
    const s = cast(s0, 'Test Sage', false);
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Test Pebble', 'Test Pebble']);
    expect(life(s, 'p2')).toBe(before);
  });
});

describe('CR 205.3m, 607.2d: "choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk" is what "of the chosen type" reads', () => {
  const BANNER = card('Test Banner', 'Artifact', 'As this artifact enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk.\nWhenever a permanent you control of the chosen type enters, you gain 1 life.');
  const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
  const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
  it('is understood', () => expect(noManual(BANNER)).toBe(true));
  it('Elf chosen: an Elf entering gains 1 life; a Goblin entering gains none', () => {
    const s0 = scenario([], { defs: [BANNER, ELF, GOBLIN], p1: { hand: ['Test Banner', 'Test Elf', 'Test Goblin'] } });
    const start = life(s0, 'p1');
    const s1 = cast(s0, 'Test Banner', true, 'Elf');
    const s2 = cast(s1, 'Test Goblin');
    expect(life(s2, 'p1')).toBe(start);
    const s3 = cast(s2, 'Test Elf');
    expect(life(s3, 'p1')).toBe(start + 1);
  });
  it('the choice is offered among the eight printed types only (not any creature type)', () => {
    names.length = 0;
    const s0 = scenario([], { defs: [BANNER], p1: { hand: ['Test Banner'] } });
    cast(s0, 'Test Banner', true, 'Elf');
    expect(names).toEqual([['Elemental', 'Elf', 'Faerie', 'Giant', 'Goblin', 'Kithkin', 'Merfolk', 'Treefolk']]);
  });
});

describe('CR 701.17a, 715.1: "Mill four cards. Then put all cards that have an Adventure from among the milled cards into your hand."', () => {
  const SIFT = card('Test Sift', 'Sorcery', 'Mill four cards. Then put all cards that have an Adventure from among the milled cards into your hand.');
  /** Put a card of `name` on top of your library (index 0, CR 401.1). */
  const onTop = (s: GameState, name: string): ObjectId => { const id = put(s, 'p1', 'library', name); s.zones.library.p1 = [id, ...s.zones.library.p1!.filter((x) => x !== id)]; return id; };
  it('is understood', () => expect(noManual(SIFT)).toBe(true));
  it('the milled card with an Adventure goes to your hand; the other milled cards stay in the graveyard', () => {
    const s0 = scenario(['Bonecrusher Giant // Stomp'], { defs: [SIFT, FILLER], p1: { hand: ['Test Sift'] } });
    onTop(s0, 'Test Pebble');
    onTop(s0, 'Bonecrusher Giant // Stomp');
    const s = cast(s0, 'Test Sift');
    expect(zoneNames(s, 'hand', 'p1')).toEqual(['Bonecrusher Giant // Stomp']);
    expect(zoneNames(s, 'graveyard', 'p1').sort()).toEqual(['Plains', 'Plains', 'Test Pebble', 'Test Sift']);
  });
  it('a card with an Adventure that was already in the graveyard, not milled, stays there (only "the milled cards", CR 608.2c)', () => {
    const s0 = scenario(['Bonecrusher Giant // Stomp'], { defs: [SIFT, FILLER], p1: { hand: ['Test Sift'], graveyard: ['Bonecrusher Giant // Stomp'] } });
    onTop(s0, 'Test Pebble');
    const s = cast(s0, 'Test Sift');
    expect(zoneNames(s, 'hand', 'p1')).toEqual([]);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Bonecrusher Giant // Stomp');
  });
});

describe('CR 607.2a, 608.2g: "you may cast an Ally spell from among cards you own exiled with this creature" (eff.stdre.cast.fromLinkedExile.owned)', () => {
  const RIOTER = card('Test Rioter', 'Creature — Human Ally', 'Tap an untapped Ally you control: Exile target card from a graveyard.\nWhenever this creature attacks, you may cast an Ally spell from among cards you own exiled with this creature.', { pt: ['2', '2'] });
  const HELPER = card('Test Helper', 'Creature — Elf Ally', '', { pt: ['1', '1'] });
  const SQUIRE = card('Test Squire', 'Creature — Human Ally', '', { pt: ['1', '1'], cost: '{1}' });
  const ORC = card('Test Orc', 'Creature — Orc', '', { pt: ['1', '1'], cost: '{1}' });
  /** Answer what comes up until priority: the cost's Ally to tap and the cast choice pick `pick` when offered, targets `target`, yes to the cast, payments automatic. */
  function settle(s0: GameState, o: { pick?: ObjectId; target?: ObjectId; offered?: ObjectId[][] }): GameState {
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: o.target ? [{ kind: 'object', id: o.target }] : [] });
      else if (p.kind === 'chooseObjects') {
        o.offered?.push([...p.options]);
        s = answer(s, { kind: 'chooseObjects', ids: o.pick !== undefined && p.options.includes(o.pick) ? [o.pick] : p.options.slice(0, p.min) });
      } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return s;
  }
  const drain = (s0: GameState, o: Parameters<typeof settle>[1]): GameState => {
    let s = s0;
    for (let i = 0; i < 12 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), o);
    return s;
  };
  /** Exile `card` (in `owner`'s graveyard) with the Rioter's first ability, tapping the Helper for its cost; then attack with the Rioter. */
  function exileThenAttack(owner: 'p1' | 'p2', name: string, offered: ObjectId[][]): { s: GameState; exiled: ObjectId } {
    const p1 = { battlefield: ['Test Rioter', 'Test Helper', 'Plains'], ...(owner === 'p1' ? { graveyard: [name] } : {}) };
    const s0 = scenario([], { defs: [RIOTER, HELPER, SQUIRE, ORC], p1, ...(owner === 'p2' ? { p2: { graveyard: [name] } } : {}) });
    const helper = find(s0, 'Test Helper', 'battlefield', 'p1');
    const target = find(s0, name, 'graveyard', owner);
    let s = drain(settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Rioter', 'battlefield', 'p1'), ability: 'p:0:0' }), { pick: helper, target }), { pick: helper, target });
    const exiled = s.zones.exile.find((id) => s.objects[id]!.defId === name)!;
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Rioter', 'battlefield', 'p1')]]);
    s = drain(settle(s, { pick: exiled, offered }), { pick: exiled, offered });
    return { s, exiled };
  }
  it('is understood', () => expect(noManual(RIOTER)).toBe(true));
  it('an Ally card you own that it exiled: offered, cast paying {1}, and it enters the battlefield', () => {
    const offered: ObjectId[][] = [];
    const { s, exiled } = exileThenAttack('p1', 'Test Squire', offered);
    expect(offered).toContainEqual([exiled]);
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId)).toContain('Test Squire');
    expect(s.zones.exile).toHaveLength(0);
  });
  it('an Ally card an opponent owns: never offered, it stays in exile (only "cards you own")', () => {
    const offered: ObjectId[][] = [];
    const { s } = exileThenAttack('p2', 'Test Squire', offered);
    expect(offered.flat()).toEqual([]);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Squire']);
  });
  it('a card that is no Ally: never offered, it stays in exile', () => {
    const offered: ObjectId[][] = [];
    const { s } = exileThenAttack('p1', 'Test Orc', offered);
    expect(offered.flat()).toEqual([]);
    expect(s.zones.exile.map((id) => s.objects[id]!.defId)).toEqual(['Test Orc']);
  });
});
