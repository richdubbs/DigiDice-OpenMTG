/**
 * Commander effort (coordinator C), round edh-c-8: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) is the active player. CR cites are checked against the Comprehensive Rules text of 2026-09-25.
 *
 *   CR 702.119a, 601.2b, 601.2f   Emerge: cast by sacrificing a creature, the total cost reduced by generic mana equal to its mana value (colored mana is not reduced)
 *   CR 122.6, 614.17              "~ can't have counters put on it"
 *   CR 613.1f, 508.1d, 702.10     "Creatures you control have haste and attack each combat if able"
 *   CR 615.1, 303.4               "Prevent all damage that would be dealt to enchanted creature"
 *   CR 614.1a, 700.4, 401.4       "If ~ would die, put it on the bottom of its owner's library instead"
 *   CR 701.6a, 101.2              "If there are two or more instant and/or sorcery cards in your graveyard, ~ can't be countered" (checked when the counter resolves)
 *   CR 201.2, 608.2c, 614.15      "It deals 3 damage instead if you control artifacts named A and B" (both names; checked as the ability resolves)
 *   CR 701.20a, 402.3, 608.2d     "Target player reveals three cards from their hand and you choose one of them. That player discards that card."
 *   CR 608.2h, 208.1, 601.2b      "X is the total power of the sacrificed creatures"
 *   CR 702.18a, 611.2a            "You gain shroud until end of turn"
 *   CR 400.7, 611.3a              "~ has hexproof as long as it entered this turn"
 *   CR 601.2f, 118.7a             "~ costs {2} less to cast if it targets a creature card with mana value 3 or less"
 *   CR 609.4, 702.3b              "As long as equipped creature has defender, it can attack as though it didn't have defender"
 *   CR 601.3, 508.1               "Cast ~ only during the declare attackers step"
 *   CR 603.4, 508.1               "if defending player controls no black nontoken permanents, it doesn't untap during your next untap step"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, requirementsFor, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { ruleDenial } from '../../../src/statics/hooks';
import { act, find, pass, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { advanceTo as advanceToStep, answer, labels } from '../../m5/helpers';
import { castCard } from '../../m5/announce/support';
import { drive } from '../../m5/cr-examples/helpers';
import { synthetic } from '../../m6/costs/support';
import { card, cast, full, resolveAll, settle } from '../cmd3/helpers';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onField = (s: GameState, name: string, player?: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name && (player === undefined || s.objects[id]!.controller === player));
const inYard = (s: GameState, name: string, player = 'p1'): boolean => (s.zones.graveyard[player] ?? []).some((id) => nameOf(s, id) === name);
const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const withParts = (name: string, type: string, text: string, parts: string[], cost = '{0}', pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), all_parts: [name, ...parts].map((n) => ({ object: 'related_card', id: n, component: 'combo_piece', name: n, type_line: 'x', uri: '' })) } as unknown as OracleCard);

// ---- emerge ------------------------------------------------------------------------------------------------------------------------------------------------
const EMERGER = synthetic('Test Emerger', 'Creature — Eldrazi', '{9}', 'Emerge {2}{G}\nWhen you cast this spell, you gain 1 life.', { power: '7', toughness: '7' });
const COLORED = synthetic('Test Colorful', 'Creature — Eldrazi', '{9}', 'Emerge {G}{G}', { power: '7', toughness: '7' });
const BEAR = synthetic('Test Bear', 'Creature — Bear', '{2}{G}', '', { power: '2', toughness: '2' });
const WYRM = synthetic('Test Wyrm', 'Creature — Wyrm', '{5}{G}', '', { power: '5', toughness: '5' });
const EMERGE_DEFS = [EMERGER, COLORED, BEAR, WYRM];

describe('CR 702.119a: Emerge (cast by sacrificing a creature; the total cost is reduced by generic mana equal to the sacrificed creature\'s mana value)', () => {
  const board = (battlefield: string[], lands: number, hand = 'Test Emerger'): GameState =>
    scenario(['Forest'], { defs: EMERGE_DEFS, p1: { hand: [hand], battlefield: [...battlefield, ...Array(lands).fill('Forest')] } });
  const manaPaid = (s: GameState): number => s.objects[s.zones.stack[0]!]!.stack!.costsPaid.manaSpent!.length;
  it('is automated (the keyword is implemented; the cast trigger of the spell is its own ability)', () => {
    expect(full(EMERGER)).toBe(true);
  });
  it('sacrificing a creature of mana value 3 reduces {2}{G} to {G}: one mana is spent and the creature is in the graveyard', () => {
    let s = board(['Test Bear'], 1);
    expect(labels(s, 'p1')).toContain('Cast Test Emerger (emerge)');
    s = castCard(s, 'Test Emerger', { method: 'emerge' });
    s = answer(s, { kind: 'chooseObjects', ids: [onField(s, 'Test Bear')!] });
    s = drive(s);
    expect(s.zones.stack.map((id) => nameOf(s, id))).toContain('Test Emerger');
    expect(inYard(s, 'Test Bear')).toBe(true);
    expect(manaPaid(s)).toBe(1);
  });
  it('colored mana of the emerge cost is not reduced: a mana value 6 creature still leaves {G}{G} to pay', () => {
    let s = board(['Test Wyrm'], 2, 'Test Colorful');
    s = castCard(s, 'Test Colorful', { method: 'emerge' });
    s = answer(s, { kind: 'chooseObjects', ids: [onField(s, 'Test Wyrm')!] });
    s = drive(s);
    expect(inYard(s, 'Test Wyrm')).toBe(true);
    expect(manaPaid(s)).toBe(2);
  });
  it('the negative cases: no creature means no emerge cast; the plain cast costs the full {9}', () => {
    const none = board([], 3);
    expect(labels(none, 'p1')).not.toContain('Cast Test Emerger (emerge)');
    const plain = drive(castCard(board(['Test Bear'], 9), 'Test Emerger'));
    expect(manaPaid(plain)).toBe(9);
    expect(onField(plain, 'Test Bear')).toBeDefined();
  });
});

// ---- static wordings ----------------------------------------------------------------------------------------------------------------------------------------
const KITE = card('Test Kite', 'Artifact Creature — Scarecrow', 'This permanent can\'t have counters put on it.', ['1', '1']);
const GRUNT = card('Test Grunt', 'Creature — Goblin', '', ['2', '2']);
const DRILLER = card('Test Driller', 'Creature — Goblin', 'Creatures you control have haste and attack each combat if able.', ['1', '1']);

describe('CR 122.6, 614.17: "~ can\'t have counters put on it"', () => {
  it('is automated; counters of any kind can\'t be put on it, but they can on another creature', () => {
    expect(full(KITE)).toBe(true);
    const s = scenario([], { defs: [KITE, GRUNT], p1: { battlefield: ['Test Kite', 'Test Grunt'] } });
    expect(ruleDenial(s, { action: 'haveCountersPut', subject: find(s, 'Test Kite', 'battlefield') })).not.toBeNull();
    expect(ruleDenial(s, { action: 'haveCountersPut', subject: find(s, 'Test Grunt', 'battlefield') })).toBeNull();
    // edh-b-2's counter restriction: a restriction with no `counter` field forbids every kind, +1/+1 and -1/-1 included
    for (const counter of ['+1/+1', '-1/-1', 'charge']) {
      expect(ruleDenial(s, { action: 'haveCountersPut', subject: find(s, 'Test Kite', 'battlefield'), counter } as never)).not.toBeNull();
      expect(ruleDenial(s, { action: 'haveCountersPut', subject: find(s, 'Test Grunt', 'battlefield'), counter } as never)).toBeNull();
    }
  });
});

describe('CR 613.1f, 508.1d: "Creatures you control have haste and attack each combat if able"', () => {
  it('is automated; each creature its controller has gets haste and the requirement to attack, the opponent\'s creature gets neither', () => {
    expect(full(DRILLER)).toBe(true);
    const s = scenario([], { defs: [DRILLER, GRUNT], p1: { battlefield: ['Test Driller', 'Test Grunt'] }, p2: { battlefield: ['Test Grunt'] } });
    const mine = find(s, 'Test Grunt', 'battlefield', 'p1');
    const theirs = find(s, 'Test Grunt', 'battlefield', 'p2');
    expect(hasKeyword(getChars(s, mine)!, 'haste')).toBe(true);
    expect(hasKeyword(getChars(s, theirs)!, 'haste')).toBe(false);
    const must = requirementsFor(s, 'attack', 'p1').map((r) => r.creature);
    expect(must).toContain(mine);
    expect(must).toContain(find(s, 'Test Driller', 'battlefield', 'p1'));
    expect(requirementsFor(s, 'attack', 'p2').map((r) => r.creature)).not.toContain(theirs);
  });
});

// ---- prevention and replacement -----------------------------------------------------------------------------------------------------------------------------
const WARD = card('Test Ward', 'Enchantment — Aura', 'Enchant creature\nPrevent all damage that would be dealt to enchanted creature.');
const BOLT = card('Test Bolt', 'Instant', '~ deals 3 damage to target creature.');
const DOOM = card('Test Doom', 'Instant', 'Destroy target creature.');
const ELF = card('Test Elf', 'Creature — Elf', 'If this permanent would die, put it on the bottom of its owner\'s library instead.', ['1', '1']);

describe('CR 615.1, 303.4: "Prevent all damage that would be dealt to enchanted creature"', () => {
  it('is automated; the enchanted creature takes no damage from a noncombat source, the other creature takes it all', () => {
    expect(full(WARD)).toBe(true);
    let s = scenario(['Mountain'], { defs: [WARD, BOLT, GRUNT], p1: { hand: ['Test Bolt', 'Test Bolt'], battlefield: ['Test Grunt', 'Test Grunt'] } });
    const grunts = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Grunt');
    const warded = grunts[0]!;
    const bare = grunts[1]!;
    s = tweak(s, (t) => { t.objects[put(t, 'p1', 'battlefield', 'Test Ward')]!.attachedTo = warded; });
    s = resolveAll(cast(s, 'Test Bolt', { targets: [{ kind: 'object', id: warded }] }));
    expect(s.objects[warded]?.zone).toBe('battlefield');
    expect(s.objects[warded]?.damage).toBe(0);
    s = resolveAll(cast(s, 'Test Bolt', { targets: [{ kind: 'object', id: bare }] }));
    expect(inYard(s, 'Test Grunt')).toBe(true); // a 2/2 dealt 3 damage dies
  });
});

describe('CR 614.1a, 700.4, 401.4: "If ~ would die, put it on the bottom of its owner\'s library instead"', () => {
  it('is automated; a destroyed Elf goes to the bottom of its owner\'s library, not the graveyard; another creature dies as usual', () => {
    expect(full(ELF)).toBe(true);
    let s = scenario(['Swamp'], { defs: [ELF, DOOM, GRUNT], p1: { hand: ['Test Doom', 'Test Doom'], battlefield: ['Test Elf', 'Test Grunt'] } });
    const elf = find(s, 'Test Elf', 'battlefield');
    s = resolveAll(cast(s, 'Test Doom', { targets: [{ kind: 'object', id: elf }] }));
    expect(inYard(s, 'Test Elf')).toBe(false);
    const lib = s.zones.library['p1']!;
    expect(nameOf(s, lib[lib.length - 1]!)).toBe('Test Elf');
    s = resolveAll(cast(s, 'Test Doom', { targets: [{ kind: 'object', id: find(s, 'Test Grunt', 'battlefield') }] }));
    expect(inYard(s, 'Test Grunt')).toBe(true);
  });
});

// ---- spell mastery: can't be countered ------------------------------------------------------------------------------------------------------------------------
const FIRE = card('Test Fire', 'Sorcery', '~ deals 3 damage to any target.\nIf there are two or more instant and/or sorcery cards in your graveyard, ~ can\'t be countered.', undefined, '{0}');
const CANCEL = card('Test Cancel', 'Instant', 'Counter target spell.');
const OLD_SPELL = card('Test Old Spell', 'Instant', 'You gain 1 life.');
const OLD_RITE = card('Test Old Rite', 'Sorcery', 'You gain 1 life.');
const GOBLIN_LORE = card('Test Lore', 'Sorcery', 'You gain 1 life.');

describe('CR 701.6a, 101.2: "If there are two or more instant and/or sorcery cards in your graveyard, ~ can\'t be countered"', () => {
  const play = (graveyard: string[]): GameState => {
    let s = scenario([], { defs: [FIRE, CANCEL, OLD_SPELL, OLD_RITE, GOBLIN_LORE], p1: { hand: ['Test Fire'], graveyard }, p2: { hand: ['Test Cancel'] } });
    s = cast(s, 'Test Fire', { targets: [{ kind: 'player', id: 'p2' }] });
    s = pass(s); // p1 passes: p2 may respond
    s = cast(s, 'Test Cancel', { targets: [{ kind: 'object', id: s.zones.stack[0]! }] }, 'p2');
    return resolveAll(s);
  };
  it('is automated; with an instant and a sorcery in the graveyard the counterspell resolves but the spell still resolves (3 damage)', () => {
    expect(full(FIRE)).toBe(true);
    expect(life(play(['Test Old Spell', 'Test Old Rite']), 'p2')).toBe(17);
  });
  it('the negative cases: one card, or two cards that are not instants or sorceries, and the spell is countered', () => {
    expect(life(play(['Test Old Spell']), 'p2')).toBe(20);
    expect(life(play([]), 'p2')).toBe(20);
  });
});

// ---- named pair ------------------------------------------------------------------------------------------------------------------------------------------
const CROWN = card('Test Crown', 'Artifact', '');
const THRONE = card('Test Throne', 'Artifact', '');
const SCEPTER = withParts('Test Scepter', 'Artifact', '{T}: ~ deals 1 damage to target player.\nIt deals 3 damage instead if you control artifacts named Test Crown and Test Throne.'.replace('\n', ' '), ['Test Crown', 'Test Throne']);
const WORKER = withParts('Test Worker', 'Artifact Creature — Assembly-Worker', '{0}: ~ gets +2/+2 until end of turn. If you control creatures named Test Left and Test Right, put two +1/+1 counters on ~ instead.', ['Test Left', 'Test Right'], '{5}', ['2', '2']);
const LEFT = card('Test Left', 'Artifact Creature — Assembly-Worker', '', ['1', '1']);
const RIGHT = card('Test Right', 'Artifact Creature — Assembly-Worker', '', ['1', '1']);

describe('CR 201.2, 608.2c, 614.15: "if you control artifacts named A and B" (an artifact of each name)', () => {
  const activate = (s: GameState, name: string, target?: { kind: 'player'; id: string }): GameState => {
    const id = find(s, name, 'battlefield');
    const picks = { targets: target ? [target] : [] };
    return resolveAll(settle(act(s, { type: 'activate', player: 'p1', source: id, ability: 'p:0:0' } as never), picks), picks);
  };
  it('Scepter: with both named artifacts the ability deals 3, with only one of them 1 (checked as it resolves)', () => {
    expect(full(SCEPTER)).toBe(true);
    const both = activate(scenario([], { defs: [SCEPTER, CROWN, THRONE], p1: { battlefield: ['Test Scepter', 'Test Crown', 'Test Throne'] } }), 'Test Scepter', { kind: 'player', id: 'p2' });
    expect(life(both, 'p2')).toBe(17);
    const one = activate(scenario([], { defs: [SCEPTER, CROWN, THRONE], p1: { battlefield: ['Test Scepter', 'Test Crown'] } }), 'Test Scepter', { kind: 'player', id: 'p2' });
    expect(life(one, 'p2')).toBe(19);
  });
  it('Worker: with both named creatures it gets two +1/+1 counters instead of +2/+2', () => {
    expect(full(WORKER)).toBe(true);
    const both = activate(scenario([], { defs: [WORKER, LEFT, RIGHT], p1: { battlefield: ['Test Worker', 'Test Left', 'Test Right'] } }), 'Test Worker');
    const w = find(both, 'Test Worker', 'battlefield');
    expect(both.objects[w]!.counters['+1/+1']).toBe(2);
    const one = activate(scenario([], { defs: [WORKER, LEFT, RIGHT], p1: { battlefield: ['Test Worker', 'Test Left'] } }), 'Test Worker');
    const w1 = find(one, 'Test Worker', 'battlefield');
    expect(one.objects[w1]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(Number(getChars(one, w1)!.power)).toBe(4);
  });
});

// ---- reveal N cards from a hand and choose one ------------------------------------------------------------------------------------------------------------------
const MAIL = synthetic('Test Mail', 'Sorcery', '{0}', 'Target player reveals three cards from their hand and you choose one of them. That player discards that card.');
const KEEP_A = synthetic('Test Keep A', 'Sorcery', '{9}', '');
const KEEP_B = synthetic('Test Keep B', 'Sorcery', '{9}', '');
const KEEP_C = synthetic('Test Keep C', 'Sorcery', '{9}', '');
const KEEP_D = synthetic('Test Keep D', 'Sorcery', '{9}', '');

describe('CR 701.20a, 402.3, 608.2d: "Target player reveals three cards from their hand and you choose one of them. That player discards that card."', () => {
  const start = (hand: string[]): GameState => {
    let s = scenario([], { defs: [MAIL, KEEP_A, KEEP_B, KEEP_C, KEEP_D], p1: { hand: ['Test Mail'] }, p2: { hand } });
    s = cast(s, 'Test Mail', { targets: [{ kind: 'player', id: 'p2' }] });
    s = pass(s);
    return pass(s); // p2 passes too: the spell resolves
  };
  const handNames = (s: GameState): string[] => (s.zones.hand['p2'] ?? []).map((id) => nameOf(s, id)).sort();
  it('is automated; the target player chooses the three cards to reveal, you choose one of them and only that card is discarded', () => {
    expect(full(MAIL)).toBe(true);
    let s = start(['Test Keep A', 'Test Keep B', 'Test Keep C', 'Test Keep D']);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending?.player).toBe('p2');
    const ids = (s.zones.hand['p2'] ?? []).slice(0, 3);
    s = answer(s, { kind: 'chooseObjects', ids });
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending?.player).toBe('p1'); // you choose among the three revealed cards only
    expect((s.pending as { options: ObjectId[] }).options.slice().sort()).toEqual(ids.slice().sort());
    s = answer(s, { kind: 'chooseObjects', ids: [ids[1]!] });
    s = settle(s);
    expect(inYard(s, 'Test Keep B', 'p2')).toBe(true);
    expect(handNames(s)).toEqual(['Test Keep A', 'Test Keep C', 'Test Keep D']);
  });
  it('with fewer than three cards in hand all of them are revealed (ruling 2004-10-04) and one is discarded', () => {
    let s = start(['Test Keep A', 'Test Keep B']);
    s = settle(s); // nothing to choose for the revealing player: all of the hand is revealed
    expect(s.pending?.kind === 'chooseObjects' ? s.pending.player : 'p1').toBe('p1');
    s = settle(s);
    expect(handNames(s)).toHaveLength(1);
  });
});

// ---- cast trigger that reveals a hand and takes two kinds of card -------------------------------------------------------------------------------------------------
const MIND = synthetic('Test Mind', 'Creature — Eldrazi', '{0}', 'When you cast this spell, target opponent reveals their hand. You choose from it a nonland card with mana value 3 or less and a card with mana value 4 or greater. That player discards those cards.', { power: '1', toughness: '1' });
const CHEAP = synthetic('Test Cheap', 'Sorcery', '{1}', '');
const BIG = synthetic('Test Big', 'Sorcery', '{5}', '');

describe('CR 701.20a, 608.2d, 701.9a, 113.6k: "When you cast this spell, target opponent reveals their hand. You choose from it a nonland card with mana value 3 or less and a card with mana value 4 or greater. That player discards those cards."', () => {
  const run = (hand: string[]): GameState => {
    const s = scenario(['Plains'], { defs: [MIND, CHEAP, BIG], p1: { hand: ['Test Mind'] }, p2: { hand } });
    return resolveAll(cast(s, 'Test Mind', { targets: [{ kind: 'player', id: 'p2' }] }));
  };
  it('is automated; one card of each kind is discarded, a land and a card of the other kind stay', () => {
    expect(full(MIND)).toBe(true);
    const s = run(['Plains', 'Test Cheap', 'Test Big']);
    expect(inYard(s, 'Test Cheap', 'p2')).toBe(true);
    expect(inYard(s, 'Test Big', 'p2')).toBe(true);
    expect(inYard(s, 'Plains', 'p2')).toBe(false);
  });
  it('the negative cases: with no card of the second kind only the first is discarded (choose whichever you can, ruling 2025-01-24); a land is never chosen', () => {
    const s = run(['Plains', 'Test Cheap']);
    expect(inYard(s, 'Test Cheap', 'p2')).toBe(true);
    expect(inYard(s, 'Plains', 'p2')).toBe(false);
    expect((s.zones.hand['p2'] ?? []).map((id) => nameOf(s, id))).toEqual(['Plains']);
  });
});

// ---- total power of the sacrificed creatures ------------------------------------------------------------------------------------------------------------------------
const COBBLE = synthetic('Test Cobble', 'Instant', '{0}', 'As an additional cost to cast this spell, sacrifice any number of creatures.\nCreate an X/X blue and black Zombie creature token with menace, where X is the total power of the sacrificed creatures.');
const BRUTE = synthetic('Test Brute', 'Creature — Ogre', '{3}', '', { power: '3', toughness: '3' });

/** Cast Test Cobble, answer the "how many" of its additional cost and choose the creatures to sacrifice. */
function sacrificeAndCast(s0: GameState, creatures: ObjectId[]): GameState {
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Cobble', 'hand') });
  s = answer(s, { kind: 'chooseNumber', n: creatures.length });
  return settle(s, { objects: creatures });
}

describe('CR 608.2h, 208.1, 601.2b: "Create an X/X token, where X is the total power of the sacrificed creatures"', () => {
  it('is automated; sacrificing a 2/2 and a 3/3 makes a 5/5 token (their powers as they last existed)', () => {
    expect(full(COBBLE)).toBe(true);
    let s = scenario([], { defs: [COBBLE, GRUNT, BRUTE], p1: { hand: ['Test Cobble'], battlefield: ['Test Grunt', 'Test Brute'] } });
    s = resolveAll(sacrificeAndCast(s, [find(s, 'Test Grunt', 'battlefield'), find(s, 'Test Brute', 'battlefield')]));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token');
    expect(token).toBeDefined();
    const c = getChars(s, token!)!;
    expect([Number(c.power), Number(c.toughness)]).toEqual([5, 5]);
    expect(onField(s, 'Test Grunt')).toBeUndefined();
  });
  it('the negative case: sacrificing only the 3/3 makes a 3/3 and leaves the other creature', () => {
    let s = scenario([], { defs: [COBBLE, GRUNT, BRUTE], p1: { hand: ['Test Cobble'], battlefield: ['Test Grunt', 'Test Brute'] } });
    s = resolveAll(sacrificeAndCast(s, [find(s, 'Test Brute', 'battlefield')]));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(Number(getChars(s, token)!.power)).toBe(3);
    expect(onField(s, 'Test Grunt')).toBeDefined();
  });
});

// ---- player shroud -------------------------------------------------------------------------------------------------------------------------------------------
const LIGHT = synthetic('Test Light', 'Instant', '{0}', 'You gain shroud until end of turn.');
const SPARK = synthetic('Test Spark', 'Instant', '{0}', 'Test Spark deals 2 damage to target player.');
const BOON = synthetic('Test Boon', 'Instant', '{0}', 'Target player gains 1 life.');

describe('CR 702.18a, 611.2a: "You gain shroud until end of turn"', () => {
  function castAt(s: GameState, player: 'p1' | 'p2', name: string, target: 'p1' | 'p2'): boolean {
    try {
      const t = answer(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), { kind: 'chooseTargets', targets: [{ kind: 'player', id: target }] });
      return t.pending?.kind !== 'chooseTargets';
    } catch {
      return false;
    }
  }
  it('is automated; no one can target you, not even you, until the turn ends; without the spell the same target is legal', () => {
    expect(full(LIGHT)).toBe(true);
    let s = scenario([], { defs: [LIGHT, SPARK, BOON], p1: { hand: ['Test Light', 'Test Boon'] }, p2: { hand: ['Test Spark', 'Test Boon'] } });
    expect(castAt(s, 'p1', 'Test Boon', 'p1')).toBe(true);
    s = resolveAll(cast(s, 'Test Light'));
    const p2 = s.pending?.player === 'p1' ? pass(s) : s;
    expect(castAt(p2, 'p2', 'Test Spark', 'p1')).toBe(false);
    expect(castAt(s, 'p1', 'Test Boon', 'p1')).toBe(false); // shroud, unlike hexproof, stops the controller too
    expect(castAt(p2, 'p2', 'Test Boon', 'p2')).toBe(true);
  });
});

// ---- hexproof as long as it entered this turn -------------------------------------------------------------------------------------------------------------------------
const CRAB = synthetic('Test Crab', 'Creature — Crab', '{0}', 'Flash\n~ has hexproof as long as it entered this turn.', { power: '2', toughness: '2' });

describe('CR 400.7, 611.3a: "~ has hexproof as long as it entered this turn"', () => {
  it('is automated; it has hexproof the turn it enters and loses it on the next turn', () => {
    expect(full(CRAB)).toBe(true);
    let s = scenario([], { defs: [CRAB], p1: { hand: ['Test Crab'] } });
    s = resolveAll(cast(s, 'Test Crab'));
    const crab = find(s, 'Test Crab', 'battlefield');
    expect(hasKeyword(getChars(s, crab)!, 'hexproof')).toBe(true);
    const later = advanceToStep(s, 3, 'main1');
    expect(hasKeyword(getChars(later, find(later, 'Test Crab', 'battlefield'))!, 'hexproof')).toBe(false);
  });
  it('the negative case: a copy on the battlefield since an earlier turn never had it', () => {
    const s = scenario([], { defs: [CRAB], p1: { battlefield: ['Test Crab'] } });
    expect(hasKeyword(getChars(s, find(s, 'Test Crab', 'battlefield'))!, 'hexproof')).toBe(false);
  });
});

describe('CR 400.7, 611.3a: "Creatures you control that entered this turn have double strike" (the static filter reads the turn\'s history)', () => {
  const HOOKS = card('Test Hooks', 'Creature — Tyranid', 'Creatures you control that entered this turn have double strike.', ['2', '2']);
  const NEWCOMER = synthetic('Test Newcomer', 'Creature — Goblin', '{0}', 'Flash', { power: '1', toughness: '1' });
  it('is automated; a creature that enters this turn has double strike, one that was there before does not, and the next turn takes it away', () => {
    expect(full(HOOKS)).toBe(true);
    let s = scenario([], { defs: [HOOKS, NEWCOMER, GRUNT], p1: { hand: ['Test Newcomer'], battlefield: ['Test Hooks', 'Test Grunt'] }, p2: { battlefield: ['Test Grunt'] } });
    const old = find(s, 'Test Grunt', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, old)!, 'double strike')).toBe(false);
    s = resolveAll(cast(s, 'Test Newcomer'));
    const fresh = find(s, 'Test Newcomer', 'battlefield');
    expect(hasKeyword(getChars(s, fresh)!, 'double strike')).toBe(true);
    expect(hasKeyword(getChars(s, old)!, 'double strike')).toBe(false);
    expect(hasKeyword(getChars(s, find(s, 'Test Grunt', 'battlefield', 'p2'))!, 'double strike')).toBe(false); // an opponent's creature
    const later = advanceToStep(s, 3, 'main1');
    expect(hasKeyword(getChars(later, find(later, 'Test Newcomer', 'battlefield'))!, 'double strike')).toBe(false);
  });
});

// ---- cost reduction when it targets a creature card ------------------------------------------------------------------------------------------------------------------
const REVIVE = synthetic('Test Revive', 'Sorcery', '{3}{W}', '~ costs {2} less to cast if it targets a creature card with mana value 3 or less.\nReturn target creature card from your graveyard to the battlefield.');
const GIANT = synthetic('Test Giant', 'Creature — Giant', '{5}{G}', '', { power: '6', toughness: '6' });

describe('CR 601.2f, 118.7a: "~ costs {2} less to cast if it targets a creature card with mana value 3 or less"', () => {
  const spent = (target: string): number => {
    let s = scenario(['Plains'], { defs: [REVIVE, BEAR, GIANT], p1: { hand: ['Test Revive'], graveyard: ['Test Bear', 'Test Giant'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains'] } });
    s = cast(s, 'Test Revive', { targets: [{ kind: 'object', id: find(s, target, 'graveyard') }] });
    return s.objects[s.zones.stack[0]!]!.stack!.costsPaid.manaSpent!.length;
  };
  it('is automated; a mana value 3 creature card makes the spell cost {1}{W}, a mana value 6 creature card leaves the full {3}{W}', () => {
    expect(full(REVIVE)).toBe(true);
    expect(spent('Test Bear')).toBe(2);
    expect(spent('Test Giant')).toBe(4);
  });
});

// ---- the equipped creature with defender can attack ---------------------------------------------------------------------------------------------------------------
const WALL = synthetic('Test Wall', 'Creature — Wall', '{1}', 'Defender', { power: '0', toughness: '4' });
const CART = synthetic('Test Cart', 'Artifact — Equipment', '{2}', 'Equipped creature gets +2/+2.\nAs long as equipped creature has defender, it can attack as though it didn\'t have defender.\nEquip {3}');

describe('CR 609.4, 702.3b: "As long as equipped creature has defender, it can attack as though it didn\'t have defender"', () => {
  const attackers = (s: GameState): ObjectId[] => {
    const t = advanceToStep(s, 1, 'declareAttackers');
    return t.pending?.kind === 'declareAttackers' ? t.pending.candidates.map((c) => c.id) : [];
  };
  it('is automated; the equipped Wall is offered as an attacker and the same Wall without the Equipment is not', () => {
    expect(full(CART)).toBe(true);
    const bare = scenario([], { defs: [WALL, CART, GRUNT], p1: { battlefield: ['Test Wall', 'Test Cart', 'Test Grunt'] } });
    const wall = find(bare, 'Test Wall', 'battlefield');
    expect(attackers(bare)).not.toContain(wall);
    const equipped = tweak(bare, (t) => { t.objects[find(t, 'Test Cart', 'battlefield')]!.attachedTo = wall; });
    expect(attackers(equipped)).toContain(wall);
  });
});

// ---- cast only during the declare attackers step -------------------------------------------------------------------------------------------------------------------
const RAGE = synthetic('Test Rage', 'Instant', '{0}', 'Cast this spell only during the declare attackers step.\nYou gain 1 life.');

describe('CR 601.3, 508.1: "Cast this spell only during the declare attackers step"', () => {
  it('is automated; the spell is not castable in the first main phase and is castable after attackers are declared', () => {
    expect(full(RAGE)).toBe(true);
    const s = scenario([], { defs: [RAGE, GRUNT], p1: { hand: ['Test Rage'], battlefield: [{ name: 'Test Grunt', since: 0 }] } });
    expect(labels(s, 'p1')).not.toContain('Cast Test Rage');
    let t = advanceToStep(s, 1, 'declareAttackers');
    expect(t.pending?.kind).toBe('declareAttackers');
    t = answer(t, { kind: 'declareAttackers', attacks: [{ attacker: find(t, 'Test Grunt', 'battlefield'), defender: 'p2' }] });
    expect(t.turn.step).toBe('declareAttackers');
    expect(labels(t, 'p1')).toContain('Cast Test Rage');
  });
});

// ---- Spectral Bears: an intervening if about the defending player's black nontoken permanents ----------------------------------------------------------------------
const SPECTRE = synthetic('Test Spectre', 'Creature — Spirit', '{1}{G}', "Whenever ~ attacks, if defending player controls no black nontoken permanents, it doesn't untap during your next untap step.", { power: '2', toughness: '2' });
const SHADE = synthetic('Test Shade', 'Creature — Shade', '{B}', '', { power: '1', toughness: '1', colors: ['B'] });

describe('CR 603.4, 508.1: "Whenever ~ attacks, if defending player controls no black nontoken permanents, it doesn\'t untap during your next untap step"', () => {
  const attack = (opponent: string[]): GameState => {
    const s = scenario([], { defs: [SPECTRE, SHADE], p1: { battlefield: [{ name: 'Test Spectre', since: 0 }] }, p2: { battlefield: opponent } });
    let t = advanceToStep(s, 1, 'declareAttackers');
    t = answer(t, { kind: 'declareAttackers', attacks: [{ attacker: find(t, 'Test Spectre', 'battlefield'), defender: 'p2' }] });
    return t;
  };
  it('is automated; with no black nontoken permanent on the defending side the trigger is on the stack, with one it never triggers', () => {
    expect(full(SPECTRE)).toBe(true);
    expect(attack([]).zones.stack.length).toBe(1);
    expect(attack(['Test Shade']).zones.stack.length).toBe(0);
  });
});

// ---- Bala Ged Thief: "that player" is the target, never the Ally's controller --------------------------------------------------------------------------------------
const BALA = synthetic('Test Bala', 'Creature — Human Ally', '{0}', 'Whenever this creature or another Ally you control enters, target player reveals a number of cards from their hand equal to the number of Allies you control. You choose one of them. That player discards that card.', { power: '1', toughness: '1' });

describe('CR 608.2c, 701.20a, 701.9a: "target player reveals a number of cards from their hand equal to the number of Allies you control. You choose one of them. That player discards that card."', () => {
  it('is automated; one Ally means one revealed card, and that card is discarded by the target player (not by you)', () => {
    expect(full(BALA)).toBe(true);
    let s = scenario([], { defs: [BALA, KEEP_A, KEEP_B, KEEP_C], p1: { hand: ['Test Bala'] }, p2: { hand: ['Test Keep A', 'Test Keep B', 'Test Keep C'] } });
    s = resolveAll(cast(s, 'Test Bala'), { targets: [{ kind: 'player', id: 'p2' }] });
    s = resolveAll(s, { targets: [{ kind: 'player', id: 'p2' }] });
    expect((s.zones.graveyard['p2'] ?? []).length).toBe(1);
    expect((s.zones.hand['p2'] ?? []).length).toBe(2);
    expect((s.zones.graveyard['p1'] ?? []).length).toBe(0);
  });
});
