/**
 * AF1: the findings of the FAST1 sampled audit (docs/audits/2026-10-13-FAST1.md) and the Narset follow-up.
 *
 *   CR 205.4e, 601.3        a legendary instant or sorcery can be cast only while its caster controls a legendary creature or a legendary planeswalker; it
 *                           is never offered otherwise (castCheck, legalActions), from a resolving effect too (Primevals' Glorious Rebirth, Yawgmoth's
 *                           Vile Offering: audit defect 1)
 *   CR 603.3d, 601.2c, 733  a triggered ability's target answer that is illegal, or empty while a legal target exists, is rejected and asked again as for a
 *                           spell; only "no legal target" removes the ability (audit engine observation; also an online cheat: dropping one's own trigger)
 *   CR 701.9a, 608.2c-d     "you may discard your hand" with an empty hand can be chosen, and "if you do" is then true (official ruling on Narset, Jeskai
 *                           Waymaster, WotC 2025-04-04)
 *
 * Synthetic cards with invented names (design 6.10: committed tests carry no Wizards text); the real cards are read from the local index and skipped
 * without it (OPENMTG_CACHE_DIR).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { castCheck } from '../../../src/actions/cast';
import { act, advanceTo, answer, castAuto, find, legal, life, passBoth, reject, scenario, type ScenarioOptions } from '../../m3/scenario';
import { localIndex } from '../../m5/parser/support';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}), ...(type.includes('Planeswalker') ? { loyalty: '3' } : {}) } as OracleCard);
}
const hand = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const castable = (s: GameState, name: string, player = 'p1'): boolean => legal(s, player, 'cast').some((a) => a.object !== undefined && s.defs[s.objects[a.object]!.defId]!.name === name);

// ---- CR 205.4e --------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 205.4e: a legendary instant or sorcery needs a legendary creature or planeswalker', () => {
  const RITE = card('Test Legendary Rite', 'Legendary Sorcery', 'You gain 3 life.');
  const TRICK = card('Test Legendary Trick', 'Legendary Instant', 'You gain 2 life.');
  const PLAIN = card('Test Plain Rite', 'Sorcery', 'You gain 1 life.');
  const HERO = card('Test Legend Hero', 'Legendary Creature — Human', '', ['2', '2']);
  const WALKER = card('Test Legend Walker', 'Legendary Planeswalker — Test', '+1: You gain 1 life.');
  const RELIC = card('Test Legend Relic', 'Legendary Artifact', '');
  const defs = [RITE, TRICK, PLAIN, HERO, WALKER, RELIC];
  const game = (p1: ScenarioOptions['p1'], p2: ScenarioOptions['p2'] = {}): GameState =>
    scenario(['Grizzly Bears', 'Isamaru, Hound of Konda', "Gaea's Cradle"], { p1: { hand: [RITE.name, TRICK.name, PLAIN.name], ...p1 }, p2, defs });

  it('compiles full (the reminder text carries nothing: the restriction is a rule, CR 205.4e)', () => {
    expect(RITE.automation.level).toBe('full');
    expect(TRICK.automation.level).toBe('full');
  });

  it('CR 205.4e: with no legendary permanent, neither legendary spell is offered and casting one is rejected; a nonlegendary sorcery still is', () => {
    const s = game({ battlefield: ['Grizzly Bears'] });
    expect(castable(s, RITE.name)).toBe(false);
    expect(castable(s, TRICK.name)).toBe(false);
    expect(castable(s, PLAIN.name)).toBe(true);
    const err = reject(s, { type: 'cast', player: 'p1', card: find(s, RITE.name, 'hand') });
    expect(err.rules).toContain('CR 205.4e');
    expect(err.message).toMatch(/legendary creature or a legendary planeswalker/);
  });

  it('CR 205.4e: a legendary creature you control allows both', () => {
    const s = game({ battlefield: [HERO.name] });
    expect(castable(s, RITE.name)).toBe(true);
    expect(castable(s, TRICK.name)).toBe(true);
    let t = castAuto(s, RITE.name);
    t = passBoth(t);
    expect(life(t, 'p1')).toBe(23);
  });

  it('CR 205.4e: a legendary planeswalker you control allows it', () => {
    const s = game({ battlefield: [{ name: WALKER.name, counters: { loyalty: 3 } }] });
    expect(castable(s, RITE.name)).toBe(true);
  });

  it('CR 205.4e: a legendary permanent that is neither a creature nor a planeswalker does not (a legendary land, a legendary artifact)', () => {
    const s = game({ battlefield: ["Gaea's Cradle", RELIC.name] });
    expect(castable(s, RITE.name)).toBe(false);
    expect(castable(s, TRICK.name)).toBe(false);
  });

  it("CR 205.4e: an opponent's legendary creature does not", () => {
    const s = game({}, { battlefield: ['Isamaru, Hound of Konda'] });
    expect(castable(s, RITE.name)).toBe(false);
  });

  it('CR 205.4e, 608.2g: a spell cast while an effect resolves follows the same rule (castCheck with `during`)', () => {
    const without = game({ battlefield: ['Grizzly Bears'] });
    const r = castCheck(without, 'p1', find(without, RITE.name, 'hand'), undefined, undefined, { free: true });
    expect('denial' in r && r.denial.rules).toContain('CR 205.4e');
    const withHero = game({ battlefield: [HERO.name] });
    expect('info' in castCheck(withHero, 'p1', find(withHero, RITE.name, 'hand'), undefined, undefined, { free: true })).toBe(true);
  });
});

const idx = localIndex();
const real = (name: string): CardDef | undefined => {
  const c = (idx ?? []).find((x) => x.name === name);
  return c ? compileCard(c as OracleCard) : undefined;
};

describe.skipIf(!idx)('CR 205.4e on the real cards (audit FAST1 defect 1)', () => {
  it("Primevals' Glorious Rebirth: not offered without a legendary creature; with one it returns the legendary cards", () => {
    const def = real("Primevals' Glorious Rebirth")!;
    expect(def.automation.level).toBe('full');
    const lands = ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Plains', 'Plains', 'Plains'];
    const opts = (bf: string[]): ScenarioOptions => ({ p1: { hand: [def.name], battlefield: [...lands, ...bf], graveyard: ['Ayumi, the Last Visitor'] }, defs: [def] });
    const names = ['Swamp', 'Isamaru, Hound of Konda', 'Ayumi, the Last Visitor', 'Grizzly Bears'];
    const without = scenario(names, opts(['Grizzly Bears']));
    expect(castable(without, def.name)).toBe(false);
    expect(reject(without, { type: 'cast', player: 'p1', card: find(without, def.name, 'hand') }).rules).toContain('CR 205.4e');

    const withLegend = scenario(names, opts(['Isamaru, Hound of Konda']));
    expect(castable(withLegend, def.name)).toBe(true);
    const s = passBoth(castAuto(withLegend, def.name));
    expect(find(s, 'Ayumi, the Last Visitor', 'battlefield')).toBeDefined();
  });

  it("Yawgmoth's Vile Offering: offered only with a legendary creature or planeswalker", () => {
    const def = real("Yawgmoth's Vile Offering")!;
    expect(def.automation.level).toBe('full');
    const lands = Array<string>(6).fill('Swamp');
    const names = ['Swamp', 'Jace Beleren', 'Grizzly Bears'];
    expect(castable(scenario(names, { p1: { hand: [def.name], battlefield: [...lands, 'Grizzly Bears'] }, defs: [def] }), def.name)).toBe(false);
    expect(castable(scenario(names, { p1: { hand: [def.name], battlefield: [...lands, { name: 'Jace Beleren', counters: { loyalty: 3 } }] }, defs: [def] }), def.name)).toBe(true);
  });
});

// ---- CR 603.3d ---------------------------------------------------------------------------------------------------------------------------------------------

describe('CR 603.3d: an illegal target answer for a triggered ability is rejected and asked again, as for a spell', () => {
  const SPRITE = card('Test Recall Sprite', 'Creature — Faerie', 'When this creature enters, return target creature you control to its owner\'s hand.', ['1', '1']);
  const HOUND = card('Test Rust Hound', 'Creature — Dog', 'When this creature enters, destroy target artifact.', ['2', '2']);

  /** p1 casts the Sprite; it resolves and its enters trigger asks p1 for a target. */
  const toTargets = (): GameState => {
    const s0 = scenario(['Grizzly Bears', 'Isamaru, Hound of Konda', 'Lightning Bolt'], {
      p1: { hand: [SPRITE.name], battlefield: ['Grizzly Bears'], graveyard: ['Lightning Bolt'] }, p2: { battlefield: ['Isamaru, Hound of Konda'] }, defs: [SPRITE, HOUND],
    });
    const s = passBoth(castAuto(s0, SPRITE.name));
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(s.pending?.player).toBe('p1');
    return s;
  };
  const tryAnswer = (s: GameState, a: DecisionAnswer) => applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: a });

  it('compiles full', () => expect(SPRITE.automation.level).toBe('full'));

  it("CR 115.1, 603.3d: an opponent's creature (not a legal target) is rejected; the trigger stays and the same question is pending", () => {
    const s = toTargets();
    const r = tryAnswer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Isamaru, Hound of Konda', 'battlefield') }] });
    expect(r.error?.message).toMatch(/not a legal target/);
    expect(r.state).toBe(s);
    expect(s.log.some((l) => /removed from the stack/.test(l.text))).toBe(false);
  });

  it('CR 115.1, 603.3d: a card in a graveyard (the audit\'s Lightning Bolt) is rejected', () => {
    const s = toTargets();
    const r = tryAnswer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Lightning Bolt', 'graveyard') }] });
    expect(r.error?.message).toMatch(/not a legal target/);
    expect(r.state).toBe(s);
  });

  it('CR 601.2c, 603.3d: no target while a legal one exists is rejected (a player can\'t drop their own mandatory trigger)', () => {
    const s = toTargets();
    const r = tryAnswer(s, { kind: 'chooseTargets', targets: [] });
    expect(r.error?.message).toMatch(/Choose exactly 1 target/);
    expect(r.state).toBe(s);
  });

  it('CR 603.3d: after a rejected answer a legal one puts the ability on the stack and it resolves', () => {
    const s = toTargets();
    expect(tryAnswer(s, { kind: 'chooseTargets', targets: [] }).error).toBeDefined();
    let t = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Grizzly Bears', 'battlefield') }] });
    expect(t.log.some((l) => /puts Test Recall Sprite's triggered ability on the stack targeting Grizzly Bears/.test(l.text))).toBe(true);
    t = passBoth(t);
    expect(find(t, 'Grizzly Bears', 'hand', 'p1')).toBeDefined();
  });

  it('CR 603.3d: with no legal target at all the ability is removed from the stack (unchanged)', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: [HOUND.name] }, defs: [SPRITE, HOUND] });
    const s = passBoth(castAuto(s0, HOUND.name));
    expect(s.pending?.kind).toBe('priority');
    expect(s.log.some((l) => /Test Rust Hound's triggered ability is removed from the stack/.test(l.text) && l.rules?.includes('CR 603.3d'))).toBe(true);
  });
});

// ---- CR 603.3d, 115.3: no legal SET of targets (AF1 review) -------------------------------------------------------------------------------------------------

describe('CR 603.3d, 115.3: a triggered ability with no legal set of targets is removed, never asked forever (AF1 review)', () => {
  const PAIR = card('Test Pair Tapper', 'Creature — Golem', 'When this creature enters, tap two target creatures. Untap another target creature.', ['1', '1']);
  const triggerOf = (def: CardDef) => {
    const t = def.faces[0]!.abilities.find((a) => a.kind === 'triggered');
    if (!t || t.kind !== 'triggered') throw new Error('no triggered ability');
    return t;
  };

  it('compiles full: two targets, then one that must differ from them (CR 115.3)', () => {
    expect(PAIR.automation.level).toBe('full');
    const specs = triggerOf(PAIR).effect.targets;
    expect(specs.map((t) => [t.min, t.max, t.distinctFrom ?? []])).toEqual([[2, 2, []], [1, 1, [specs[0]!.id]]]);
  });

  it('CR 603.3d: exactly two creatures (each a legal target alone, no legal set of three): the ability is removed and the game goes on', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: [PAIR.name] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [PAIR] });
    const s = passBoth(castAuto(s0, PAIR.name));
    expect(s.pending?.kind).toBe('priority');
    expect(s.log.some((l) => /Test Pair Tapper's triggered ability is removed from the stack: There is no legal set of targets/.test(l.text) && l.rules?.includes('CR 603.3d'))).toBe(true);
    expect(s.zones.stack).toHaveLength(0);
  });

  it('CR 603.3d, 115.3: with a third creature the ability is put on the stack and resolves (unchanged)', () => {
    const s0 = scenario(['Grizzly Bears', 'Isamaru, Hound of Konda'], {
      p1: { hand: [PAIR.name], battlefield: ['Isamaru, Hound of Konda'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [PAIR],
    });
    let s = passBoth(castAuto(s0, PAIR.name));
    expect(s.pending?.kind).toBe('chooseTargets');
    const pair = find(s, PAIR.name, 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const hound = find(s, 'Isamaru, Hound of Konda', 'battlefield');
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: bears }, { kind: 'object', id: hound }] });
    expect(s.pending?.kind).toBe('chooseTargets');
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: pair }] });
    s = passBoth(s);
    expect(s.objects[bears]!.tapped).toBe(true);
    expect(s.objects[hound]!.tapped).toBe(true);
    expect(s.objects[pair]!.tapped).toBe(false);
  });

  it('CR 603.3d: when the search for a legal set gives up (its leaf cap), an answer that leaves no completion removes the ability instead of re-asking forever', () => {
    // "Tap three target creatures. Untap twenty-eight other target creatures." with 30 creatures: each creature is a legal first target alone, no set works,
    // and proving it takes more than the search's leaf cap (C(30, 3) = 4060 first sets), so the announcement asks; the answer can then never be completed.
    const WIDE = structuredClone(PAIR);
    WIDE.name = WIDE.id = 'Test Wide Tapper';
    WIDE.faces[0]!.name = WIDE.name;
    const [t0, t1] = triggerOf(WIDE).effect.targets;
    t0!.min = 3; t0!.max = 3;
    t1!.min = 28; t1!.max = 28;
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: [WIDE.name], battlefield: Array<string>(15).fill('Grizzly Bears') }, p2: { battlefield: Array<string>(14).fill('Grizzly Bears') }, defs: [WIDE] });
    let s = passBoth(castAuto(s0, WIDE.name));
    for (let i = 0; i < 3 && s.pending?.kind === 'chooseTargets'; i++) {
      const d = s.pending;
      const r = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseTargets', targets: d.objects!.slice(0, d.min).map((id) => ({ kind: 'object' as const, id })) } });
      expect(r.error?.message).toBeUndefined();
      s = r.state;
    }
    expect(s.pending?.kind).toBe('priority');
    expect(s.log.some((l) => /Test Wide Tapper's triggered ability is removed from the stack: .*the search gave up/.test(l.text) && l.rules?.includes('CR 603.3d'))).toBe(true);
  });
});

// ---- CR 701.9a, 608.2c-d: discarding an empty hand ---------------------------------------------------------------------------------------------------------

describe('CR 701.9a, 608.2d: "you may discard your hand" with an empty hand (official ruling on Narset, Jeskai Waymaster)', () => {
  const RESET = card('Test Hand Reset', 'Sorcery', 'You may discard your hand. If you do, draw two cards.');

  it('the player is asked even with an empty hand; yes discards nothing and "if you do" is true', () => {
    const s0 = scenario([], { p1: { hand: [RESET.name] }, defs: [RESET] });
    let s = passBoth(castAuto(s0, RESET.name)); // the sorcery left the hand when cast: the hand is empty
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(hand(s)).toBe(2);
  });

  it('no: nothing is drawn', () => {
    const s0 = scenario([], { p1: { hand: [RESET.name] }, defs: [RESET] });
    let s = passBoth(castAuto(s0, RESET.name));
    s = answer(s, { kind: 'yesNo', yes: false });
    expect(hand(s)).toBe(0);
  });

  it('with cards in hand: discards them all, then draws two', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { hand: [RESET.name, 'Grizzly Bears', 'Grizzly Bears'] }, defs: [RESET] });
    let s = passBoth(castAuto(s0, RESET.name));
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(hand(s)).toBe(2);
    expect(s.zones.graveyard['p1']!.length).toBe(3); // two Bears and the sorcery
  });
});

describe.skipIf(!idx)('Narset, Jeskai Waymaster (real card): an empty hand at the end step still draws', () => {
  it('compiles full, and with an empty hand and two spells cast this turn, "yes" draws two cards', () => {
    const def = real('Narset, Jeskai Waymaster')!;
    expect(def.automation.level).toBe('full');
    const SPARK = card('Test Spark Note', 'Sorcery', 'You gain 1 life.');
    const s0 = scenario([], { p1: { hand: [SPARK.name, SPARK.name], battlefield: [def.name] }, defs: [def, SPARK] });
    let s = passBoth(castAuto(s0, SPARK.name));
    s = passBoth(castAuto(s, SPARK.name));
    expect(hand(s)).toBe(0);
    s = advanceTo(s, 1, 'end');
    for (let i = 0; i < 4 && s.pending?.kind === 'priority'; i++) s = act(s, { type: 'pass', player: s.pending.player });
    expect(s.pending?.kind).toBe('yesNo');
    s = answer(s, { kind: 'yesNo', yes: true });
    expect(hand(s)).toBe(2);
  });
});
