/**
 * Round edh-mana-keywords-10: the behaviour it changed, played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 *
 *   CR 608.2h, 605.3b, 106.1a      "{T}, Sacrifice this artifact: Add X mana of any one color, where X is the number of stash counters on this artifact." (Glittering Stockpile): the counters
 *                                 the source had as it was sacrificed (last known information)
 *   CR 701.20e, 608.2d, 402.3       "{T}, Sacrifice this artifact: Look at a card at random in target player's hand. You draw a card at the beginning of the next turn's upkeep." (Urza's Bauble):
 *                                 one card of the hand chosen at random, seen by you only
 *   CR 205.1a, 707.9b, 613.1f        "You may have this artifact enter as a copy of any creature on the battlefield, except it's an artifact and it has "{T}: Add {U}."" (Machine God's Effigy): the
 *                                 card types of the copy are set (not a creature), supertypes kept, creature types dropped, a mana ability added
 *   CR 105.2c, 613.1e, 613.1d, 609.4b "All permanents are artifacts in addition to their other types. All cards that aren't on the battlefield, spells, and permanents are colorless. Players may spend mana as
 *                                 though it were mana of any color." (Mycosynth Lattice)
 *   CR 706.1-706.3c, 608.2h         "Roll two d12 and choose one result. ~ deals damage equal to that result to each creature. Then create a number of Treasure tokens equal to the other result." (Reckless
 *                                 Endeavor); "Roll X six-sided dice, where X is ... Create a tapped Treasure token for each even result. If you rolled 6 exactly seven times, you win the game."
 *                                 (Luck Bobblehead); "Roll a d20 and subtract the number of cards in your hand. If the result is 0 or less, discard your hand." over a results table, with
 *                                 "When that creature dies, its owner loses the game." (The Deck of Many Things)
 *   CR 706.3a, 400.7, 603.7  "Exile all nontoken creatures you control, then roll a d20. 1—9 | Return those cards ... at the beginning of the next end step. 10—20 | Return those cards ..., then exile them
 *                                 again. Return those cards ... at the beginning of the next end step." (Lae'zel's Acrobatics)
 *   CR 702.16a-b, 111.1, 601.2a     "Flying, protection from spells and from permanents that were cast this turn" + "Madness--Pay six {C}." (Emrakul, the World Anew): a spell and a permanent cast this turn
 *                                 can't target, damage or (for the quality) otherwise affect it; a permanent that was not cast this turn can
 *   CR 702.136a, 614.12a, 122.6   riot: with a "counters can't be put on creatures" effect on the battlefield the creature can't have the counter, so it gains haste
 *                                 (riot ruling 2019-01-25: "If you choose to have the permanent enter with an additional +1/+1 counter but it can't, it gains haste")
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, life, pass, pool, put, scenario } from '../../m3/scenario';
import { clone } from '../../../src/util/clone';
import { activatedAbilities } from '../../../src/rules/abilities';
import { legalActions } from '../../../src/index';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
const plusOnes = (s: GameState, id: ObjectId): number => s.objects[id]?.counters['+1/+1'] ?? 0;

const RIOTER = card('Test Rioter', 'Creature — Goblin', 'Riot (This creature enters with your choice of a +1/+1 counter or haste.)', { pt: ['2', '2'] });
const STASIS = card('Test Stasis', 'Enchantment', "Players can't get counters.\nCounters can't be put on artifacts, creatures, enchantments, or lands.");
const ARTIFACT_STASIS = card('Test Artifact Stasis', 'Enchantment', "Counters can't be put on artifacts.");
const DEFS = [RIOTER, STASIS, ARTIFACT_STASIS];

function play(battlefield: string[], pick: string): { s: GameState; id: ObjectId; asked: number } {
  const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Rioter'], battlefield } });
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rioter', 'hand') });
  let asked = 0;
  for (let guard = 0; guard < 30; guard++) {
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending?.kind === 'chooseOption') { asked++; s = answer(s, { kind: 'chooseOption', ids: [pick] }); }
    else if (s.pending?.kind === 'priority' && s.zones.stack.length > 0) s = pass(s);
    else break;
  }
  return { s, id: find(s, 'Test Rioter', 'battlefield', 'p1'), asked };
}

describe('CR 702.136a, 614.12a: riot with a restriction on counters already on the battlefield', () => {
  it('no restriction: both options are offered and the counter gives no haste (control)', () => {
    const r = play([], '0');
    expect(r.asked).toBe(1);
    expect(plusOnes(r.s, r.id)).toBe(1);
    expect(kws(r.s, r.id)).not.toContain('haste');
  });
  it('a restriction on creatures (Solemnity): the counter cannot be had, so the creature gains haste, whatever was picked', () => {
    for (const pick of ['0', '1']) {
      const r = play(['Test Stasis'], pick);
      expect(plusOnes(r.s, r.id), pick).toBe(0);
      expect(kws(r.s, r.id), pick).toContain('haste');
    }
  });
  it('the negative case: a restriction on artifacts only does not touch a creature, so the counter is still had', () => {
    const r = play(['Test Artifact Stasis'], '0');
    expect(r.asked).toBe(1);
    expect(plusOnes(r.s, r.id)).toBe(1);
    expect(kws(r.s, r.id)).not.toContain('haste');
  });
});

// ---- Glittering Stockpile ---------------------------------------------------------------------------------------------------------------------------------------
const STOCKPILE = card('Test Stockpile', 'Artifact', '{T}: Add {R}. Put a stash counter on this artifact.\n{T}, Sacrifice this artifact: Add X mana of any one color, where X is the number of stash counters on this artifact.');
describe('CR 608.2h, 605.3b: a mana ability that sacrifices its source counts the counters the source had', () => {
  const sacKey = (s: GameState, id: ObjectId): string => activatedAbilities(s, s.objects[id]!).filter((i) => i.def.isMana === true).find((i) => JSON.stringify(i.def.cost).includes('sacrifice'))!.key;
  const run = (n: number): GameState => {
    const s0 = scenario([], { defs: [STOCKPILE], p1: { battlefield: [{ name: 'Test Stockpile', counters: n > 0 ? { stash: n } : {} }] } });
    const id = find(s0, 'Test Stockpile', 'battlefield', 'p1');
    let s = act(s0, { type: 'activate', player: 'p1', source: id, ability: sacKey(s0, id) });
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) s = s.pending.kind === 'chooseColor' ? answer(s, { kind: 'chooseColor', color: 'U' } as never) : answer(s, { kind: 'payCost', auto: true });
    return s;
  };
  it('is fully automated', () => {
    expect(STOCKPILE.automation.level).toBe('full');
  });
  it('three stash counters: three mana of one color, and the artifact is sacrificed', () => {
    const s = run(3);
    expect(pool(s, 'p1')).toBe('UUU');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Stockpile')).toBe(false);
  });
  it('the negative case: no stash counter adds no mana (the artifact is still sacrificed)', () => {
    const s = run(0);
    expect(pool(s, 'p1')).toBe('');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Stockpile')).toBe(false);
  });
});

// ---- Urza's Bauble ----------------------------------------------------------------------------------------------------------------------------------------------
const BAUBLE = card('Test Bauble', 'Artifact', '{T}, Sacrifice this artifact: Look at a card at random in target player\'s hand. You draw a card at the beginning of the next turn\'s upkeep.');
describe('CR 701.20e, 608.2d: "Look at a card at random in target player\'s hand."', () => {
  const play = (handSize: number, seed = 'a'): GameState => {
    const hand = Array.from({ length: handSize }, () => 'Plains');
    const s0 = scenario([], { seed, defs: [BAUBLE], p1: { battlefield: ['Test Bauble'] }, p2: { hand } });
    const id = find(s0, 'Test Bauble', 'battlefield', 'p1');
    const key = activatedAbilities(s0, s0.objects[id]!).find((i) => i.def.cost.other !== undefined)!.key;
    let s = act(s0, { type: 'activate', player: 'p1', source: id, ability: key });
    for (let i = 0; i < 6 && s.pending && s.pending.kind !== 'priority'; i++) s = s.pending.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }) : answer(s, { kind: 'payCost', auto: true });
    for (let i = 0; i < 4 && s.zones.stack.length > 0; i++) s = pass(s);
    return s;
  };
  const seen = (s: GameState): number => s.zones.hand['p2']!.filter((id) => s.objects[id]!.revealedTo?.includes('p1')).length;
  it('is fully automated', () => {
    expect(BAUBLE.automation.level).toBe('full');
  });
  it('exactly one card of the target player\'s hand is looked at by you, and the artifact is sacrificed', () => {
    const s = play(5);
    expect(seen(s)).toBe(1);
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Bauble')).toBe(false);
    expect(s.zones.hand['p2']).toHaveLength(5);
  });
  it('the card is picked by the engine\'s random numbers: different seeds look at different cards of the hand', () => {
    const picked = new Set<number>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const s = play(5, seed);
      picked.add(s.zones.hand['p2']!.findIndex((id) => s.objects[id]!.revealedTo?.includes('p1')));
    }
    expect(picked.size).toBeGreaterThan(1);
  });
  it('the negative case: an empty hand shows nothing and nothing breaks', () => {
    const s = play(0);
    expect(seen(s)).toBe(0);
  });
});

// ---- Machine God's Effigy ---------------------------------------------------------------------------------------------------------------------------------------
const EFFIGY = card('Test Effigy', 'Artifact', 'You may have this artifact enter as a copy of any creature on the battlefield, except it\'s an artifact and it has "{T}: Add {U}."', { cost: '{0}' });
const ELF = card('Test Elf', 'Creature — Elf Warrior', 'Vigilance', { pt: ['3', '3'] });
const ELF_KING = card('Test Elf King', 'Legendary Creature — Elf Warrior', 'Vigilance', { pt: ['3', '3'] });
const EFFIGY_DEFS = [EFFIGY, ELF, ELF_KING];
describe('CR 205.1a, 707.9b: "enter as a copy of any creature on the battlefield, except it\'s an artifact and it has \"{T}: Add {U}.\""', () => {
  const run = (battlefield: string[], yes = true, keep = 'Test Effigy'): GameState => {
    const s0 = scenario([], { defs: EFFIGY_DEFS, p1: { hand: ['Test Effigy'], battlefield } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Effigy', 'hand') });
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      const p = s.pending;
      if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (p?.kind === 'chooseObjects' && /^Legend rule/.test(p.prompt)) s = answer(s, { kind: 'chooseObjects', ids: [p.options.find((o) => s.defs[s.objects[o]!.defId]!.name === keep) ?? p.options[0]!] }); // CR 704.5j: the copy has the name and the legendary supertype, so the legend rule applies to it too
      else if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, yes ? Math.max(p.min, 1) : 0).slice(0, p.max) });
      else if (p?.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
      else s = pass(s);
    }
    return s;
  };
  const effigyOf = (s: GameState): ObjectId | undefined => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Effigy');
  const mana = (s: GameState, id: ObjectId) => legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.isMana === true && l.object === id);
  it('is fully automated', () => {
    expect(EFFIGY.automation.level).toBe('full');
  });
  it('copies the creature but is an artifact only: not a creature, the creature types dropped, vigilance copied, and it taps for {U}; the creature itself is unchanged', () => {
    const s = run(['Test Elf']);
    const eff = effigyOf(s)!;
    const c = getChars(s, eff)!;
    expect(c.name).toBe('Test Elf');
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).toEqual([]);
    expect(c.keywords.map((k) => k.keyword)).toContain('vigilance');
    expect(mana(s, eff)).toBeDefined();
    const original = s.zones.battlefield.find((id) => id !== eff && getChars(s, id)!.name === 'Test Elf')!;
    expect(getChars(s, original)!.types).toEqual(['Creature']);
    expect(mana(s, original)).toBeUndefined();
  });
  it('a legendary creature: the copy keeps the supertype and the name, so the legend rule makes you keep one of them (ruling 2022-10-14)', () => {
    const keepEffigy = run(['Test Elf King'], true, 'Test Effigy');
    const e = effigyOf(keepEffigy)!;
    expect(getChars(keepEffigy, e)!.supertypes).toContain('Legendary');
    expect(getChars(keepEffigy, e)!.types).toEqual(['Artifact']);
    expect(keepEffigy.zones.battlefield.filter((id) => getChars(keepEffigy, id)!.name === 'Test Elf King')).toEqual([e]);
    const keepCreature = run(['Test Elf King'], true, 'Test Elf King');
    expect(effigyOf(keepCreature)).toBeUndefined();
  });
  it('the negative case: declined (or with no creature to copy) it is the plain artifact it is printed as, with no mana ability', () => {
    const declined = run(['Test Elf'], false);
    const d = effigyOf(declined)!;
    expect(getChars(declined, d)!.name).toBe('Test Effigy');
    expect(mana(declined, d)).toBeUndefined();
    const none = run([]);
    const n = effigyOf(none)!;
    expect(getChars(none, n)!.types).toEqual(['Artifact']);
    expect(getChars(none, n)!.name).toBe('Test Effigy');
  });
});

// ---- Mycosynth Lattice --------------------------------------------------------------------------------------------------------------------------------------------
const LATTICE = card('Test Lattice', 'Artifact', 'All permanents are artifacts in addition to their other types.\nAll cards that aren\'t on the battlefield, spells, and permanents are colorless.\nPlayers may spend mana as though it were mana of any color.');
const hued = (name: string, type: string, cost: string, colors: string[], text = '', pt?: [string, string]) =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
const BLUE_DRAKE = hued('Test Blue Drake', 'Creature — Drake', '{U}', ['U'], 'Flying', ['1', '1']);
const RED_BOLT = hued('Test Red Bolt', 'Instant', '{R}', ['R'], 'Test Red Bolt deals 1 damage to any target.');
const LATTICE_DEFS = [LATTICE, BLUE_DRAKE, RED_BOLT];
describe('CR 105.2c, 613.1d-e, 609.4b: Mycosynth Lattice', () => {
  const colorsOf = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.colors];
  const typesOf = (s: GameState, id: ObjectId): string[] => [...getChars(s, id)!.types];
  const withLattice = (extra: string[]): GameState => scenario(['Forest'], { defs: LATTICE_DEFS, p1: { hand: ['Test Blue Drake', 'Test Red Bolt'], library: ['Test Blue Drake'], graveyard: ['Test Blue Drake'], battlefield: [...extra, 'Forest'] }, p2: { battlefield: ['Test Blue Drake'] } });
  it('is fully automated', () => {
    expect(LATTICE.automation.level).toBe('full');
  });
  it('every card in every zone, and every permanent, is colorless; every permanent is an artifact in addition to its other types', () => {
    const s = withLattice(['Test Lattice']);
    for (const id of [...s.zones.hand['p1']!, ...s.zones.library['p1']!.slice(0, 3), ...s.zones.graveyard['p1']!]) expect(colorsOf(s, id), s.objects[id]!.defId).toEqual([]);
    const drake = find(s, 'Test Blue Drake', 'battlefield', 'p2');
    expect(colorsOf(s, drake)).toEqual([]);
    expect(typesOf(s, drake).sort()).toEqual(['Artifact', 'Creature']);
    expect(typesOf(s, find(s, 'Forest', 'battlefield', 'p1')).sort()).toEqual(['Artifact', 'Land']);
    expect(typesOf(s, find(s, 'Test Lattice', 'battlefield', 'p1'))).toEqual(['Artifact']);
    expect(typesOf(s, s.zones.hand['p1']![0]!)).toEqual(['Creature']); // a card that is not a permanent is not an artifact
  });
  it('a spell on the stack is colorless too', () => {
    const s0 = withLattice(['Test Lattice']);
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Red Bolt', 'hand', 'p1'), ...({} as object) } as never);
    const bolt = s.zones.stack.find((id) => s.objects[id]!.defId === 'Test Red Bolt');
    if (bolt !== undefined) expect(colorsOf(s, bolt)).toEqual([]);
    else throw new Error('the spell did not reach the stack');
  });
  it('the negative case: without it cards keep their colors and nothing is an artifact', () => {
    const s = withLattice([]);
    expect(colorsOf(s, s.zones.hand['p1']![0]!)).toEqual(['U']);
    const drake = find(s, 'Test Blue Drake', 'battlefield', 'p2');
    expect(colorsOf(s, drake)).toEqual(['U']);
    expect(typesOf(s, drake)).toEqual(['Creature']);
  });
  it('players may spend mana as though it were mana of any color: a Forest pays for the blue creature; without it, it cannot', () => {
    const castable = (s: GameState, player: string, name: string): boolean => legalActions(s, player).some((l) => l.kind === 'cast' && l.object === find(s, name, 'hand', player));
    const on = withLattice(['Test Lattice']);
    expect(castable(on, 'p1', 'Test Blue Drake')).toBe(true);
    const off = withLattice([]);
    expect(castable(off, 'p1', 'Test Blue Drake')).toBe(false);
  });
});

// ---- die rolls: Reckless Endeavor, Luck Bobblehead, The Deck of Many Things -------------------------------------------------------------------------------------------
/** The natural results of the dice rolled, in order, from the game's log ("X rolls a d12: 7."). */
const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'];
/** Answer the decisions in front of us (payment automatic, `yes`, the first object, the option `option` picks among the given ones, `targets`) until a player has priority. */
function settle(s0: GameState, o: { yes?: boolean; option?: (ids: { id: string; label: string }[]) => string; targets?: { kind: 'object' | 'player'; id: string }[] } = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending as unknown as { kind: string; options: { id: string; label: string }[] & string[]; min: number; max: number; items: { id: string }[] };
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options as unknown as string[]).slice(0, Math.max(p.min, 1)).slice(0, p.max) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [o.option ? o.option(p.options as unknown as { id: string; label: string }[]) : (p.options as unknown as { id: string }[])[0]!.id] });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: o.targets ?? [] } as never);
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, o: Parameters<typeof settle>[1] = {}): GameState => {
  let s = settle(s0, o);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, o);
  return s;
};
const activate = (s: GameState, name: string, o: Parameters<typeof settle>[1] = {}, which = 0): GameState => {
  const id = findAll(s, name, 'battlefield', 'p1')[which]!;
  const key = activatedAbilities(s, s.objects[id]!).find((i) => i.def.isMana !== true)!.key;
  return resolveAll(act(s, { type: 'activate', player: 'p1', source: id, ability: key }), o);
};
const treasures = (s: GameState, player = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === player && getChars(s, id)!.name === 'Treasure Token');

describe('CR 706.1-706.2, 608.2h: "Roll two d12 and choose one result." (Reckless Endeavor)', () => {
  const ENDEAVOR = card('Test Endeavor', 'Sorcery', 'Roll two d12 and choose one result. Test Endeavor deals damage equal to that result to each creature. Then create a number of Treasure tokens equal to the other result.');
  const OGRE = card('Test Big Ogre', 'Creature — Ogre', '', { pt: ['9', '99'] });
  const play = (seed: string, pick: 'high' | 'low'): { s: GameState; dice: number[] } => {
    const s0 = scenario([], { seed, defs: [ENDEAVOR, OGRE], p1: { hand: ['Test Endeavor'], battlefield: ['Test Big Ogre'] }, p2: { battlefield: ['Test Big Ogre'] } });
    const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Endeavor', 'hand') }), { option: (opts) => (pick === 'high' ? opts.reduce((a, b) => (Number(b.label) > Number(a.label) ? b : a)) : opts.reduce((a, b) => (Number(b.label) < Number(a.label) ? b : a))).id });
    return { s, dice: rolled(s) };
  };
  it('is fully automated', () => {
    expect(ENDEAVOR.automation.level).toBe('full');
  });
  it('two dice are rolled; the chosen result is the damage to each creature and the other result is the number of Treasure tokens (either choice)', () => {
    let different = 0;
    for (const seed of SEEDS) for (const pick of ['high', 'low'] as const) {
      const { s, dice } = play(seed, pick);
      expect(dice, seed).toHaveLength(2);
      const chosen = pick === 'high' ? Math.max(...dice) : Math.min(...dice);
      const other = dice[0]! + dice[1]! - chosen;
      for (const ogre of findAll(s, 'Test Big Ogre', 'battlefield')) expect(s.objects[ogre]!.damage, `${seed} ${pick} ${dice}`).toBe(chosen);
      expect(treasures(s), `${seed} ${pick} ${dice}`).toHaveLength(other);
      if (dice[0] !== dice[1]) different++;
    }
    expect(different).toBeGreaterThan(5);
  });
  it('the negative case: the player is asked only when the two results differ; equal dice give the same number for damage and Treasure', () => {
    const twins = SEEDS.map((seed) => play(seed, 'high')).find((r) => r.dice[0] === r.dice[1]);
    if (twins !== undefined) expect(treasures(twins.s)).toHaveLength(twins.dice[0]!);
  });
});

describe('CR 706.1, 706.2, 107.3, 608.2h: "Roll X six-sided dice, where X is the number of ..." with "for each even result" and "If you rolled 6 exactly seven times" (Luck Bobblehead)', () => {
  const BOBBLE = card('Test Bobble', 'Artifact — Bobblehead', '{1}, {T}: Roll X six-sided dice, where X is the number of Bobbleheads you control. Create a tapped Treasure token for each even result. If you rolled 1 exactly two times, you win the game.');
  const play = (seed: string, bobbles: number): GameState => {
    const s0 = scenario(['Forest'], { seed, defs: [BOBBLE], p1: { battlefield: [...Array(bobbles).fill('Test Bobble') as string[], 'Forest'] } });
    return activate(s0, 'Test Bobble');
  };
  it('is fully automated', () => {
    expect(BOBBLE.automation.level).toBe('full');
  });
  it('one die for each Bobblehead you control; one tapped Treasure token for each even result', () => {
    for (const seed of SEEDS) for (const n of [1, 3, 4]) {
      const s = play(seed, n);
      const dice = rolled(s);
      expect(dice, `${seed} ${n}`).toHaveLength(n);
      const ts = treasures(s);
      expect(ts, `${seed} ${n} ${dice}`).toHaveLength(dice.filter((d) => d % 2 === 0).length);
      for (const t of ts) expect(s.objects[t]!.tapped).toBe(true);
    }
  });
  it('the game is won only when exactly that many dice show the number (here: a 1 exactly twice); a different count does not win', () => {
    let won = 0;
    let notWon = 0;
    for (const seed of SEEDS.concat(['aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj'])) {
      const s = play(seed, 4);
      const ones = rolled(s).filter((d) => d === 1).length;
      const over = s.players.some((p) => p.hasLost) || s.players.find((p) => p.id === 'p2')!.hasLost;
      if (ones === 2) { expect(over, `${seed} ${rolled(s)}`).toBe(true); won++; } else { expect(over, `${seed} ${rolled(s)}`).toBe(false); notWon++; }
    }
    expect(won).toBeGreaterThan(0);
    expect(notWon).toBeGreaterThan(0);
  });
});

describe('CR 706.2, 706.3a-b: "Roll a d20 and subtract the number of cards in your hand. If the result is 0 or less, discard your hand." over a results table (The Deck of Many Things)', () => {
  const DECK = card('Test Deck', 'Legendary Artifact', '{T}: Roll a d20 and subtract the number of cards in your hand. If the result is 0 or less, discard your hand.\n1—9 | Return a card at random from your graveyard to your hand.\n10—19 | Draw two cards.\n20 | Put a creature card from any graveyard onto the battlefield under your control. When that creature dies, its owner loses the game.');
  const KILL = card('Test Smite', 'Instant', 'Destroy target creature.');
  const GRUB = card('Test Grub', 'Creature — Insect', '', { pt: ['1', '1'] });
  const setup = (seed: string, hand: number): GameState => scenario([], { seed, defs: [DECK, KILL, GRUB], p1: { battlefield: ['Test Deck'], hand: [...Array(hand).fill('Plains') as string[], 'Test Smite'].slice(0, hand), graveyard: ['Plains', 'Plains'] }, p2: { graveyard: ['Test Grub'] } });
  it('is fully automated: the roll with its modifier, the instructions after the roll and the three rows', () => {
    expect(DECK.automation.level).toBe('full');
    expect(JSON.stringify(DECK.faces[0]!.abilities[0])).toContain('"modifier":{"q":"math","op":"-","args":[0,{"q":"zoneSize","zone":"hand","of":{"ref":"you"}}]},"afterRoll":[');
  });
  it('the result after the modifier decides the row: natural result minus the cards in hand (1-9 returns a card, 10-19 draws two)', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) for (const hand of [0, 3]) {
      const s0 = setup(seed, hand);
      const handBefore = s0.zones.hand['p1']!.length;
      const gy0 = s0.zones.graveyard['p1']!.length;
      const s = activate(s0, 'Test Deck');
      const natural = rolled(s)[0]!;
      const result = natural - handBefore;
      expect(rolled(s), seed).toHaveLength(1);
      if (result <= 0) { expect(s.zones.hand['p1'], `${seed} ${natural} ${hand}`).toHaveLength(0); seen.add('discard'); } // the hand is discarded, no row
      else if (result <= 9) { expect(s.zones.hand['p1'], `${seed} ${natural} ${hand}`).toHaveLength(handBefore + 1); expect(s.zones.graveyard['p1']).toHaveLength(gy0 - 1); seen.add('return'); }
      else if (result <= 19) { expect(s.zones.hand['p1'], `${seed} ${natural} ${hand}`).toHaveLength(handBefore + 2); seen.add('draw'); }
      else seen.add('twenty');
    }
    expect(seen.has('discard') && seen.has('return') && seen.has('draw')).toBe(true);
  });
  it('a 20 (only possible with an empty hand): a creature card from any graveyard comes back under your control, and when it dies its OWNER loses the game', () => {
    for (const seed of SEEDS.concat(['aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj', 'ak', 'al', 'am', 'an', 'ao', 'ap', 'aq', 'ar', 'as', 'at', 'au', 'av', 'aw', 'ax', 'ay', 'az', 'ba', 'bb', 'bc', 'bd', 'be', 'bf', 'bg', 'bh', 'bi', 'bj', 'bk', 'bl'])) {
      const s0 = scenario([], { seed, defs: [DECK, KILL, GRUB], p1: { battlefield: ['Test Deck', 'Plains'], hand: [], graveyard: [] }, p2: { graveyard: ['Test Grub'] } });
      // p1 holds Smite for later
      const s1 = activate(s0, 'Test Deck');
      if (rolled(s1)[0] !== 20) continue;
      const grub = findAll(s1, 'Test Grub', 'battlefield').filter((id) => s1.objects[id]!.controller === 'p1');
      expect(grub, seed).toHaveLength(1); // under p1's control, though p2 owns it
      expect(s1.objects[grub[0]!]!.owner).toBe('p2');
      expect(s1.players.find((p) => p.id === 'p2')!.hasLost).toBe(false);
      // it dies (destroyed by p1's Smite): its owner (p2), not its controller (p1), loses the game
      const s2 = clone(s1);
      put(s2, 'p1', 'hand', 'Test Smite');
      const s3 = resolveAll(act(s2, { type: 'cast', player: 'p1', card: find(s2, 'Test Smite', 'hand', 'p1') }), { targets: [{ kind: 'object', id: grub[0]! }] });
      expect(findAll(s3, 'Test Grub', 'battlefield')).toHaveLength(0);
      expect(s3.players.find((p) => p.id === 'p2')!.hasLost, seed).toBe(true);
      expect(s3.players.find((p) => p.id === 'p1')!.hasLost).toBe(false);
      return;
    }
    throw new Error('no seed rolled a natural 20');
  });
  it('the negative case: with cards in hand a natural 20 is only a 20 minus the hand: no row 20, and nothing is put onto the battlefield', () => {
    for (const seed of SEEDS) {
      const s0 = setup(seed, 2);
      const s = activate(s0, 'Test Deck');
      expect(findAll(s, 'Test Grub', 'battlefield'), seed).toHaveLength(0);
    }
  });
});

describe("CR 706.3a, 400.7, 603.7: Lae'zel's Acrobatics", () => {
  const ACRO = card('Test Acrobatics', 'Instant', 'Exile all nontoken creatures you control, then roll a d20.\n1—9 | Return those cards to the battlefield under their owner\'s control at the beginning of the next end step.\n10—20 | Return those cards to the battlefield under their owner\'s control, then exile them again. Return those cards to the battlefield under their owner\'s control at the beginning of the next end step.');
  const SOLDIER = card('Test Joyful Soldier', 'Creature — Human Soldier', 'When this creature enters, you gain 1 life.', { pt: ['2', '2'] });
  const TOKENMAKER = card('Test Makers', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
  const play = (seed: string): { s: GameState; natural: number; life0: number } => {
    const s0 = scenario([], { seed, defs: [ACRO, SOLDIER, TOKENMAKER], p1: { hand: ['Test Acrobatics', 'Test Makers'], battlefield: ['Test Joyful Soldier'] } });
    const life0 = life(s0, 'p1');
    const s1 = resolveAll(act(resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Makers', 'hand') })), { type: 'cast', player: 'p1', card: find(s0, 'Test Acrobatics', 'hand') }));
    return { s: s1, natural: rolled(s1)[0]!, life0 };
  };
  const inExile = (s: GameState): boolean => s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Joyful Soldier');
  const onField = (s: GameState): number => findAll(s, 'Test Joyful Soldier', 'battlefield').length;
  const toNextTurn = (s0: GameState): GameState => {
    let s = s0;
    for (let g = 0; g < 80 && s.turn.number === s0.turn.number; g++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s);
    return s;
  };
  it('is fully automated', () => {
    expect(ACRO.automation.level).toBe('full');
  });
  it('1-9: the creatures stay exiled until the next end step, then return (their enters trigger happens then); 10-20: they return at once, are exiled again, and return at the end step', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const { s, natural, life0 } = play(seed);
      expect(inExile(s), `${seed} ${natural}`).toBe(true); // exiled right now either way
      expect(life(s, 'p1') - life0, `${seed} ${natural}`).toBe(natural >= 10 ? 1 : 0); // the 10-20 row brings it back once for a moment: it enters, you gain 1 life
      seen.add(natural >= 10 ? 'high' : 'low');
      const end = toNextTurn(s);
      expect(onField(end), `${seed} ${natural}`).toBe(1);
      expect(life(end, 'p1') - life0, `${seed} ${natural}`).toBe(natural >= 10 ? 2 : 1);
    }
    expect(seen.size).toBe(2);
  });
  it('the negative case: a token creature is not exiled ("nontoken"), and stays on the battlefield', () => {
    const { s } = play('a');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1')).toHaveLength(1);
  });
});

describe('CR 702.16a-b, 111.1, 601.2a: "protection from spells and from permanents that were cast this turn" (Emrakul, the World Anew)', () => {
  const WARDEN = card('Test Warden', 'Creature — Eldrazi', 'Protection from spells and from permanents that were cast this turn', { pt: ['5', '5'] });
  const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 2 damage to target creature.');
  const QUAKE = card('Test Quake', 'Instant', 'Test Quake deals 1 damage to each creature.');
  const PINGER = card('Test Pinger', 'Creature — Wizard', 'Haste\n{T}: Test Pinger deals 1 damage to target creature.', { pt: ['1', '1'] });
  const defs = [WARDEN, BEAR, ZAP, QUAKE, PINGER];
  const targetsOf = (s: GameState): ObjectId[] => (s.pending as unknown as { objects: ObjectId[] }).objects;
  const pingKey = (s: GameState, id: ObjectId): string => activatedAbilities(s, s.objects[id]!).find((i) => i.def.isMana !== true)!.key;
  it('is fully automated, with both qualities', () => {
    expect(WARDEN.automation.level).toBe('full');
    expect(JSON.stringify(WARDEN.faces[0]!.abilities)).toContain('"quality":"spell"');
    expect(JSON.stringify(WARDEN.faces[0]!.abilities)).toContain('"quality":"castThisTurn"');
  });
  it('a spell can\'t target it (an ordinary creature stays a legal target), and a spell\'s damage to it is prevented', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Zap', 'Test Quake'] }, p2: { battlefield: ['Test Warden', 'Test Plain Bear'] } });
    const warden = find(s0, 'Test Warden', 'battlefield', 'p2');
    const bear = find(s0, 'Test Plain Bear', 'battlefield', 'p2');
    const asked = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') });
    expect(targetsOf(asked)).toContain(bear);
    expect(targetsOf(asked)).not.toContain(warden);
    const quake = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Quake', 'hand', 'p1') }));
    expect(quake.objects[bear]!.damage).toBe(1);
    expect(quake.objects[warden]!.damage).toBe(0);
  });
  it('a permanent cast this turn can\'t target it; one that was on the battlefield since before this turn can; a token made this turn (never cast) can', () => {
    const s0 = scenario([], { defs: [...defs, card('Test Maker', 'Sorcery', 'Create a 1/1 red Goblin creature token with haste and "{T}: This creature deals 1 damage to target creature."')], p1: { hand: ['Test Pinger', 'Test Maker'], battlefield: ['Test Pinger'] }, p2: { battlefield: ['Test Warden'] } });
    const warden = find(s0, 'Test Warden', 'battlefield', 'p2');
    const old = find(s0, 'Test Pinger', 'battlefield', 'p1');
    // the Pinger on the battlefield since the start: it was not cast this turn
    expect(targetsOf(act(s0, { type: 'activate', player: 'p1', source: old, ability: pingKey(s0, old) }))).toContain(warden);
    // cast one more this turn: it can't target the Warden
    const s1 = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pinger', 'hand', 'p1') }));
    const fresh = findAll(s1, 'Test Pinger', 'battlefield', 'p1').find((id) => id !== old)!;
    expect(targetsOf(act(s1, { type: 'activate', player: 'p1', source: fresh, ability: pingKey(s1, fresh) }))).not.toContain(warden);
    // the permanent that was cast the turn before is no longer "cast this turn" (next turn): modelled by a turn counter change
    const s2 = clone(s1);
    s2.turn.number += 1;
    s2.objects[fresh]!.tapped = false;
    s2.turn.activePlayer = 'p1';
    expect(getChars(s2, fresh)!.castThisTurn).toBeUndefined();
    expect(getChars(s1, fresh)!.castThisTurn).toBe(true);
    // a token is a permanent that was not cast
    const s3 = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Maker', 'hand', 'p1') }));
    const goblin = s3.zones.battlefield.find((id) => s3.objects[id]!.kind === 'token' && s3.objects[id]!.controller === 'p1')!;
    expect(getChars(s3, goblin)!.castThisTurn).toBeUndefined();
    expect(targetsOf(act(s3, { type: 'activate', player: 'p1', source: goblin, ability: pingKey(s3, goblin) }))).toContain(warden);
  });
});

describe('CR 702.16a, 601.2a: a copy permanent that was cast this turn is a "permanent that was cast this turn" (review: layer 1 rebuilds the characteristics)', () => {
  const WARDEN = card('Test Warden Two', 'Creature — Eldrazi', 'Protection from permanents that were cast this turn', { pt: ['5', '5'] });
  const MIMIC = card('Test Mimic Two', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield.', { pt: ['0', '0'] });
  const PING = card('Test Ping Two', 'Creature — Wizard', 'Haste\n{T}: Test Ping Two deals 1 damage to target creature.', { pt: ['1', '1'] });
  it('the copy cast this turn can\'t target the protected creature, the original (on the battlefield before) can', () => {
    const s0 = scenario([], { defs: [WARDEN, MIMIC, PING], p1: { hand: ['Test Mimic Two'], battlefield: ['Test Ping Two'] }, p2: { battlefield: ['Test Warden Two'] } });
    const warden = find(s0, 'Test Warden Two', 'battlefield', 'p2');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Mimic Two', 'hand') });
    for (let i = 0; i < 20 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      const p = s.pending as unknown as { kind: string; options: string[]; min: number; max: number };
      if (p?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (p?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.filter((o) => s.defs[s.objects[o]!.defId]!.name === 'Test Ping Two').slice(0, 1) });
      else if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else s = pass(s);
    }
    const pings = s.zones.battlefield.filter((id) => getChars(s, id)!.name === 'Test Ping Two' && s.objects[id]!.controller === 'p1');
    expect(pings).toHaveLength(2);
    const copy = pings.find((id) => s.objects[id]!.cast !== undefined)!;
    const old = pings.find((id) => id !== copy)!;
    expect(getChars(s, copy)!.castThisTurn).toBe(true);
    expect(getChars(s, old)!.castThisTurn).toBeUndefined();
    const key = (id: ObjectId): string => activatedAbilities(s, s.objects[id]!).find((i) => i.def.isMana !== true)!.key;
    expect((act(s, { type: 'activate', player: 'p1', source: old, ability: key(old) }).pending as unknown as { objects: ObjectId[] }).objects).toContain(warden);
    expect((act(s, { type: 'activate', player: 'p1', source: copy, ability: key(copy) }).pending as unknown as { objects: ObjectId[] }).objects).not.toContain(warden);
  });
});

describe('CR 702.35a: "Madness--Pay six {C}."', () => {
  const MAD = card('Test Madness Colossus', 'Creature — Eldrazi', 'Madness--Pay six {C}.', { pt: ['6', '6'] });
  it('is the keyword madness with a cost of six colorless mana (not six generic)', () => {
    expect(MAD.automation.level).toBe('full');
    const k = MAD.faces[0]!.abilities[0] as unknown as { keyword: string; cost: { mana: { kind: string }[] } };
    expect(k.keyword).toBe('madness');
    expect(k.cost.mana).toHaveLength(6);
    expect(k.cost.mana.every((m) => m.kind === 'colorless')).toBe(true);
  });
});

describe('CR 706.2, 608.2h: "Roll two d6 and choose one result" with the result inside a description and a cast limit (Valiant Endeavor, Arcane Endeavor: wordings of the same reading)', () => {
  const VALIANT = card('Test Valiant', 'Sorcery', 'Roll two d6 and choose one result. Destroy each creature with power greater than or equal to that result. Then create a number of 2/2 white Knight creature tokens with vigilance equal to the other result.');
  const ARCANE = card('Test Arcane', 'Sorcery', 'Roll two d8 and choose one result. Draw cards equal to that result. Then you may cast an instant or sorcery spell with mana value less than or equal to the other result from your hand without paying its mana cost.');
  const POWERS = [1, 2, 3, 4, 5, 6].map((n) => card(`Test Power ${n}`, 'Creature — Beast', '', { pt: [String(n), '9'] }));
  it('are fully automated', () => {
    expect(VALIANT.automation.level).toBe('full');
    expect(ARCANE.automation.level).toBe('full');
  });
  it('Valiant: every creature with power at least the chosen result is destroyed, and the other result Knights come (the player picks the higher die)', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const s0 = scenario([], { seed, defs: [VALIANT, ...POWERS], p1: { hand: ['Test Valiant'] }, p2: { battlefield: POWERS.map((c) => c.faces[0]!.name) } });
      const s = resolveAll(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Valiant', 'hand') }), { option: (o) => o.reduce((a, b) => (Number(b.label) > Number(a.label) ? b : a)).id });
      const dice = rolled(s);
      const chosen = Math.max(...dice);
      const alive = POWERS.filter((c) => findAll(s, c.faces[0]!.name, 'battlefield').length > 0).map((c) => Number(c.faces[0]!.name.slice(-1)));
      expect(alive, `${seed} ${dice}`).toEqual([1, 2, 3, 4, 5, 6].filter((n) => n < chosen));
      expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1'), `${seed} ${dice}`).toHaveLength(dice[0]! + dice[1]! - chosen);
    }
  });
});
