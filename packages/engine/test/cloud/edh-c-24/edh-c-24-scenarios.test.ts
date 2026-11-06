/**
 * Commander lane edh-c, round edh-c-24 (EDHREC ranks 20,001-20,500): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites
 * checked against the Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 611.2c, 613.4c            "Until end of turn, creatures you control get +1/+1 and creatures your opponents control get -1/-1." (Zealous Persecution)
 *   CR 509.1b, 613.4c            "Enchanted creature gets +1/+1 and can't be blocked except by creatures with flying." (Treetop Bracers)
 *   CR 706.2, 603.2c             "Whenever you roll a 2, ..." (Dee Kay, Finder of the Lost)
 *   CR 107.3, 120.2b, 608.2h     "~ deals X damage to target creature and X damage to you, where X is the number of Goblins on the battlefield." (Sparksmith)
 *   CR 701.24a, 404.1            "Shuffle all creature cards from target player's graveyard into that player's library." (Repopulate)
 *   CR 601.2f, 205.3m            "Creature spells you cast that share a creature type with ~ cost {1} less to cast." (Mistform Warchief)
 *   CR 601.2f, 201.2             "Choose a card name. Spells with the chosen name cost {1} less to cast this turn." (Cheering Fanatic)
 *   CR 105.2c, 613.1e            "All Slivers are colorless." (Ghostflame Sliver)
 *   CR 508.1d, 611.2a            "Target creature an opponent controls attacks you this turn if able." (Alluring Siren)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, legal, life, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers } from '../../m4/helpers';
import { card, cast, full, pt, resolveAll, settle } from '../cmd3/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const PERSECUTION = card('Test Persecution', 'Sorcery', 'Until end of turn, creatures you control get +1/+1 and creatures your opponents control get -1/-1.');
const BRACERS = card('Test Bracers', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +1/+1 and can't be blocked except by creatures with flying.");
const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '4']);
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '4']);
const KAY = card('Test Kay', 'Creature — Dwarf', 'Whenever you roll a 2, each opponent loses 1 life and you gain 1 life.', ['1', '1']);
const DIE = card('Test Die', 'Artifact', '{0}: Roll a d6.');
const SMITH = card('Test Smith', 'Creature — Goblin', '{T}: This creature deals X damage to target creature and X damage to you, where X is the number of Goblins on the battlefield.', ['1', '1']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', ['1', '1']);
const REPOP = card('Test Repop', 'Sorcery', "Shuffle all creature cards from target player's graveyard into that player's library.");
const TRINKET = card('Test Trinket', 'Artifact', '');
const WARCHIEF = card('Test Warchief', 'Creature — Shapeshifter', 'Creature spells you cast that share a creature type with this creature cost {1} less to cast.', ['1', '1']);
const ELF2 = card('Test Elf', 'Creature — Shapeshifter Elf', '', ['1', '1'], '{1}{1}');
const ELF2B = card('Test Elf Brother', 'Creature — Shapeshifter', '', ['1', '1'], '{2}');
const OGRE2 = card('Test Ogre', 'Creature — Ogre', '', ['1', '1'], '{2}');
const FANATIC = card('Test Fanatic', 'Creature — Human', 'Whenever this creature attacks, choose a card name. Spells with the chosen name cost {1} less to cast this turn.', ['1', '1']);
const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.', undefined, '{1}');
const SPARK2 = card('Test Flare', 'Instant', 'You gain 2 life.', undefined, '{1}');
const SLIVER = card('Test Sliver', 'Creature — Sliver', '', ['1', '1']);
const GHOSTFLAME = card('Test Ghostflame', 'Creature — Sliver', 'All Slivers are colorless.', ['1', '1'], '{1}{B}{R}');
const SIREN = card('Test Siren', 'Creature — Siren', '{T}: Target creature an opponent controls attacks you this turn if able.', ['1', '1']);
const DEFS = [BEAR, PERSECUTION, BRACERS, WALL, BIRD, KAY, DIE, SMITH, GOBLIN, REPOP, TRINKET, WARCHIEF, ELF2, ELF2B, OGRE2, FANATIC, SPARK, SPARK2, SLIVER, GHOSTFLAME, SIREN];
const obj = (id: ObjectId) => ({ kind: 'object' as const, id });
const colors = (s: GameState, id: ObjectId): string[] => [...(getChars(s, id)!.colors ?? [])];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 611.2c, 613.4c: "Until end of turn, creatures you control get +1/+1 and creatures your opponents control get -1/-1." (Zealous Persecution)', () => {
  const board = (): GameState => scenario([], { defs: DEFS, players: 3 as never, p1: { hand: ['Test Persecution'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } } as never);
  it('your creature is 4/4 and each opponent creature is 2/2', () => {
    const s = resolveAll(cast(board(), 'Test Persecution'));
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('4/4');
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe('2/2');
  });
  it('negative: before the spell nothing changes; the change ends with the turn', () => {
    const s0 = board();
    expect(pt(s0, find(s0, 'Test Bear', 'battlefield', 'p2'))).toBe('3/3');
    let s = resolveAll(cast(s0, 'Test Persecution'));
    for (let guard = 0; s.turn.number < 2 && guard < 400; guard++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    expect(s.turn.number).toBeGreaterThanOrEqual(2);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('3/3');
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe('3/3');
  });
});

describe('CR 509.1b, 613.4c: "Enchanted creature gets +1/+1 and can\'t be blocked except by creatures with flying." (Treetop Bracers)', () => {
  const attack = (): GameState => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Bracers'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Wall', 'Test Bird'] } });
    s = resolveAll(cast(s, 'Test Bracers', { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p1'))] }));
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'main phase');
    return toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Bear', 'battlefield', 'p1'), 'p2']]));
  };
  it('the enchanted creature is 4/4', () => {
    const s = attack();
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('4/4');
  });
  it('a creature without flying cannot block it; one with flying can', () => {
    const s = attack();
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(() => declareBlockers(s, [[find(s, 'Test Wall', 'battlefield', 'p2'), bear]])).toThrow();
    expect(declareBlockers(s, [[find(s, 'Test Bird', 'battlefield', 'p2'), bear]]).turn).toBeDefined();
  });
});

describe('CR 706.2, 603.2c: "Whenever you roll a 2, each opponent loses 1 life and you gain 1 life." (Dee Kay)', () => {
  const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't'];
  const rolled = (s: GameState): number[] => s.log.flatMap((l) => { const m = /rolls a d\d+: (\d+)\./.exec(l.text); return m ? [Number(m[1])] : []; });
  it('the drain happens exactly when the die shows a 2 (and for a roll of anything else nothing happens)', () => {
    const results = new Set<number>();
    for (const seed of SEEDS) {
      const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Kay', 'Test Die'] }, seed });
      const dieId = find(s0, 'Test Die', 'battlefield', 'p1');
      let s = settle(act(s0, { type: 'activate', player: 'p1', source: dieId, ability: 'p:0:0' } as never));
      s = resolveAll(s);
      const r = rolled(s);
      expect(r, seed).toHaveLength(1);
      results.add(r[0]!);
      const drained = r[0] === 2 ? 1 : 0;
      expect(life(s, 'p2'), `${seed}: rolled ${r[0]}`).toBe(life(s0, 'p2') - drained);
      expect(life(s, 'p1'), `${seed}: rolled ${r[0]}`).toBe(life(s0, 'p1') + drained);
    }
    expect(results.has(2)).toBe(true);
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('CR 107.3, 120.2b, 608.2h: "~ deals X damage to target creature and X damage to you, where X is the number of Goblins on the battlefield." (Sparksmith)', () => {
  it('with three Goblins on the battlefield it deals 3 to the target and 3 to you', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Smith', 'Test Goblin'] }, p2: { battlefield: ['Test Bear', 'Test Goblin'] } });
    const smith = find(s0, 'Test Smith', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: smith, ability: 'p:0:0' } as never), { targets: [obj(bear)] }));
    expect(Object.values(s.objects).some((o) => o.defId === 'Test Bear' && o.zone === 'graveyard')).toBe(true); // 3 damage destroys the 3/3
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 3);
  });
  it('negative: with no other Goblin only 1 damage each way', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Smith'] }, p2: { battlefield: ['Test Bear'] } });
    const smith = find(s0, 'Test Smith', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = resolveAll(settle(act(s0, { type: 'activate', player: 'p1', source: smith, ability: 'p:0:0' } as never), { targets: [obj(bear)] }));
    expect(s.objects[bear]!.damage).toBe(1);
    expect(life(s, 'p1')).toBe(life(s0, 'p1') - 1);
  });
});

describe('CR 701.24a, 404.1: "Shuffle all creature cards from target player\'s graveyard into that player\'s library." (Repopulate)', () => {
  it('the creature cards of the target player\'s graveyard are in their library; a card of another type and your own graveyard stay', () => {
    const s0 = scenario([], { defs: DEFS, p1: { hand: ['Test Repop'], graveyard: ['Test Bear'] }, p2: { graveyard: ['Test Bear', 'Test Trinket', 'Test Wall'] } });
    const s = resolveAll(cast(s0, 'Test Repop', { targets: [{ kind: 'player', id: 'p2' }] }));
    const yard = (p: string): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
    const lib = (p: string): string[] => (s.zones.library[p] ?? []).map((id) => s.objects[id]!.defId);
    expect(yard('p2')).toEqual(['Test Trinket']);
    expect(lib('p2')).toContain('Test Bear');
    expect(lib('p2')).toContain('Test Wall');
    expect(yard('p1')).toContain('Test Bear');
    expect(lib('p1')).not.toContain('Test Bear');
  });
});

describe('CR 601.2f, 205.3m: "Creature spells you cast that share a creature type with ~ cost {1} less to cast." (Mistform Warchief)', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { hand: ['Test Elf Brother', 'Test Ogre'], battlefield: ['Test Warchief', 'Plains'] } });
  it('a creature spell that shares a type costs {1} less: a {2} spell is cast with one land', () => {
    const s0 = board();
    const s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Elf Brother', 'hand', 'p1') } as never);
    expect(settle(s).pending?.kind).toBe('priority');
    expect(settle(s).zones.stack.length).toBe(1);
  });
  it('negative: a creature spell that shares no type costs its full {2}: one land is not enough', () => {
    const s0 = board();
    expect(() => reject(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ogre', 'hand', 'p1') } as never)).not.toThrow();
  });
});

describe('CR 601.2f, 201.2: "Choose a card name. Spells with the chosen name cost {1} less to cast this turn." (Cheering Fanatic)', () => {
  it('after naming Test Spark, that spell costs {1} less this turn: it is cast with no mana; another name still costs {1}', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Spark', 'Test Flare'], battlefield: ['Test Fanatic'] } });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'main phase');
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Fanatic', 'battlefield', 'p1'), 'p2']]);
    s = passUntil(s, (x) => x.pending?.kind === 'chooseName' || x.turn.step === 'combatDamage', 'the name choice');
    expect(s.pending).toMatchObject({ kind: 'chooseName' });
    s = settle(answer(s, { kind: 'chooseName', name: 'Test Spark' }));
    s = resolveAll(s);
    const flare = reject(s, { type: 'cast', player: 'p1', card: find(s, 'Test Flare', 'hand', 'p1') } as never);
    expect(flare.message.length).toBeGreaterThan(0); // no mana: the other name costs its full {1}
    const spark = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') } as never));
    expect(spark.zones.stack.length).toBe(1);
  });
});

describe('CR 608.2h, 611.2a, 400.7: the Fanatic\'s chosen name is fixed when the trigger resolves; CR 702.73a: a changeling shares a type', () => {
  it('the cost cut stays when the Fanatic is blocked and dies after the name was chosen', () => {
    let s = scenario([], { defs: [...DEFS, card('Test Big Wall', 'Creature — Wall', '', ['3', '9'])], p1: { hand: ['Test Spark'], battlefield: ['Test Fanatic'] }, p2: { battlefield: ['Test Big Wall'] } });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1' && x.pending?.kind === 'priority', 'main phase');
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Fanatic', 'battlefield', 'p1'), 'p2']]);
    s = passUntil(s, (x) => x.pending?.kind === 'chooseName', 'the name choice');
    s = resolveAll(settle(answer(s, { kind: 'chooseName', name: 'Test Spark' })));
    s = toDeclareBlockers(s);
    s = declareBlockers(s, [[find(s, 'Test Big Wall', 'battlefield', 'p2'), find(s, 'Test Fanatic', 'battlefield', 'p1')]]);
    s = passUntil(s, (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'main phase 2');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Fanatic')).toBe(false);
    expect(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') } as never)).zones.stack.length).toBe(1);
  });
  it('a Changeling creature spell shares a creature type with the Warchief and costs {1} less', () => {
    const changer = card('Test Changer', 'Creature — Shapeshifter', 'Changeling', ['1', '1'], '{2}');
    const s0 = scenario([], { defs: [WARCHIEF, changer], p1: { hand: ['Test Changer'], battlefield: ['Test Warchief', 'Plains'] } });
    expect(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Changer', 'hand', 'p1') } as never)).zones.stack.length).toBe(1);
  });
});

describe('CR 105.2c, 613.1e: "All Slivers are colorless." (Ghostflame Sliver)', () => {
  it('a colored Sliver of either player is colorless while it is on the battlefield; a colored non-Sliver keeps its color', () => {
    const red = (name: string, type: string): CardDef => compileCard({ name, layout: 'normal', mana_cost: '{R}', type_line: type, oracle_text: '', colors: ['R'], power: '1', toughness: '1' } as OracleCard);
    const colored = red('Test Red Sliver', 'Creature — Sliver');
    const redBear = red('Test Red Bear', 'Creature — Bear');
    const s = scenario([], { defs: [colored, redBear, GHOSTFLAME], p1: { battlefield: ['Test Ghostflame', 'Test Red Sliver'] }, p2: { battlefield: ['Test Red Sliver', 'Test Red Bear'] } });
    for (const id of findAll(s, 'Test Red Sliver', 'battlefield')) expect(colors(s, id)).toEqual([]);
    expect(colors(s, find(s, 'Test Red Bear', 'battlefield', 'p2'))).toEqual(['R']);
  });
});

describe('CR 508.1d, 611.2a: "Target creature an opponent controls attacks you this turn if able." (Alluring Siren)', () => {
  /** p2's turn, beginning of combat, p1 has priority: the Siren is activated on p2's Bear (if `use`). Returns the state at p2's declare attackers decision. */
  const toAttackers = (use: boolean): GameState => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Siren'] }, p2: { battlefield: ['Test Bear'] } });
    for (let guard = 0; guard < 600 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'beginCombat' && s.pending?.kind === 'priority' && s.pending.player === 'p1'); guard++) {
      s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    }
    expect(s.turn.activePlayer).toBe('p2');
    if (use) s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Siren', 'battlefield', 'p1'), ability: 'p:0:0' } as never), { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p2'))] }));
    return passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the declare attackers decision');
  };
  it('the Bear must attack the Siren\'s controller: attacking nobody is refused, attacking p1 is accepted', () => {
    const s = toAttackers(true);
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [] })).toThrow();
    expect(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p1' }] }).turn).toBeDefined();
  });
  it('a planeswalker of the Siren\'s controller is not "you": with the requirement the Bear may not attack only the planeswalker (ruling: it must attack you)', () => {
    const walker = compileCard({ name: 'Test Walker', layout: 'normal', mana_cost: '{3}', type_line: 'Legendary Planeswalker — Testa', oracle_text: '+1: You gain 1 life.', colors: [], loyalty: '3' } as OracleCard);
    let s = scenario([], { defs: [...DEFS, walker], p1: { battlefield: ['Test Siren', { name: 'Test Walker', counters: { loyalty: 3 } }] }, p2: { battlefield: ['Test Bear'] } });
    for (let guard = 0; guard < 600 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'beginCombat' && s.pending?.kind === 'priority' && s.pending.player === 'p1'); guard++) {
      s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : pass(s);
    }
    s = resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Siren', 'battlefield', 'p1'), ability: 'p:0:0' } as never), { targets: [obj(find(s, 'Test Bear', 'battlefield', 'p2'))] }));
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the declare attackers decision');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    const pw = find(s, 'Test Walker', 'battlefield', 'p1');
    expect(() => answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: pw }] })).toThrow();
    expect(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p1' }] }).turn).toBeDefined();
  });
  it('negative: without the Siren\'s ability attacking nobody is allowed', () => {
    const s = toAttackers(false);
    expect(answer(s, { kind: 'declareAttackers', attacks: [] }).turn).toBeDefined();
  });
});
