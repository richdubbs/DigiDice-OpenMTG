/**
 * CLOUD C5 (named choices and their references: "Choose a color.", "the chosen color / type" of a face's "As ~ enters, choose ...") played through the engine with
 * synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 607.2d           "As ~ enters, choose a color / creature type / card type" and "the chosen color / type" of another ability of the object are linked
 *   CR 614.12a          the choice is made as the permanent enters, before it is on the battlefield
 *   CR 608.2d           "Choose a color." made as a spell resolves, read by its later sentences
 *   CR 601.2f, 118.7    a cost reduction applies to the spells of the chosen type you cast
 *   CR 601.3            "Your opponents can't cast spells of the chosen color"
 *   CR 205.1b, 613.1d   "~ is the chosen type in addition to its other types"
 *   CR 603.2            "Whenever a player casts a spell of the chosen color"
 *   CR 702.16a, 611.2a  protection from the chosen color until end of turn
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** Answer pending decisions (costs automatically, targets, then the queued answers) until a player has priority again. */
function settle(s0: GameState, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  let s = s0;
  const queue = [...answers];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.map((id) => ({ kind: 'object' as const, id })) });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
/** p1 casts the named card from hand, answering its choices with `answers`, and it resolves. */
function castWith(s0: GameState, name: string, answers: DecisionAnswer[] = [], targets: ObjectId[] = []): GameState {
  const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), [], targets);
  return settle(pass(pass(s)), answers, targets);
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const castable = (s: GameState, player: 'p1' | 'p2'): string[] => legal(s, player, 'cast').map((a) => s.objects[(a as { object: ObjectId }).object]!.defId);
const GOBLIN = { kind: 'chooseName', name: 'Goblin' } as const;
const RED = { kind: 'chooseColor', color: 'R' } as const;

const RAIDER = card('Test Raider', 'Creature — Goblin Warrior', '', { pt: ['2', '1'], colors: ['R'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'], colors: ['G'] });

describe('CR 607.2d, 614.12a: "As this enchantment enters, choose a creature type. Creatures of the chosen type get +1/+1."', () => {
  const BANNER = card('Test Banner', 'Enchantment', 'As this enchantment enters, choose a creature type.\nCreatures of the chosen type get +1/+1.');
  it('is automated, and every creature of the type chosen as it entered gets +1/+1, whoever controls it; others do not', () => {
    expect(full(BANNER)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Banner'], battlefield: ['Test Elf'] }, p2: { battlefield: ['Test Raider'] }, defs: [BANNER, RAIDER, ELF] });
    const s = castWith(s0, 'Test Banner', [GOBLIN]);
    expect(pt(s, find(s, 'Test Raider', 'battlefield', 'p2'))).toBe('3/2');
    expect(pt(s, find(s, 'Test Elf', 'battlefield', 'p1'))).toBe('1/1');
  });
});

describe('CR 607.2d, 603.2: "As this artifact enters, choose a color. Whenever a player casts a spell of the chosen color, you gain 1 life."', () => {
  const ORB = card('Test Orb', 'Artifact', 'As this artifact enters, choose a color.\nWhenever a player casts a spell of the chosen color, you gain 1 life.');
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.', { colors: ['R'] });
  const GROWTH = card('Test Growth', 'Instant', 'You gain 1 life.', { colors: ['G'] });
  it('a red spell triggers it (red was chosen), a green spell does not', () => {
    expect(full(ORB)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Orb', 'Test Spark', 'Test Growth'] }, defs: [ORB, SPARK, GROWTH] });
    let s = castWith(s0, 'Test Orb', [RED]);
    const before = life(s, 'p1');
    s = castWith(s, 'Test Spark');
    s = settle(pass(pass(s))); // the trigger, then the spell
    expect(life(s, 'p1')).toBe(before + 2);
    s = castWith(s, 'Test Growth');
    s = settle(pass(pass(s)));
    expect(life(s, 'p1')).toBe(before + 3);
  });
});

describe('CR 607.2d, 601.2f: "As this artifact enters, choose a card type. Spells you cast of the chosen type cost {1} less to cast."', () => {
  const ENGINE = card('Test Engine', 'Artifact', 'As this artifact enters, choose a card type.\nSpells you cast of the chosen type cost {1} less to cast.');
  const QUICK = card('Test Quick', 'Instant', 'You gain 1 life.', { cost: '{1}' });
  const SLOW = card('Test Slow', 'Sorcery', 'You gain 1 life.', { cost: '{1}' });
  it('with Instant chosen and no mana, the instant costing {1} can be cast and the sorcery costing {1} cannot', () => {
    expect(full(ENGINE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Engine', 'Test Quick', 'Test Slow'] }, defs: [ENGINE, QUICK, SLOW] });
    expect(castable(s0, 'p1')).not.toContain('Test Quick');
    const s = castWith(s0, 'Test Engine', [{ kind: 'chooseName', name: 'Instant' }]);
    expect(castable(s, 'p1')).toContain('Test Quick');
    expect(castable(s, 'p1')).not.toContain('Test Slow');
  });
});

describe('CR 607.2d, 601.3: "As this creature enters, choose a color. Your opponents can\'t cast spells of the chosen color."', () => {
  const WARDEN = card('Test Warden', 'Creature — Angel', "Flying\nAs this creature enters, choose a color.\nYour opponents can't cast spells of the chosen color.", { pt: ['4', '4'] });
  const SPARK = card('Test Spark', 'Instant', 'You gain 1 life.', { colors: ['R'] });
  const GROWTH = card('Test Growth', 'Instant', 'You gain 1 life.', { colors: ['G'] });
  it('with red chosen, the opponent can cast the green instant but not the red one; its controller still can', () => {
    expect(full(WARDEN)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Warden', 'Test Spark'] }, p2: { hand: ['Test Spark', 'Test Growth'] }, defs: [WARDEN, SPARK, GROWTH] });
    const s = castWith(s0, 'Test Warden', [RED]);
    expect(castable(s, 'p1')).toContain('Test Spark');
    const p2 = pass(s); // p1 passes priority in the main phase with an empty stack: p2 may cast instants
    expect(castable(p2, 'p2')).toContain('Test Growth');
    expect(castable(p2, 'p2')).not.toContain('Test Spark');
  });
});

describe('CR 205.1b, 607.2d: "~ is the chosen type in addition to its other types. Other creatures you control of the chosen type get +1/+1."', () => {
  const MIMIC = card('Test Mimic', 'Artifact Creature — Shapeshifter', 'As this creature enters, choose a creature type.\nThis creature is the chosen type in addition to its other types.\nOther creatures you control of the chosen type get +1/+1.', { pt: ['2', '2'] });
  const LEADER = card('Test Leader', 'Creature — Human', 'Other Goblins you control get +1/+1.', { pt: ['1', '1'] });
  it('it becomes a Goblin as well as a Shapeshifter (so another Goblin lord pumps it), and pumps the other Goblins, not itself', () => {
    expect(full(MIMIC)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Mimic'], battlefield: ['Test Raider', 'Test Leader'] }, defs: [MIMIC, RAIDER, LEADER] });
    const s = castWith(s0, 'Test Mimic', [GOBLIN]);
    const mimic = find(s, 'Test Mimic', 'battlefield', 'p1');
    expect(getChars(s, mimic)!.subtypes).toEqual(expect.arrayContaining(['Shapeshifter', 'Goblin']));
    expect(pt(s, mimic)).toBe('3/3'); // the Leader's +1/+1, not its own
    expect(pt(s, find(s, 'Test Raider', 'battlefield', 'p1'))).toBe('4/3'); // 2/1 with the Mimic's and the Leader's +1/+1
  });
});

describe('CR 608.2d, 702.16a, 611.2a: "Choose a color. Creatures you control gain protection from the chosen color until end of turn."', () => {
  const SHIELD = card('Test Shield', 'Instant', 'Choose a color. Creatures you control gain protection from the chosen color until end of turn.');
  it('is automated; with red chosen the creature has protection from red, and only until end of turn', () => {
    expect(full(SHIELD)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Shield'], battlefield: ['Test Elf'] }, defs: [SHIELD, ELF] });
    const s = castWith(s0, 'Test Shield', [RED]);
    const elf = find(s, 'Test Elf', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, elf)!, 'protection')).toBe(true);
    expect(JSON.stringify(getChars(s, elf)!.keywords)).toContain('color:R');
    const later = advanceTo(s, s.turn.number + 1, 'upkeep');
    expect(hasKeyword(getChars(later, elf)!, 'protection')).toBe(false);
  });
});

describe('CR 608.2d, 607.2d: "Choose a creature type. Destroy all creatures that aren\'t of the chosen type."', () => {
  const PURGE = card('Test Purge', 'Sorcery', "Choose a creature type. Destroy all creatures that aren't of the chosen type.");
  it('with Goblin chosen, the Goblin survives and the Elf is destroyed', () => {
    expect(full(PURGE)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Purge'], battlefield: ['Test Elf'] }, p2: { battlefield: ['Test Raider'] }, defs: [PURGE, RAIDER, ELF] });
    const s = castWith(s0, 'Test Purge', [GOBLIN]);
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId)).toContain('Test Raider');
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId)).not.toContain('Test Elf');
  });
});

describe('CR 608.2d, 611.2c: "Choose a creature type. Creatures of the chosen type get +2/+2 until end of turn."', () => {
  const RALLY = card('Test Rally', 'Instant', 'Choose a creature type. Creatures of the chosen type get +2/+2 until end of turn.');
  it('is automated (both Oracle wordings render), and only the Goblin gets +2/+2', () => {
    expect(full(RALLY)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Rally'], battlefield: ['Test Elf', 'Test Raider'] }, defs: [RALLY, RAIDER, ELF] });
    const s = castWith(s0, 'Test Rally', [GOBLIN]);
    expect(pt(s, find(s, 'Test Raider', 'battlefield', 'p1'))).toBe('4/3');
    expect(pt(s, find(s, 'Test Elf', 'battlefield', 'p1'))).toBe('1/1');
  });
});

describe('CR 607.2d, 601.2c: "{T}: Untap target creature of the chosen type." reads the choice made as the permanent entered', () => {
  const POST = card('Test Post', 'Artifact', 'As this artifact enters, choose a creature type.\n{T}: Untap target creature of the chosen type.');
  it('is automated; a Goblin is a legal target, an Elf is not', () => {
    expect(full(POST)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Post'], battlefield: ['Test Elf', 'Test Raider'] }, defs: [POST, RAIDER, ELF] });
    const s = castWith(s0, 'Test Post', [GOBLIN]);
    const post = find(s, 'Test Post', 'battlefield', 'p1');
    const a = legal(s, 'p1', 'activate').find((x) => (x as { object?: ObjectId }).object === post);
    expect(a).toBeDefined();
    const t = act(s, a!.action);
    expect(t.pending?.kind).toBe('chooseTargets');
    const offered = JSON.stringify(t.pending);
    expect(offered).toContain(find(s, 'Test Raider', 'battlefield', 'p1'));
    expect(offered).not.toContain(find(s, 'Test Elf', 'battlefield', 'p1'));
  });
});

describe('CR 607.2d (never a guess): "the chosen type" with no "As ~ enters, choose ..." on the face, or with a choice of another kind, is not automated', () => {
  it('a reader with no producer, or of another kind, stays manual', () => {
    expect(full(card('Test Lost Banner', 'Enchantment', 'Creatures of the chosen type get +1/+1.'))).toBe(false);
    expect(full(card('Test Wrong Banner', 'Enchantment', 'As this enchantment enters, choose a color.\nCreatures of the chosen type get +1/+1.'))).toBe(false);
    expect(full(card('Test Lost Orb', 'Artifact', 'Whenever a player casts a spell of the chosen color, you gain 1 life.'))).toBe(false);
  });
});
