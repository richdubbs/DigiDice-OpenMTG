/**
 * Phase 2 lane p2-promote, round p2-promote-2: the wordings of the templates this round promotes as narrow wordings (design 6.9 deviation, named in the round's
 * record), played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named
 * after the rule it checks, with its negative case. The two kicker wordings are already played by test/m6/costs/m6-5.test.ts ("you gain 3 life for each time it
 * was kicked", "enters with two +1/+1 counters on it for each time it was kicked", two kickers). CR cites from memory, unverified.
 *
 *   CR 509.1a, 602.5a          sta.cantblock.noactivate: "Enchanted creature can't block, and its activated abilities can't be activated"
 *   CR 509.1b                  rst.each.blockonly: "Creatures with flying can block only creatures with flying"
 *   CR 702.29a, 702.29e        kw.typecycling.wizard: "Wizardcycling {2}": search for a Wizard card, reveal it, put it into your hand
 *   CR 702.140d, 702.140e      trg.m6.yourCreature.mutates: "Whenever a creature you control mutates, put a +1/+1 counter on that creature and you gain 2 life"
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, pass, put, scenario } from '../../m5/helpers';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { card, counters, full, settle } from '../cmd3/helpers';
import { ELVES, GEMRAZER, mutate, resolveTop, table } from '../../m6/mutate/support';

/** The creatures the defending player may block with after p1 attacks with `attacker` (CR 509.1a-b); none when the engine skips the decision (no candidate). */
function blockCandidates(s0: GameState, attacker: string): ObjectId[] {
  const s = passUntil(declareAttackers(toDeclareAttackers(s0), [[find(s0, attacker, 'battlefield', 'p1')]]),
    (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage' || x.turn.step === 'endCombat' || x.turn.step === 'main2', 'the declare blockers decision');
  if (s.pending?.kind !== 'declareBlockers') return [];
  return (s.pending as unknown as { candidates: { id: ObjectId; attackers: ObjectId[] }[] }).candidates.filter((c) => c.attackers.length > 0).map((c) => c.id);
}

describe('CR 509.1a, 602.5a: "Enchanted creature can\'t block, and its activated abilities can\'t be activated" (sta.cantblock.noactivate)', () => {
  const CHAINS = card('Test Frost Chains', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature can\'t block, and its activated abilities can\'t be activated.');
  const SMITH = card('Test Spark Smith', 'Creature — Human', '{0}: This creature gets +1/+0 until end of turn.', ['2', '2']);
  const RAIDER = card('Test Raider', 'Creature — Orc', '', ['2', '2']);
  const DEFS: CardDef[] = [CHAINS, SMITH, RAIDER];
  /** p2's Smith (enchanted or not); p1 attacks with the Raider. */
  const board = (enchanted: boolean): { s: GameState; smith: ObjectId } => {
    const s = scenario(['Plains'], { p1: { battlefield: ['Test Raider'] }, p2: { battlefield: ['Test Spark Smith'] }, defs: DEFS });
    const smith = find(s, 'Test Spark Smith', 'battlefield', 'p2');
    if (enchanted) s.objects[put(s, 'p1', 'battlefield', 'Test Frost Chains')]!.attachedTo = smith; // test setup: the Aura on the Smith (CR 303.4)
    return { s, smith };
  };
  const blockers = (s0: GameState): ObjectId[] => blockCandidates(s0, 'Test Raider');
  it('the card is fully automated', () => expect(full(CHAINS)).toBe(true));
  it('CR 509.1a: the enchanted creature is no possible blocker; without the Aura it is', () => {
    const e = board(true);
    expect(blockers(e.s)).not.toContain(e.smith);
    const plain = board(false);
    expect(blockers(plain.s)).toContain(plain.smith);
  });
  it('CR 602.5a: its activated ability cannot be activated; without the Aura it can', () => {
    const hasAbility = (s: GameState, id: ObjectId): boolean => legalActions(s, 'p2').some((a) => a.kind === 'activate' && a.object === id);
    const pass1 = (s: GameState): GameState => passUntil(s, (x) => x.pending?.kind === 'priority' && x.pending.player === 'p2', 'p2 priority');
    const e = board(true);
    expect(hasAbility(pass1(e.s), e.smith)).toBe(false);
    const p = board(false);
    expect(hasAbility(pass1(p.s), p.smith)).toBe(true);
  });
});

describe('CR 509.1b: "Creatures with flying can block only creatures with flying" (rst.each.blockonly)', () => {
  const CANOPY = card('Test Thick Canopy', 'Enchantment', 'Creatures with flying can block only creatures with flying.');
  const HAWK = card('Test Hawk', 'Creature — Bird', 'Flying', ['1', '1']);
  const WOLF = card('Test Wolf', 'Creature — Wolf', '', ['2', '2']);
  const OWL = card('Test Owl', 'Creature — Bird', 'Flying', ['1', '1']);
  const DEFS: CardDef[] = [CANOPY, HAWK, WOLF, OWL];
  const blockersFor = (attacker: string, canopy: boolean): string[] => {
    const s0 = scenario(['Plains'], { p1: { battlefield: [attacker, ...(canopy ? ['Test Thick Canopy'] : [])] }, p2: { battlefield: ['Test Hawk', 'Test Wolf'] }, defs: DEFS });
    return blockCandidates(s0, attacker).map((id) => s0.defs[s0.objects[id]!.defId]!.name).sort();
  };
  it('the card is fully automated', () => expect(full(CANOPY)).toBe(true));
  it('CR 509.1b: against a creature without flying, only the creature without flying may block', () => {
    expect(blockersFor('Test Wolf', true)).toEqual(['Test Wolf']);
    expect(blockersFor('Test Wolf', false)).toEqual(['Test Hawk', 'Test Wolf']);
  });
  it('CR 509.1b: against a creature with flying, the flier may block (the Wolf cannot: no reach)', () => {
    expect(blockersFor('Test Owl', true)).toEqual(['Test Hawk']);
  });
});

describe('CR 702.29a, 702.29e: "Wizardcycling {0}" (kw.typecycling.wizard)', () => {
  const STEP = card('Test Fold Step', 'Instant', 'You gain 1 life.\nWizardcycling {0}', undefined, '{3}{U}');
  const SAGE = card('Test Tower Sage', 'Creature — Human Wizard', '', ['1', '1']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
  const DEFS: CardDef[] = [STEP, SAGE, BEAR];
  it('the card is fully automated', () => expect(full(STEP)).toBe(true));
  it('CR 702.29e: discarding it searches for a Wizard card and puts it into the hand; a non-Wizard is never offered', () => {
    const s0 = scenario(['Island'], { p1: { hand: ['Test Fold Step'], library: ['Test Bear', 'Test Tower Sage', 'Test Bear'] }, defs: DEFS });
    const id = find(s0, 'Test Fold Step', 'hand', 'p1');
    const la = legal(s0, 'p1', 'activate').find((a) => a.object === id && !a.isMana);
    if (!la) throw new Error('no wizardcycling');
    let s = act(s0, la.action);
    expect(s.zones.graveyard['p1']!.map((g) => s.defs[s.objects[g]!.defId]!.name)).toContain('Test Fold Step'); // a new object there (CR 400.7)
    let offered: string[] = [];
    for (let guard = 0; guard < 10 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); guard++) {
      const d = s.pending as unknown as { kind: string; options?: ObjectId[] };
      if (d.kind === 'chooseObjects') {
        offered = (d.options ?? []).map((o) => s.defs[s.objects[o]!.defId]!.name);
        s = answer(s, { kind: 'chooseObjects', ids: (d.options ?? []).slice(0, 1) });
      } else if (d.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((n) => n === 'Test Tower Sage')).toBe(true);
    expect(s.zones.hand['p1']!.map((h) => s.defs[s.objects[h]!.defId]!.name)).toContain('Test Tower Sage');
  });
});

describe('CR 702.140d: "Whenever a creature you control mutates, put a +1/+1 counter on that creature and you gain 2 life" (trg.m6.yourCreature.mutates)', () => {
  const PATRON = compileCard({ name: 'Test Mutant Patron', layout: 'normal', mana_cost: '{0}', type_line: 'Creature — Beast', oracle_text: 'Whenever a creature you control mutates, put a +1/+1 counter on that creature and you gain 2 life.', colors: [], power: '1', toughness: '1' } as OracleCard);
  const drain = (s0: GameState): GameState => {
    let s = s0;
    for (let guard = 0; guard < 10 && s.zones.stack.length > 0; guard++) s = resolveTop(s);
    return s;
  };
  it('the card is fully automated', () => expect(full(PATRON)).toBe(true));
  it('CR 702.140d: mutating onto your Elves puts a +1/+1 counter on the merged creature and you gain 2 life', () => {
    let s = table([ELVES, 'Test Mutant Patron'], { defs: [PATRON] });
    const elves = find(s, ELVES, 'battlefield');
    const start = s.players[0]!.life;
    s = drain(resolveTop(mutate(s, elves), [{ kind: 'chooseOption', ids: ['over'] }]));
    expect(s.objects[elves]!.defId).toBe(GEMRAZER);
    expect(counters(s, elves, '+1/+1')).toBe(1);
    expect(s.players[0]!.life).toBe(start + 2);
  });
  it('CR 702.140d: casting the same creature normally (no mutate) does not trigger it', () => {
    let s = table([ELVES, 'Forest', 'Test Mutant Patron'], { defs: [PATRON] });
    const start = s.players[0]!.life;
    s = drain(settle(act(s, { type: 'cast', player: 'p1', card: find(s, GEMRAZER, 'hand') })));
    expect(s.players[0]!.life).toBe(start);
    expect(counters(s, find(s, ELVES, 'battlefield'), '+1/+1')).toBe(0);
  });
});
