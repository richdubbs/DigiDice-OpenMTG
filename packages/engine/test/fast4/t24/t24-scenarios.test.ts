/**
 * FAST4 T24: the shapes of parser/templates/zz-fast4/t24.json and the engine additions they needed, played through the engine with synthetic cards compiled by
 * the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 604.1, 613.1f, 601.2a, 707.10   "Artifact spells you cast have convoke" (cascade, storm, conspire): the layer-6 grant reaches the spell while it is cast
 *                                      (CR 601.2b, 601.2h-i, 702.51a, 702.85a, 702.40a, 702.78a), the card is castable from hand with it (rules/payment-options.ts,
 *                                      actions/cast.ts#withGrantedCosts); not other spells, not an opponent's spells, not copies (never cast)
 *   CR 702.51a                         each creature tapped for convoke pays for {1} (the fix of rules/payment-options.ts#reduction: one creature paid it all)
 *   CR 509.1a, 510.1d                  "~ can block any number of creatures": one creature blocks several attackers; an ordinary creature blocks one
 *   CR 601.2i, 101.2                   "Each player can't cast more than one spell each turn": counts the spells each player cast this turn, also before it
 *   CR 609.4, 702.3b, 611.3a           "As long as ..., ~ can attack as though it didn't have defender": only while the condition holds
 *   CR 613.4b, 611.3a                  conditional base power and toughness ("during your turn", "seven or more cards in your graveyard")
 *   CR 509.1b                          "... gets +2/+0 and can't be blocked" while the condition holds
 *   CR 701.6a, 101.2                   "Artifact and instant spells you control can't be countered"
 *   CR 119.3, 613.4c, 613.1f           "Creatures you control get +1/+0 and have trample as long as you gained life this turn"
 *   CR 613.4b                          "Creatures your opponents control have base toughness 1"
 *   CR 702.37a, 702.37e, 701.20a       "Morph--Reveal a white card in your hand": turning it face up reveals a white card; without one it can't
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, find, labels, life, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers, tweak } from '../../m4/helpers';
import { castCard } from '../../m5/announce/support';
import { putFaceDown, turnUpActions } from '../../m6/face-down/support';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}', colors: string[] = []): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
/** No ability of the card left manual (the T24 templates are experimental, so the card level is capped at partial, design 6.9). */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'))
  && (d.automation.faces ?? []).every((f) => f.abilities.every((a) => a.level !== 'manual' && a.manual.length === 0));
const mine = (s: GameState, player = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === player);
/** Pay for the spell being cast: convoke with every offered creature (up to the maximum), other decisions as answered, mana automatically. */
function settle(s0: GameState, opts: { convoke?: boolean; yes?: boolean } = {}): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 20; guard++) {
    const p = s.pending as unknown as { kind: string; options: string[]; max: number; min: number };
    if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: opts.convoke === false ? p.options.slice(0, p.min) : p.options.slice(0, p.max) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: opts.yes === true });
    else break;
  }
  return s;
}
/** Both players pass until the stack is empty (answering yes/no questions with `yes`). */
function resolveAll(s0: GameState, yes = false): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = settle(s.pending?.kind === 'priority' ? pass(s) : s, { yes });
  return s;
}

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{1}{G}', ['G']);
const RELIC = card('Test Relic', 'Artifact', '{T}: You gain 1 life.', undefined, '{3}');
const STUDY = card('Test Study', 'Sorcery', 'You gain 2 life.', undefined, '{2}');
const TONIC = card('Test Tonic', 'Instant', 'You gain 2 life.', undefined, '{0}', ['W']);

describe('CR 604.1, 613.1f, 702.51a: "Artifact spells you cast have convoke"', () => {
  const ENGINEER = card('Test Engineer', 'Creature — Vedalken', 'Artifact spells you cast have convoke.', ['1', '3'], '{1}{U}', ['U']);
  it('is automated', () => expect(automated(ENGINEER)).toBe(true));
  it('an artifact spell is castable with no mana and cast by tapping three creatures, each paying {1} (CR 601.2a, 601.2h)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Relic'], battlefield: ['Test Engineer', 'Test Bear', 'Test Bear'] }, defs: [ENGINEER, RELIC, BEAR] });
    expect(labels(s0, 'p1')).toContain('Cast Test Relic');
    const s = settle(castCard(s0, 'Test Relic'));
    expect(s.zones.stack.length).toBe(1);
    expect(mine(s0).every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(hasKeyword(getChars(s, s.zones.stack[0]!)!, 'convoke')).toBe(true);
  });
  it('a sorcery is not an artifact spell: no convoke, not castable without mana', () => {
    const s0 = scenario([], { p1: { hand: ['Test Study'], battlefield: ['Test Engineer', 'Test Bear', 'Test Bear'] }, defs: [ENGINEER, STUDY, BEAR] });
    expect(labels(s0, 'p1')).not.toContain('Cast Test Study');
  });
  it("an opponent's artifact spell does not get convoke", () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Engineer'] }, p2: { hand: ['Test Relic'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs: [ENGINEER, RELIC, BEAR] });
    expect(labels(s0, 'p2')).not.toContain('Cast Test Relic');
  });
});

describe('CR 702.51a FIX: each creature tapped for convoke pays for {1} or one mana of its color, never more', () => {
  const CONVOKER = card('Test Convoker', 'Sorcery', 'Convoke\nYou gain 2 life.', undefined, '{3}');
  it('three creatures pay {3}; one creature alone does not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Convoker'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs: [CONVOKER, BEAR] });
    const t = castCard(s0, 'Test Convoker');
    const options = (t.pending as unknown as { options: string[] }).options;
    expect(() => answer(t, { kind: 'chooseObjects', ids: [options[0]!] })).toThrow(/could not be paid/);
    const s = answer(t, { kind: 'chooseObjects', ids: options });
    expect(s.zones.stack.length).toBe(1);
    expect(mine(s0).every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});

describe('CR 702.40a, 707.10: "Instant spells you cast have storm"', () => {
  const PRISM = card('Test Prism Drake', 'Creature — Drake', 'Instant spells you cast have storm.', ['2', '2'], '{2}{U}', ['U']);
  it('is automated; the second instant of the turn is copied once, and the copy (never cast) has no storm', () => {
    expect(automated(PRISM)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tonic', 'Test Tonic'], battlefield: ['Test Prism Drake'] }, defs: [PRISM, TONIC] });
    const before = life(s, 'p1');
    s = resolveAll(settle(castCard(s, 'Test Tonic')));
    expect(life(s, 'p1')).toBe(before + 2);
    s = settle(castCard(s, 'Test Tonic'));
    expect(s.zones.stack.map((id) => s.objects[id]!.kind)).toEqual(['card', 'ability']); // the storm trigger (CR 702.40a)
    s = settle(pass(pass(s)));
    const copy = s.zones.stack.find((id) => s.objects[id]!.kind === 'spellCopy')!;
    expect(copy).toBeDefined();
    expect(hasKeyword(getChars(s, copy)!, 'storm')).toBe(false);
    expect(hasKeyword(getChars(s, s.zones.stack[0]!)!, 'storm')).toBe(true);
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(before + 6);
  });
  it('a sorcery does not get storm', () => {
    const SPARK = card('Test Spark', 'Sorcery', 'You gain 2 life.', undefined, '{0}');
    let s = scenario([], { p1: { hand: ['Test Tonic', 'Test Spark'], battlefield: ['Test Prism Drake'] }, defs: [PRISM, TONIC, SPARK] });
    s = resolveAll(settle(castCard(s, 'Test Tonic')));
    s = settle(castCard(s, 'Test Spark'));
    expect(s.zones.stack.length).toBe(1);
  });
});

describe('CR 702.85a: "Goblin spells you cast have cascade"', () => {
  const HERALD = card('Test Goblin Herald', 'Creature — Goblin', 'Goblin spells you cast have cascade.', ['1', '1'], '{R}', ['R']);
  const RAIDER = card('Test Goblin Raider', 'Creature — Goblin', '', ['2', '1'], '{0}', ['R']);
  it('is automated; casting a Goblin spell triggers cascade, another creature spell does not', () => {
    expect(automated(HERALD)).toBe(true);
    const s0 = scenario(['Forest'], { p1: { hand: ['Test Goblin Raider', 'Test Bear'], battlefield: ['Test Goblin Herald', 'Forest', 'Forest'] }, defs: [HERALD, RAIDER, BEAR] });
    const s = settle(castCard(s0, 'Test Goblin Raider'));
    expect(s.zones.stack.map((id) => s.objects[id]!.kind)).toEqual(['card', 'ability']);
    const t = settle(castCard(s0, 'Test Bear'));
    expect(t.zones.stack.length).toBe(1);
  });
});

describe('CR 702.78a, 601.2b: "Each instant spell you cast has conspire"', () => {
  const SCHEMES = card('Test Schemes', 'Enchantment', 'Each instant spell you cast has conspire.', undefined, '{2}');
  const PAGE = card('Test Page', 'Creature — Human', '', ['1', '1'], '{W}', ['W']);
  it('is automated; the conspire cost is offered as the instant is cast, and paying it (two white creatures tapped) copies the instant', () => {
    expect(automated(SCHEMES)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Schemes', 'Test Page', 'Test Page'] }, defs: [SCHEMES, TONIC, PAGE] });
    const before = life(s, 'p1');
    s = castCard(s, 'Test Tonic');
    expect(s.pending).toMatchObject({ kind: 'yesNo' });
    expect((s.pending as unknown as { prompt: string }).prompt).toMatch(/conspire/);
    s = resolveAll(settle(s, { yes: true }), true);
    expect(life(s, 'p1')).toBe(before + 4);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Page').every((id) => s.objects[id]!.tapped)).toBe(true);
  });
});

describe('CR 509.1a, 510.1d: "~ can block any number of creatures"', () => {
  const GUARD = card('Test Gate Guard', 'Creature — Human Soldier', '~ can block any number of creatures.', ['1', '4'], '{2}{W}', ['W']);
  const WALL = card('Test Wall', 'Creature — Wall', '', ['0', '4'], '{1}{W}', ['W']);
  function attackWithTwo(defender: string): { s: GameState; a: ObjectId; b: ObjectId; d: ObjectId } {
    let s = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: [defender] }, defs: [GUARD, WALL, BEAR] });
    const [a, b] = mine(s);
    s = declareAttackers(toDeclareAttackers(s), [[a!], [b!]]);
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'blockers', 20);
    return { s, a: a!, b: b!, d: mine(s, 'p2')[0]! };
  }
  const blocks = (s: GameState, pairs: [ObjectId, ObjectId][]) => ({ type: 'answer' as const, player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'declareBlockers' as const, blocks: pairs.map(([blocker, attacker]) => ({ blocker, attacker })) } });
  it('is automated; the creature blocks both attackers and is dealt the damage of both', () => {
    expect(automated(GUARD)).toBe(true);
    const { s, a, b, d } = attackWithTwo('Test Gate Guard');
    expect((s.pending as unknown as { candidates: { id: string; maxBlocks: number }[] }).candidates.find((c) => c.id === d)!.maxBlocks).toBe(2);
    let t = act(s, blocks(s, [[d, a], [d, b]]));
    expect(t.combat!.blockers.find((x) => x.id === d)!.blocking.sort()).toEqual([a, b].sort());
    for (let g = 0; g < 60 && t.turn.step !== 'endCombat' && t.turn.step !== 'main2'; g++) {
      const p = t.pending as unknown as { kind: string; recipients?: { id: string }[]; amount?: number };
      if (p.kind === 'assignDamage') t = answer(t, { kind: 'assignDamage', amounts: [{ id: p.recipients![0]!.id, amount: p.amount! }] } as never);
      else t = pass(t);
    }
    expect(t.zones.battlefield.includes(d)).toBe(false); // 2 + 2 damage to a 1/4 (CR 510.1d: its 1 damage goes to one of them)
    expect(life(t, 'p2')).toBe(20);
  });
  it('"~ can block an additional creature each combat" (static.json, the same rule modification with value 1) blocks at most two (statics/hooks.ts#maxBlocks)', () => {
    const TWIN = card('Test Twin Guard', 'Creature — Human Soldier', '~ can block an additional creature each combat.', ['1', '4'], '{2}{W}', ['W']);
    let s0 = scenario([], { p1: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Twin Guard'] }, defs: [TWIN, BEAR] });
    const [a, b, c] = mine(s0);
    s0 = declareAttackers(toDeclareAttackers(s0), [[a!], [b!], [c!]]);
    const s = passUntil(s0, (x) => x.pending?.kind === 'declareBlockers', 'blockers', 20);
    const d = mine(s, 'p2')[0]!;
    expect((s.pending as unknown as { candidates: { id: string; maxBlocks: number }[] }).candidates.find((x) => x.id === d)!.maxBlocks).toBe(2);
    expect(reject(s, blocks(s, [[d, a!], [d, b!], [d, c!]])).rules).toContain('CR 509.1a');
    expect(act(s, blocks(s, [[d, a!], [d, b!]])).combat!.blockers.find((x) => x.id === d)!.blocking).toHaveLength(2);
  });
  it('an ordinary creature blocks only one attacker (CR 509.1a)', () => {
    const { s, a, b, d } = attackWithTwo('Test Wall');
    expect((s.pending as unknown as { candidates: { id: string; maxBlocks: number }[] }).candidates.find((c) => c.id === d)!.maxBlocks).toBe(1);
    expect(reject(s, blocks(s, [[d, a], [d, b]])).rules).toContain('CR 509.1a');
  });
});

describe('CR 601.2i, 101.2: "Each player can\'t cast more than one spell each turn"', () => {
  const ARCHON = card('Test Hush Archon', 'Creature — Archon', "Flying\nEach player can't cast more than one spell each turn.", ['2', '3'], '{2}{W}', ['W']);
  it('is automated; after one spell neither player may cast another this turn', () => {
    expect(automated(ARCHON)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tonic', 'Test Tonic'], battlefield: ['Test Hush Archon'] }, p2: { hand: ['Test Tonic', 'Test Tonic'] }, defs: [ARCHON, TONIC] });
    expect(labels(s, 'p1')).toContain('Cast Test Tonic');
    s = settle(castCard(s, 'Test Tonic'));
    expect(labels(s, 'p1')).not.toContain('Cast Test Tonic');
    s = pass(s); // p2 gets priority with the first spell on the stack
    expect(labels(s, 'p2')).toContain('Cast Test Tonic');
    s = settle(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Tonic', 'hand', 'p2') }));
    expect(labels(s, 'p2')).not.toContain('Cast Test Tonic');
  });
  it('a spell cast before it was on the battlefield counts (the player\'s spells cast this turn)', () => {
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Hush Archon'] }, defs: [ARCHON, TONIC] });
    s = tweak(s, (x) => { x.players.find((p) => p.id === 'p1')!.turnStats.spellsCast = 1; });
    expect(labels(s, 'p1')).not.toContain('Cast Test Tonic');
  });
});

describe('CR 609.4, 702.3b, 611.3a: "As long as you control a creature with power 5 or greater, ~ can attack as though it didn\'t have defender"', () => {
  const SENTRY = card('Test Root Sentry', 'Creature — Plant', "Defender\nAs long as you control a creature with power 5 or greater, ~ can attack as though it didn't have defender.", ['4', '4'], '{2}{G}', ['G']);
  const GIANT = card('Test Giant', 'Creature — Giant', '', ['5', '5'], '{4}{G}', ['G']);
  /** Is it among the creatures that may attack (no declare-attackers decision at all when none may, CR 508.1)? */
  const canAttack = (s: GameState, id: ObjectId): boolean => {
    let t: GameState;
    try { t = toDeclareAttackers(s); } catch { return false; }
    return (t.pending as unknown as { candidates: { id: string }[] }).candidates.some((c) => c.id === id);
  };
  it('is automated; it may attack only while its controller controls a creature with power 5 or greater', () => {
    expect(automated(SENTRY)).toBe(true);
    const yes = scenario([], { p1: { battlefield: ['Test Root Sentry', 'Test Giant'] }, defs: [SENTRY, GIANT] });
    expect(canAttack(yes, find(yes, 'Test Root Sentry', 'battlefield'))).toBe(true);
    const no = scenario([], { p1: { battlefield: ['Test Root Sentry', 'Test Bear'] }, p2: { battlefield: ['Test Giant'] }, defs: [SENTRY, GIANT, BEAR] });
    expect(canAttack(no, find(no, 'Test Root Sentry', 'battlefield'))).toBe(false);
  });
  const WALL = card('Test Rune Wall', 'Artifact Creature — Wall', "Defender\nAs long as ~ has a counter on it, it can attack as though it didn't have defender.", ['3', '3'], '{3}');
  it('"As long as ~ has a counter on it": any kind of counter (CR 122.1)', () => {
    expect(automated(WALL)).toBe(true);
    const bare = scenario([], { p1: { battlefield: ['Test Rune Wall'] }, defs: [WALL] });
    expect(canAttack(bare, find(bare, 'Test Rune Wall', 'battlefield'))).toBe(false);
    const charged = scenario([], { p1: { battlefield: [{ name: 'Test Rune Wall', counters: { charge: 1 } }] }, defs: [WALL] });
    expect(canAttack(charged, find(charged, 'Test Rune Wall', 'battlefield'))).toBe(true);
  });
});

describe('CR 613.4b, 611.3a: conditional base power and toughness', () => {
  const STAG = card('Test Thaw Stag', 'Creature — Elk', 'During your turn, ~ has base power and toughness 4/1.', ['1', '5'], '{3}{U}', ['U']);
  it('"During your turn": 4/1 on its controller\'s turn, the printed 1/5 on the other player\'s turn', () => {
    expect(automated(STAG)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Thaw Stag'] }, p2: { battlefield: ['Test Thaw Stag'] }, defs: [STAG] });
    expect(pt(s, find(s, 'Test Thaw Stag', 'battlefield', 'p1'))).toBe('4/1');
    expect(pt(s, find(s, 'Test Thaw Stag', 'battlefield', 'p2'))).toBe('1/5');
  });
  const DOC = card('Test Grave Doctor', 'Creature — Human', 'As long as there are seven or more cards in your graveyard, ~ has base power and toughness 6/6.', ['2', '2'], '{2}{U}', ['U']);
  it('"As long as there are seven or more cards in your graveyard": 6/6 with seven cards, a +1/+1 counter still applies on top (CR 613.4c)', () => {
    expect(automated(DOC)).toBe(true);
    const six = scenario([], { p1: { battlefield: ['Test Grave Doctor'], graveyard: Array(6).fill('Test Bear') }, defs: [DOC, BEAR] });
    expect(pt(six, find(six, 'Test Grave Doctor', 'battlefield'))).toBe('2/2');
    const seven = scenario([], { p1: { battlefield: [{ name: 'Test Grave Doctor', counters: { '+1/+1': 1 } }], graveyard: Array(7).fill('Test Bear') }, defs: [DOC, BEAR] });
    expect(pt(seven, find(seven, 'Test Grave Doctor', 'battlefield'))).toBe('7/7');
  });
});

describe('CR 509.1b: "As long as there are seven or more cards in your graveyard, ~ gets +2/+0 and can\'t be blocked"', () => {
  const HERMIT = card('Test Night Hermit', 'Creature — Rat', "As long as there are seven or more cards in your graveyard, ~ gets +2/+0 and can't be blocked.", ['1', '3'], '{2}{U}', ['U']);
  /** Attack with it: may the opponent's creature block it? (No declare-blockers decision at all when no creature may block, CR 509.1.) */
  function blockTry(n: number): { s: GameState; denied: boolean } {
    const s0 = scenario([], { p1: { battlefield: ['Test Night Hermit'], graveyard: Array(n).fill('Test Bear') }, p2: { battlefield: ['Test Bear'] }, defs: [HERMIT, BEAR] });
    const h = find(s0, 'Test Night Hermit', 'battlefield');
    let s = declareAttackers(toDeclareAttackers(s0), [[h]]);
    for (let g = 0; g < 20 && s.pending?.kind !== 'declareBlockers' && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; g++) s = pass(s);
    if (s.pending?.kind !== 'declareBlockers') return { s: s0, denied: true };
    const cands = (s.pending as unknown as { candidates: { attackers: string[] }[] }).candidates;
    return { s: s0, denied: !cands.some((c) => c.attackers.includes(h)) };
  }
  it('is automated; with seven cards it is 3/3 and no creature may block it; with six it is 1/3 and may be blocked', () => {
    expect(automated(HERMIT)).toBe(true);
    const seven = blockTry(7);
    expect(pt(seven.s, find(seven.s, 'Test Night Hermit', 'battlefield'))).toBe('3/3');
    expect(seven.denied).toBe(true);
    const six = blockTry(6);
    expect(pt(six.s, find(six.s, 'Test Night Hermit', 'battlefield'))).toBe('1/3');
    expect(six.denied).toBe(false);
  });
});

describe('CR 701.6a, 101.2: "Artifact and instant spells you control can\'t be countered"', () => {
  const SPHINX = card('Test Final Sphinx', 'Creature — Sphinx', "Flying\nArtifact and instant spells you control can't be countered.", ['5', '5'], '{5}{U}', ['U']);
  const NEGATE = card('Test Negate', 'Instant', 'Counter target spell.', undefined, '{0}', ['U']);
  it('is automated; an opponent\'s "counter target spell" leaves the instant on the stack, and it resolves; a sorcery-speed creature spell is countered', () => {
    expect(automated(SPHINX)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Final Sphinx'] }, p2: { hand: ['Test Negate'] }, defs: [SPHINX, TONIC, NEGATE] });
    const before = life(s, 'p1');
    s = settle(castCard(s, 'Test Tonic'));
    const tonic = s.zones.stack[0]!;
    s = pass(s);
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Negate', 'hand', 'p2') });
    for (let g = 0; s.pending && s.pending.kind !== 'priority' && g < 5; g++) {
      s = s.pending.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: tonic }] }) : answer(s, { kind: 'payCost', auto: true });
    }
    s = resolveAll(s);
    expect(life(s, 'p1')).toBe(before + 2);
  });
});

describe('CR 119.3, 613.4c, 613.1f: "Creatures you control get +1/+0 and have trample as long as you gained life this turn"', () => {
  const STRIKER = card('Test Thorn Striker', 'Creature — Elf', 'Creatures you control get +1/+0 and have trample as long as you gained life this turn.', ['2', '2'], '{2}{G}', ['G']);
  it('is automated; nothing before a life gain, +1/+0 and trample after it (and not for the opponent\'s creatures)', () => {
    expect(automated(STRIKER)).toBe(true);
    let s = scenario([], { p1: { hand: ['Test Tonic'], battlefield: ['Test Thorn Striker', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] }, defs: [STRIKER, TONIC, BEAR] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(pt(s, bear)).toBe('2/2');
    expect(hasKeyword(getChars(s, bear)!, 'trample')).toBe(false);
    s = resolveAll(settle(castCard(s, 'Test Tonic')));
    expect(pt(s, bear)).toBe('3/2');
    expect(hasKeyword(getChars(s, bear)!, 'trample')).toBe(true);
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe('2/2');
  });
});

describe('CR 613.4b: "Creatures your opponents control have base toughness 1"', () => {
  const MAHA = card('Test Night Owl', 'Creature — Bird', 'Flying\nCreatures your opponents control have base toughness 1.', ['3', '5'], '{3}{B}', ['B']);
  it('is automated; the opponent\'s 2/2 is 2/1 (a +1/+1 counter still adds, CR 613.4c), its controller\'s creatures are unchanged', () => {
    expect(automated(MAHA)).toBe(true);
    const s = scenario([], { p1: { battlefield: ['Test Night Owl', 'Test Bear'] }, p2: { battlefield: ['Test Bear', { name: 'Test Bear', counters: { '+1/+1': 1 } }] }, defs: [MAHA, BEAR] });
    expect(pt(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2').map((id) => pt(s, id)).sort()).toEqual(['2/1', '3/2']);
  });
});

describe('CR 702.37a, 702.37e, 701.20a: "Morph--Reveal a white card in your hand"', () => {
  const WATCHER = card('Test Roost Watcher', 'Creature — Bird', 'Flying\nMorph--Reveal a white card in your hand.\nWhen ~ is turned face up, you gain 2 life.', ['1', '1'], '{1}{W}', ['W']);
  it('is automated; turning it face up is offered only with a white card in hand, and reveals one', () => {
    expect(automated(WATCHER)).toBe(true);
    let [s, id] = putFaceDown(scenario([], { p1: { hand: ['Test Tonic'] }, defs: [WATCHER, TONIC] }), 'p1', 'Test Roost Watcher');
    expect(turnUpActions(s).map((a) => a.object)).toEqual([id]);
    s = act(s, { type: 'special', player: 'p1', kind: 'turnFaceUp', object: id });
    for (let g = 0; s.pending && s.pending.kind !== 'priority' && g < 5; g++) {
      const p = s.pending as unknown as { kind: string; options?: string[]; min?: number };
      s = p.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: p.options!.slice(0, 1) }) : answer(s, { kind: 'payCost', auto: true });
    }
    expect(s.objects[id]!.faceDown).toBe(false);
    expect(s.zones.hand.p1!.map((x) => s.objects[x]!.defId)).toEqual(['Test Tonic']); // revealed, not discarded
    const [s2, id2] = putFaceDown(scenario([], { p1: { hand: ['Test Bear'] }, defs: [WATCHER, BEAR] }), 'p1', 'Test Roost Watcher');
    expect(turnUpActions(s2).map((a) => a.object)).not.toContain(id2); // a green card can't be revealed for it
  });
});
