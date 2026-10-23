/**
 * FAST4 T33: the shapes of parser/templates/zz-fast4/t33.json (and the hole, anaphora and renderer additions that let existing templates read their cards),
 * played through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 509.1b, 506.2, 509.1a  "~ can't be blocked as long as defending player controls an artifact" (the blocker's controller is the defending player)
 *   CR 509.1b, 611.3a         "~ can't be blocked as long as there are three or more cards in your graveyard", "... if you've cast two or more spells this turn"
 *   CR 508.1c                 "~ can't attack unless you control another artifact"
 *   CR 509.1a, 611.2a         "{1}: ~ can block an additional creature this turn"; "Each creature you control can block an additional creature each combat"
 *   CR 509.1c, 608.2d         "you may have target creature block it this turn if able" (the object itself, or the attacking equipped creature)
 *   CR 509.1c, 613.4c         "Target creature gets +3/+3 until end of turn and must be blocked this turn if able"
 *   CR 509.1, 603.2           "the blocking creature gets +1/+1 until end of turn" (blocks / becomes blocked by)
 *   CR 508.1b-c, 506.2        "Creatures with flying can't attack you or planeswalkers you control"; the Aura that pumps and "can't attack you or ..."
 *   CR 602.5, 605.1a          "Enchanted creature's activated abilities can't be activated"; "... can't attack or block, and its activated abilities can't
 *                             be activated unless they're mana abilities"
 *   CR 613.1f, 502.3, 122.6   "loses all abilities and can't become untapped"; "can't become untapped and can't have counters put on it"
 *   CR 205.1a, 305.7, 613.4b  "is a Treefolk with base power and toughness 0/4 and loses all abilities"; "is a colorless Forest land"; "loses all abilities
 *                             and is a colorless Frog with base power and toughness 1/1"
 *   CR 700.9, 122.1           "Modified creatures you control have trample"; "Creatures you control with +1/+1 counters on them have trample"
 *   CR 113.6, 604.1           "As long as ~ is in your graveyard and you control a Forest, creatures you control have trample"
 *   CR 702.14c                "Equipped creature has nonbasic landwalk"
 *   CR 509.1b, 611.2c         "Target creature you control with power 2 or less gains lifelink until end of turn and can't be blocked this turn"
 *   CR 303.4, 301.5, 700.9    target restrictions: "other than enchanted creature", "attacking equipped", "modified"
 *   CR 120.3, 611.2a          "{R}: ~ gets +1/+0 until end of turn and deals 1 damage to you"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DeclareAttackersDecision, type DeclareBlockersDecision, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, legal, life, pass, put, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, passUntil, toDeclareAttackers, toDeclareBlockers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const kw = (s: GameState, id: ObjectId, k: string): boolean => hasKeyword(getChars(s, id)!, k);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
/** No ability of the card left manual (the T33 templates are experimental, so the card level is capped at partial, design 6.9). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));

/** Answer the decisions that come up (costs automatically, `targets` when asked, yes/no with `yes`); stop at priority. */
function settle(s0: GameState, targets: TargetChoice[] = [], yes = true): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets });
    else if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty. */
function resolveAll(s0: GameState, targets: TargetChoice[] = []): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, targets);
  return s;
}
const castWith = (s0: GameState, name: string, targets: TargetChoice[] = [], player = 'p1'): GameState => settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) }), targets);
function activate(s: GameState, name: string, player = 'p1', targets: TargetChoice[] = []): GameState {
  const id = find(s, name, 'battlefield', player);
  const la = legal(s, player, 'activate').find((a) => a.object === id && !a.isMana);
  if (!la) throw new Error(`no activated ability of ${name}`);
  return settle(act(s, la.action), targets);
}
/** A permanent of `owner` put onto the battlefield attached to `to`. */
const attachNew = (s: GameState, name: string, to: ObjectId, owner = 'p1'): GameState => tweak(s, (t) => { const id = put(t, owner, 'battlefield', name); t.objects[id]!.attachedTo = to; });
const blockers = (s: GameState): DeclareBlockersDecision => s.pending as DeclareBlockersDecision;
const attackers = (s: GameState): DeclareAttackersDecision => s.pending as DeclareAttackersDecision;
/** Can `blocker` block `attacker` in the pending declare-blockers decision? No decision at all: nothing could block (CR 509.1a). */
const canBlock = (s: GameState, blocker: ObjectId, attacker: ObjectId): boolean => s.pending?.kind === 'declareBlockers' && blockers(s).candidates.some((c) => c.id === blocker && c.attackers.includes(attacker));
/** The active player attacks with `ids`; the state at the declare-blockers decision, or where combat went on without one (nothing could block). */
const attackWith = (s: GameState, ids: ObjectId[], defender?: string): GameState =>
  passUntil(declareAttackers(toDeclareAttackers(s), ids.map((id) => (defender ? [id, defender] : [id]) as [ObjectId])), (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'the declare blockers decision or combat damage');
const rejected = (s: GameState, f: (s: GameState) => GameState): boolean => { try { f(s); return false; } catch (e) { return /rejected/i.test(String(e)); } };

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}', ['G']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['3', '3'], '{2}{R}', ['R']);
const RELIC = card('Test Relic', 'Artifact', '', undefined, '{1}');
const POLE = card('Test Pole', 'Artifact — Equipment', 'Equip {1}', undefined, '{1}');
const CHARM = card('Test Charm', 'Enchantment — Aura', 'Enchant creature', undefined, '{W}');
const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.', undefined, '{0}');
const RUINS = card('Test Ruins', 'Land', '{T}: Add {C}.');

describe('CR 509.1b, 506.2, 509.1a: "can\'t be blocked as long as defending player controls an artifact"', () => {
  const SERPENT = card('Test Serpent', 'Creature — Serpent', "Test Serpent can't be blocked as long as defending player controls an artifact.", ['4', '4']);
  it('is automated', () => expect(automated(SERPENT)).toBe(true));
  it('the defending player (the controller of the would-be blocker) controls an artifact: no block; without one: it can be blocked', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Serpent'] }, p2: { battlefield: ['Test Bear', 'Test Relic'] }, defs: [SERPENT, BEAR, RELIC] });
    const serpent = find(s0, 'Test Serpent', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = attackWith(s0, [serpent]);
    expect(canBlock(s, bear, serpent)).toBe(false);
    expect(rejected(s, (x) => declareBlockers(x, [[bear, serpent]]))).toBe(true);
    const t0 = tweak(s0, (t) => { const relic = t.zones.battlefield.find((id) => t.objects[id]!.defId === 'Test Relic')!; t.objects[relic]!.controller = 'p1'; t.objects[relic]!.owner = 'p1'; });
    const t = attackWith(t0, [serpent]);
    expect(canBlock(t, bear, serpent)).toBe(true); // an artifact of the attacking player does not count
  });
});

describe('CR 509.1b, 611.3a: conditional evasion of the object itself', () => {
  const INKLING = card('Test Inkling', 'Creature — Octopus', "Test Inkling can't be blocked as long as there are three or more cards in your graveyard.", ['1', '1']);
  const SPRITE = card('Test Sprite', 'Creature — Faerie', "Test Sprite can't be blocked if you've cast two or more spells this turn.", ['1', '1']);
  it('both are automated', () => { expect(automated(INKLING)).toBe(true); expect(automated(SPRITE)).toBe(true); });
  it('three cards in its controller\'s graveyard: unblockable; two: blockable (a live count, CR 611.3a)', () => {
    const base = { p2: { battlefield: ['Test Bear'] }, defs: [INKLING, BEAR, FILLER] };
    const three = scenario([], { p1: { battlefield: ['Test Inkling'], graveyard: ['Test Filler', 'Test Filler', 'Test Filler'] }, ...base });
    const two = scenario([], { p1: { battlefield: ['Test Inkling'], graveyard: ['Test Filler', 'Test Filler'] }, ...base });
    const a = attackWith(three, [find(three, 'Test Inkling', 'battlefield')]);
    expect(canBlock(a, find(a, 'Test Bear', 'battlefield'), find(a, 'Test Inkling', 'battlefield'))).toBe(false);
    const b = attackWith(two, [find(two, 'Test Inkling', 'battlefield')]);
    expect(canBlock(b, find(b, 'Test Bear', 'battlefield'), find(b, 'Test Inkling', 'battlefield'))).toBe(true);
  });
  it('CR 601.2i: two spells cast by its controller this turn make it unblockable; one does not; the opponent\'s spells do not count', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Sprite'], hand: ['Test Filler', 'Test Filler'] }, p2: { battlefield: ['Test Bear'] }, defs: [SPRITE, BEAR, FILLER] });
    const one = resolveAll(castWith(s0, 'Test Filler'));
    const a = attackWith(one, [find(one, 'Test Sprite', 'battlefield')]);
    expect(canBlock(a, find(a, 'Test Bear', 'battlefield'), find(a, 'Test Sprite', 'battlefield'))).toBe(true);
    const two = resolveAll(castWith(one, 'Test Filler'));
    const b = attackWith(two, [find(two, 'Test Sprite', 'battlefield')]);
    expect(canBlock(b, find(b, 'Test Bear', 'battlefield'), find(b, 'Test Sprite', 'battlefield'))).toBe(false);
    const theirs = tweak(s0, (t) => { t.players.find((p) => p.id === 'p2')!.turnStats.spellsCast = 3; });
    const c = attackWith(theirs, [find(theirs, 'Test Sprite', 'battlefield')]);
    expect(canBlock(c, find(c, 'Test Bear', 'battlefield'), find(c, 'Test Sprite', 'battlefield'))).toBe(true);
  });
});

describe('CR 508.1c: "~ can\'t attack unless you control another artifact"', () => {
  const MOUSER = card('Test Mouser', 'Artifact Creature — Robot', "Test Mouser can't attack unless you control another artifact.", ['2', '1']);
  it('is automated; alone it can\'t attack, with another artifact of its controller it can (not the opponent\'s)', () => {
    expect(automated(MOUSER)).toBe(true);
    const alone = toDeclareAttackers(scenario([], { p1: { battlefield: ['Test Mouser', 'Test Bear'] }, p2: { battlefield: ['Test Relic'] }, defs: [MOUSER, BEAR, RELIC] }));
    const mouser = find(alone, 'Test Mouser', 'battlefield');
    expect(attackers(alone).candidates.map((c) => c.id)).not.toContain(mouser);
    const withRelic = toDeclareAttackers(scenario([], { p1: { battlefield: ['Test Mouser', 'Test Relic'] }, defs: [MOUSER, RELIC] }));
    expect(attackers(withRelic).candidates.map((c) => c.id)).toContain(find(withRelic, 'Test Mouser', 'battlefield'));
  });
});

describe('CR 509.1a, 611.2a: blocking an additional creature', () => {
  const WARDEN = card('Test Warden', 'Creature — Human', '{1}: Test Warden can block an additional creature this turn.', ['1', '4']);
  const SANDS = card('Test Sands', 'Enchantment', 'Each creature you control can block an additional creature each combat.');
  it('both are automated', () => { expect(automated(WARDEN)).toBe(true); expect(automated(SANDS)).toBe(true); });
  it('after the activation the creature blocks two attackers this turn; without it one', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Warden', 'Plains'] }, defs: [WARDEN, BEAR, OGRE] });
    const [bear, ogre] = [find(s0, 'Test Bear', 'battlefield'), find(s0, 'Test Ogre', 'battlefield')];
    const warden = find(s0, 'Test Warden', 'battlefield');
    const plain = attackWith(s0, [bear, ogre]);
    expect(blockers(plain).candidates.find((c) => c.id === warden)!.maxBlocks).toBe(1);
    expect(rejected(plain, (x) => declareBlockers(x, [[warden, bear], [warden, ogre]]))).toBe(true);
    const activated = resolveAll(activate(pass(s0), 'Test Warden', 'p2'));
    const s = attackWith(activated, [bear, ogre]);
    expect(blockers(s).candidates.find((c) => c.id === warden)!.maxBlocks).toBe(2);
    const t = declareBlockers(s, [[warden, bear], [warden, ogre]]);
    expect(t.combat!.blockers.find((b) => b.id === warden)!.blocking.sort()).toEqual([bear, ogre].sort());
  });
  it('each creature of the enchantment\'s controller can block two attackers; the attacking player\'s creatures are not affected', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Ogre', 'Test Sands'] }, p2: { battlefield: ['Test Warden', 'Test Sands'] }, defs: [WARDEN, BEAR, OGRE, SANDS] });
    const s = attackWith(s0, [find(s0, 'Test Bear', 'battlefield'), find(s0, 'Test Ogre', 'battlefield')]);
    expect(blockers(s).candidates.find((c) => c.id === find(s0, 'Test Warden', 'battlefield'))!.maxBlocks).toBe(2);
    const only = scenario([], { p1: { battlefield: ['Test Bear', 'Test Ogre', 'Test Sands'] }, p2: { battlefield: ['Test Warden'] }, defs: [WARDEN, BEAR, OGRE, SANDS] });
    const t = attackWith(only, [find(only, 'Test Bear', 'battlefield'), find(only, 'Test Ogre', 'battlefield')]);
    expect(blockers(t).candidates.find((c) => c.id === find(only, 'Test Warden', 'battlefield'))!.maxBlocks).toBe(1);
  });
});

describe('CR 509.1c, 608.2d: "you may have target creature block it this turn if able"', () => {
  const BEETLE = card('Test Beetle', 'Creature — Insect', 'Haste\nWhen Test Beetle enters, you may have target creature block it this turn if able.', ['3', '3'], '{0}');
  const HOOK = card('Test Hook', 'Artifact — Equipment', 'Whenever equipped creature attacks, you may have target creature block it this turn if able.\nEquip {4}', undefined, '{4}');
  it('both are automated', () => { expect(automated(BEETLE)).toBe(true); expect(automated(HOOK)).toBe(true); });
  it('the target must block the object itself (CR 509.1c): no block is not a legal declaration, blocking another attacker is not either', () => {
    const s0 = scenario([], { p1: { hand: ['Test Beetle'], battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Bear'] }, defs: [BEETLE, BEAR, OGRE] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = resolveAll(castWith(s0, 'Test Beetle'), [obj(bear)]);
    const beetle = find(s1, 'Test Beetle', 'battlefield');
    const ogre = find(s1, 'Test Ogre', 'battlefield');
    const s = attackWith(s1, [beetle, ogre]);
    expect(rejected(s, (x) => declareBlockers(x, []))).toBe(true);
    expect(rejected(s, (x) => declareBlockers(x, [[bear, ogre]]))).toBe(true);
    expect(declareBlockers(s, [[bear, beetle]]).combat!.blockers.find((b) => b.id === bear)!.blocking).toEqual([beetle]);
  });
  it('declined ("you may"), nothing is required', () => {
    const s0 = scenario([], { p1: { hand: ['Test Beetle'] }, p2: { battlefield: ['Test Bear'] }, defs: [BEETLE, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    let s1 = castWith(s0, 'Test Beetle');
    for (let g = 0; s1.zones.stack.length > 0 && g < 30; g++) s1 = settle(s1.pending?.kind === 'priority' ? pass(s1) : s1, [obj(bear)], false);
    const s = attackWith(s1, [find(s1, 'Test Beetle', 'battlefield')]);
    expect(declareBlockers(s, []).combat!.blockers).toEqual([]);
  });
  it('the Equipment\'s "it" is the equipped creature that attacks, never the Equipment or the target', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ogre', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [HOOK, BEAR, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = attachNew(s0, 'Test Hook', ogre);
    let s = declareAttackers(toDeclareAttackers(s1), [[ogre], [mine]]);
    s = settle(s, [obj(theirs)]);
    s = toDeclareBlockers(resolveAll(s, [obj(theirs)]));
    expect(rejected(s, (x) => declareBlockers(x, [[theirs, mine]]))).toBe(true);
    expect(declareBlockers(s, [[theirs, ogre]]).combat!.blockers[0]!.blocking).toEqual([ogre]);
  });
});

describe('CR 509.1c, 613.4c: "Target creature gets +3/+3 until end of turn and must be blocked this turn if able"', () => {
  const DUEL = card('Test Duel', 'Sorcery', 'Target creature gets +3/+3 until end of turn and must be blocked this turn if able.', undefined, '{0}');
  it('is automated; the creature is 5/5 and must be blocked by a creature that can block it', () => {
    expect(automated(DUEL)).toBe(true);
    const s0 = scenario([], { p1: { hand: ['Test Duel'], battlefield: ['Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Bear'] }, defs: [DUEL, BEAR, OGRE] });
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = resolveAll(castWith(s0, 'Test Duel', [obj(mine)]));
    expect(pt(s1, mine)).toBe('5/5');
    const s = attackWith(s1, [mine, find(s1, 'Test Ogre', 'battlefield')]);
    expect(rejected(s, (x) => declareBlockers(x, []))).toBe(true);
    expect(rejected(s, (x) => declareBlockers(x, [[theirs, find(s1, 'Test Ogre', 'battlefield')]]))).toBe(true);
    expect(declareBlockers(s, [[theirs, mine]]).combat!.blockers.length).toBe(1);
  });
});

describe('CR 509.1, 603.2: "the blocking creature" of a block trigger', () => {
  const INDIGNATION = card('Test Indignation', 'Enchantment', 'Whenever a creature blocks a red creature, the blocking creature gets +1/+1 until end of turn.');
  const HOST = card('Test Host', 'Creature — Knight', 'Whenever Test Host becomes blocked by a creature, the blocking creature gets -1/-1 until end of turn.', ['3', '3']);
  it('both are automated', () => { expect(automated(INDIGNATION)).toBe(true); expect(automated(HOST)).toBe(true); });
  it('the blocker of a red attacker gets +1/+1, not the attacker', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Ogre'] }, p2: { battlefield: ['Test Bear', 'Test Indignation'] }, defs: [INDIGNATION, BEAR, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = resolveAll(declareBlockers(attackWith(s0, [ogre]), [[bear, ogre]]));
    expect(pt(s, bear)).toBe('3/3');
    expect(pt(s, ogre)).toBe('3/3');
  });
  it('the creature blocking the Knight gets -1/-1, not the Knight', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Host'] }, p2: { battlefield: ['Test Ogre'] }, defs: [HOST, OGRE] });
    const host = find(s0, 'Test Host', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const s = resolveAll(declareBlockers(attackWith(s0, [host]), [[ogre, host]]));
    expect(pt(s, ogre)).toBe('2/2');
    expect(pt(s, host)).toBe('3/3');
  });
});

describe('CR 508.1b-c, 506.2: "can\'t attack you or planeswalkers you control"', () => {
  const WURMS = card('Test Wurm Field', 'Enchantment', "Creatures with flying can't attack you or planeswalkers you control.");
  const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '1']);
  const VOW = card('Test Vow', 'Enchantment — Aura', "Enchant creature\nEnchanted creature gets +2/+2, has vigilance, and can't attack you or planeswalkers you control.", undefined, '{2}{W}');
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.', undefined, '{3}');
  it('both are automated', () => { expect(automated(WURMS)).toBe(true); expect(automated(VOW)).toBe(true); });
  it('a creature with flying can attack neither the enchantment\'s controller nor their planeswalker; one without flying can', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Bird', 'Test Bear'] }, p2: { battlefield: ['Test Wurm Field', { name: 'Test Walker', counters: { loyalty: 3 } }] }, defs: [WURMS, BIRD, BEAR, WALKER] });
    const s = toDeclareAttackers(s0);
    const ids = attackers(s).candidates.map((c) => c.id);
    expect(ids).not.toContain(find(s, 'Test Bird', 'battlefield'));
    expect(attackers(s).candidates.find((c) => c.id === find(s, 'Test Bear', 'battlefield'))!.defenders.sort()).toEqual(['p2', find(s, 'Test Walker', 'battlefield')].sort());
    expect(rejected(s, (x) => declareAttackers(x, [[find(s, 'Test Bird', 'battlefield'), 'p2']]))).toBe(true);
  });
  it('the enchanted creature of the opponent gets +2/+2 and vigilance and can\'t attack the Aura\'s controller', () => {
    const s0 = scenario([], { p2: { battlefield: ['Test Bear', 'Test Ogre'] }, defs: [VOW, BEAR, OGRE] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = attachNew(s0, 'Test Vow', bear, 'p1');
    expect(pt(s1, bear)).toBe('4/4');
    expect(kw(s1, bear, 'vigilance')).toBe(true);
    const s = passUntil(s1, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', 'p2 declares attackers', 200);
    expect(attackers(s).candidates.map((c) => c.id)).not.toContain(bear);
    expect(attackers(s).candidates.map((c) => c.id)).toContain(find(s, 'Test Ogre', 'battlefield'));
  });
});

describe('CR 602.5, 605.1a: activated abilities of the enchanted creature', () => {
  const TOUCH = card('Test Touch', 'Enchantment — Aura', "Enchant creature\nEnchanted creature's activated abilities can't be activated.", undefined, '{1}{U}');
  const FETTERS = card('Test Fetters', 'Enchantment — Aura', "Enchant permanent\nEnchanted permanent can't attack or block, and its activated abilities can't be activated unless they're mana abilities.", undefined, '{3}{W}');
  const DRUID = card('Test Druid', 'Creature — Elf Druid', '{T}: Add {G}.\n{1}: Test Druid gets +1/+1 until end of turn.', ['1', '1']);
  it('both are automated', () => { expect(automated(TOUCH)).toBe(true); expect(automated(FETTERS)).toBe(true); });
  it('"can\'t be activated": neither the mana ability nor the other one (CR 605.1a: a mana ability is an activated ability)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Druid', 'Plains'] }, defs: [TOUCH, DRUID] });
    const druid = find(s0, 'Test Druid', 'battlefield');
    expect(legal(s0, 'p1', 'activate').filter((a) => a.object === druid).length).toBe(2);
    const s = attachNew(s0, 'Test Touch', druid, 'p2');
    expect(legal(s, 'p1', 'activate').filter((a) => a.object === druid)).toEqual([]);
  });
  it('"unless they\'re mana abilities": the mana ability stays, the other is gone; it can\'t attack or block', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Druid', 'Plains'] }, p2: { battlefield: ['Test Ogre'] }, defs: [FETTERS, DRUID, OGRE] });
    const druid = find(s0, 'Test Druid', 'battlefield');
    const s = attachNew(s0, 'Test Fetters', druid, 'p2');
    const acts = legal(s, 'p1', 'activate').filter((a) => a.object === druid);
    expect(acts.length).toBe(1);
    expect(acts[0]!.isMana).toBe(true);
    expect(attackers(toDeclareAttackers(s)).candidates.map((c) => c.id)).not.toContain(druid);
    const ogre = find(s, 'Test Ogre', 'battlefield');
    const t = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', 'p2 declares attackers', 200);
    const b = attackWith(t, [ogre], 'p1');
    expect(canBlock(b, druid, ogre)).toBe(false);
  });
});

describe('CR 613.1f, 502.3, 122.6: "can\'t become untapped"', () => {
  const ICE = card('Test Ice', 'Enchantment — Aura', "Enchant creature\nEnchanted creature loses all abilities and can't become untapped.", undefined, '{2}{U}');
  const BIND = card('Test Bind', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't become untapped and can't have counters put on it.", undefined, '{1}{U}');
  const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', ['1', '1']);
  const GROW = card('Test Grow', 'Sorcery', 'Put a +1/+1 counter on target creature.', undefined, '{0}');
  it('both are automated', () => { expect(automated(ICE)).toBe(true); expect(automated(BIND)).toBe(true); });
  it('the tapped creature loses flying and stays tapped through its controller\'s untap step', () => {
    const s0 = scenario([], { p2: { battlefield: [{ name: 'Test Bird', tapped: true }] }, defs: [ICE, BIRD] });
    const bird = find(s0, 'Test Bird', 'battlefield');
    const s1 = attachNew(s0, 'Test Ice', bird);
    expect(kw(s1, bird, 'flying')).toBe(false);
    const s = passUntil(s1, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1', 'p2 main phase', 200);
    expect(s.objects[bird]!.tapped).toBe(true);
    const free = passUntil(s0, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1', 'p2 main phase', 200);
    expect(free.objects[bird]!.tapped).toBe(false);
  });
  it('a counter can\'t be put on it, and it stays tapped', () => {
    const s0 = scenario([], { p1: { hand: ['Test Grow'] }, p2: { battlefield: [{ name: 'Test Bear', tapped: true }] }, defs: [BIND, BEAR, GROW] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s1 = resolveAll(castWith(attachNew(s0, 'Test Bind', bear), 'Test Grow', [obj(bear)]));
    expect(s1.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
    const s = passUntil(s1, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1', 'p2 main phase', 200);
    expect(s.objects[bear]!.tapped).toBe(true);
  });
});

describe('CR 205.1a, 305.7, 613.1d-f, 613.4b: type-changing Auras', () => {
  const LIGN = card('Test Lign', 'Kindred Enchantment — Treefolk Aura', 'Enchant creature\nEnchanted creature is a Treefolk with base power and toughness 0/4 and loses all abilities.', undefined, '{1}{G}');
  const SONG = card('Test Song', 'Enchantment — Aura', 'Enchant permanent\nEnchanted permanent is a colorless Forest land.', undefined, '{2}{G}');
  const FROG = card('Test Frogify', 'Enchantment — Aura', 'Flash\nEnchant creature\nEnchanted creature loses all abilities and is a colorless Frog with base power and toughness 1/1.', undefined, '{1}{U}');
  const DRAKE = card('Test Drake', 'Creature — Drake Wizard', 'Flying\n{T}: You gain 1 life.', ['3', '3'], '{2}{U}{R}', ['U', 'R']);
  it('all three are automated', () => { expect(automated(LIGN)).toBe(true); expect(automated(SONG)).toBe(true); expect(automated(FROG)).toBe(true); });
  it('a 0/4 Treefolk with no other creature type and no abilities, still blue and red', () => {
    const s0 = scenario([], { p2: { battlefield: ['Test Drake'] }, defs: [LIGN, DRAKE] });
    const drake = find(s0, 'Test Drake', 'battlefield');
    const s = attachNew(s0, 'Test Lign', drake);
    const c = getChars(s, drake)!;
    expect(pt(s, drake)).toBe('0/4');
    expect(c.subtypes).toEqual(['Treefolk']);
    expect(c.types).toEqual(['Creature']);
    expect(kw(s, drake, 'flying')).toBe(false);
    expect(c.abilities.filter((a) => a.def.kind === 'activated')).toEqual([]);
    expect(c.colors.sort()).toEqual(['R', 'U']);
  });
  it('a colorless Forest land: no longer a creature, no rules text, the Forest\'s mana ability (CR 305.7)', () => {
    const s0 = scenario([], { p2: { battlefield: ['Test Drake'] }, defs: [SONG, DRAKE] });
    const drake = find(s0, 'Test Drake', 'battlefield');
    const s = attachNew(s0, 'Test Song', drake);
    const c = getChars(s, drake)!;
    expect(c.types).toEqual(['Land']);
    expect(c.subtypes).toEqual(['Forest']);
    expect(c.colors).toEqual([]);
    expect(kw(s, drake, 'flying')).toBe(false);
    const activated = c.abilities.filter((a) => a.def.kind === 'activated');
    expect(activated.length).toBe(1);
    expect((activated[0]!.def as { isMana?: boolean }).isMana).toBe(true);
    expect(JSON.stringify(activated[0]!.def)).toContain('"G"');
  });
  it('a colorless 1/1 Frog with no abilities', () => {
    const s0 = scenario([], { p2: { battlefield: ['Test Drake'] }, defs: [FROG, DRAKE] });
    const drake = find(s0, 'Test Drake', 'battlefield');
    const s = attachNew(s0, 'Test Frogify', drake);
    const c = getChars(s, drake)!;
    expect(pt(s, drake)).toBe('1/1');
    expect(c.subtypes).toEqual(['Frog']);
    expect(c.colors).toEqual([]);
    expect(c.abilities.filter((a) => a.def.kind === 'activated' || a.def.kind === 'keyword')).toEqual([]);
  });
});

describe('CR 700.9, 122.1: modified creatures and creatures with +1/+1 counters', () => {
  const KODAMA = card('Test Kodama', 'Legendary Creature — Spirit', 'Modified creatures you control have trample.', ['2', '3'], '{2}{G}');
  const REGIMEN = card('Test Regimen', 'Enchantment', 'Creatures you control with +1/+1 counters on them have trample.', undefined, '{3}{G}');
  it('both are automated', () => { expect(automated(KODAMA)).toBe(true); expect(automated(REGIMEN)).toBe(true); });
  it('a counter, an Equipment, or an Aura its controller controls makes it modified; an opponent\'s Aura does not; plain is not', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Kodama', { name: 'Test Bear', counters: { '-1/-1': 1 } }, 'Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] }, defs: [KODAMA, BEAR, POLE, CHARM] });
    const bears = s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Test Bear');
    let s = attachNew(s0, 'Test Pole', bears[1]!);
    s = attachNew(s, 'Test Charm', bears[2]!, 'p1');
    s = attachNew(s, 'Test Charm', bears[3]!, 'p2');
    expect(bears.map((b) => kw(s, b, 'trample'))).toEqual([true, true, true, false, false]);
    expect(kw(s, find(s, 'Test Kodama', 'battlefield'), 'trample')).toBe(false);
  });
  it('+1/+1 counters give trample; a -1/-1 counter does not; the opponent\'s creatures are not affected', () => {
    const s = scenario([], { p1: { battlefield: ['Test Regimen', { name: 'Test Bear', counters: { '+1/+1': 1 } }, { name: 'Test Ogre', counters: { '-1/-1': 1 } }] }, p2: { battlefield: [{ name: 'Test Bear', counters: { '+1/+1': 2 } }] }, defs: [REGIMEN, BEAR, OGRE] });
    expect(kw(s, find(s, 'Test Bear', 'battlefield', 'p1'), 'trample')).toBe(true);
    expect(kw(s, find(s, 'Test Ogre', 'battlefield', 'p1'), 'trample')).toBe(false);
    expect(kw(s, find(s, 'Test Bear', 'battlefield', 'p2'), 'trample')).toBe(false);
  });
});

describe('CR 113.6, 604.1: a static ability that functions from the graveyard', () => {
  const BRAWNY = card('Test Brawny', 'Creature — Incarnation', 'As long as Test Brawny is in your graveyard and you control a Forest, creatures you control have trample.', ['3', '3'], '{3}{G}');
  const FOREST = card('Test Forest', 'Basic Land — Forest', '');
  it('is automated; in the graveyard with a Forest: trample; without the Forest, or on the battlefield: none', () => {
    expect(automated(BRAWNY)).toBe(true);
    const yes = scenario([], { p1: { graveyard: ['Test Brawny'], battlefield: ['Test Bear', 'Test Forest'] }, p2: { battlefield: ['Test Ogre'] }, defs: [BRAWNY, BEAR, FOREST, OGRE] });
    expect(kw(yes, find(yes, 'Test Bear', 'battlefield'), 'trample')).toBe(true);
    expect(kw(yes, find(yes, 'Test Ogre', 'battlefield'), 'trample')).toBe(false);
    const noForest = scenario([], { p1: { graveyard: ['Test Brawny'], battlefield: ['Test Bear'] }, defs: [BRAWNY, BEAR, FOREST] });
    expect(kw(noForest, find(noForest, 'Test Bear', 'battlefield'), 'trample')).toBe(false);
    const inPlay = scenario([], { p1: { battlefield: ['Test Brawny', 'Test Bear', 'Test Forest'] }, defs: [BRAWNY, BEAR, FOREST] });
    expect(kw(inPlay, find(inPlay, 'Test Bear', 'battlefield'), 'trample')).toBe(false);
  });
});

describe('CR 702.14c: "Equipped creature has nonbasic landwalk"', () => {
  const BOOTS = card('Test Boots', 'Artifact — Equipment', 'Equipped creature has nonbasic landwalk.\nEquip {2}', undefined, '{2}');
  it('is automated; the equipped creature can\'t be blocked while the defending player controls a nonbasic land', () => {
    expect(automated(BOOTS)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre', 'Plains'] }, defs: [BOOTS, BEAR, OGRE, RUINS] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const booted = attachNew(s0, 'Test Boots', bear);
    expect(canBlock(attackWith(booted, [bear]), ogre, bear)).toBe(true); // only a basic land
    const ruins = tweak(booted, (t) => { put(t, 'p2', 'battlefield', 'Test Ruins'); });
    expect(canBlock(attackWith(ruins, [bear]), ogre, bear)).toBe(false);
  });
});

describe('CR 509.1b, 611.2c, 303.4, 301.5, 700.9: targeted grants', () => {
  const RUNNER = card('Test Runner', 'Artifact Creature — Construct', "{T}: Target creature you control with power 2 or less gains lifelink until end of turn and can't be blocked this turn.", ['0', '3']);
  const DILIGENCE = card('Test Diligence', 'Enchantment — Aura', 'Enchant creature\nWhen Test Diligence enters, target creature you control other than enchanted creature gets +2/+2 and gains vigilance until end of turn.', undefined, '{0}');
  const SHOPKEEP = card('Test Shopkeep', 'Creature — Human', 'Whenever you attack, target attacking equipped creature gains menace until end of turn.', ['1', '1']);
  const SABLE = card('Test Sable', 'Creature — Human', 'Whenever Test Sable attacks, target modified creature you control gains lifelink until end of turn.', ['2', '2']);
  it('all are automated', () => { for (const d of [RUNNER, DILIGENCE, SHOPKEEP, SABLE]) expect(automated(d), d.name).toBe(true); });
  it('lifelink and unblockable this turn for a creature with power 2 or less; a 3-power creature is no legal target', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Runner', 'Test Bear', 'Test Ogre'] }, p2: { battlefield: ['Test Bear'] }, defs: [RUNNER, BEAR, OGRE] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const runner = find(s0, 'Test Runner', 'battlefield');
    const la = legal(s0, 'p1', 'activate').find((a) => a.object === runner)!;
    const asked = act(s0, la.action);
    expect((asked.pending as unknown as { objects: ObjectId[] }).objects.sort()).toEqual([bear, runner].sort());
    const s1 = resolveAll(settle(asked, [obj(bear)]));
    expect(kw(s1, bear, 'lifelink')).toBe(true);
    expect(canBlock(attackWith(s1, [bear]), find(s1, 'Test Bear', 'battlefield', 'p2'), bear)).toBe(false);
  });
  it('the Aura\'s enters trigger can\'t target the creature it enchants', () => {
    const s0 = scenario([], { p1: { hand: ['Test Diligence'], battlefield: ['Test Bear', 'Test Ogre'] }, defs: [DILIGENCE, BEAR, OGRE] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Diligence', 'hand') });
    s = settle(s, [obj(bear)]);
    for (let g = 0; g < 10 && !(s.pending?.kind === 'chooseTargets'); g++) s = pass(s);
    expect((s.pending as unknown as { objects: ObjectId[] }).objects).toEqual([ogre]);
    s = resolveAll(settle(s, [obj(ogre)]));
    expect(pt(s, ogre)).toBe('5/5');
    expect(kw(s, ogre, 'vigilance')).toBe(true);
  });
  it('"target attacking equipped creature" and "target modified creature you control" offer only such creatures', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shopkeep', 'Test Sable', 'Test Bear', 'Test Ogre'] }, defs: [SHOPKEEP, SABLE, BEAR, OGRE, POLE] });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const ogre = find(s0, 'Test Ogre', 'battlefield');
    const sable = find(s0, 'Test Sable', 'battlefield');
    const s1 = attachNew(s0, 'Test Pole', bear);
    let s = declareAttackers(toDeclareAttackers(s1), [[bear], [ogre], [sable]]);
    const offered: ObjectId[][] = [];
    for (let g = 0; g < 10 && (s.pending?.kind === 'chooseTargets' || s.pending?.kind === 'order'); g++) {
      if (s.pending.kind === 'order') { s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) }); continue; }
      offered.push([...(s.pending as unknown as { objects: ObjectId[] }).objects].sort());
      s = answer(s, { kind: 'chooseTargets', targets: [obj(bear)] });
    }
    expect(offered).toEqual([[bear], [bear]]); // the equipped attacker; the only modified creature (CR 700.9)
    s = resolveAll(s);
    expect(kw(s, bear, 'menace')).toBe(true);
    expect(kw(s, bear, 'lifelink')).toBe(true);
  });
});

describe('CR 120.3, 611.2a: "~ gets +1/+0 until end of turn and deals 1 damage to you"', () => {
  const SATYR = card('Test Satyr', 'Creature — Satyr', '{1}: Test Satyr gets +2/+0 until end of turn and deals 1 damage to you.', ['1', '1']);
  it('is automated; it gets +2/+0 and its controller loses 1 life from the damage', () => {
    expect(automated(SATYR)).toBe(true);
    const s0 = scenario([], { p1: { battlefield: ['Test Satyr', 'Plains'] }, defs: [SATYR] });
    const s = resolveAll(activate(s0, 'Test Satyr'));
    expect(pt(s, find(s, 'Test Satyr', 'battlefield'))).toBe('3/1');
    expect(life(s, 'p1')).toBe(19);
    expect(life(s, 'p2')).toBe(20);
  });
});
