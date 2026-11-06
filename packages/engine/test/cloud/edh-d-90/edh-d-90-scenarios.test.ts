/**
 * Commander coordinator D, round edh-d-90 (EDHREC band 5,001-10,000, group combat): the round's readings and engine pieces played through the engine with synthetic cards
 * compiled by the game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites checked against
 * the Comprehensive Rules of 2026-09-25.
 *
 *   CR 601.2f, 118.7, 205.2a, 607.2a  "Spells you cast cost {1} less to cast for each card type they share with cards exiled with ~." (sta.edhd90.spells.costLess.perSharedCardType)
 *   CR 605.1a, 605.3a, 605.3b, 106.3, 603.2  "Whenever a mana ability of ~ resolves, put a number of +1/+1 counters on it equal to the amount of mana ~ produced. This ability triggers only once
 *                                    each turn." granted to each creature you control (parser/holes/event.ts, parser/holes/qty.ts `manaProduced`)
 *   CR 509.1, 509.1a, 509.1c, 611.2c  "Creatures your opponents control block this turn if able, and you choose how those creatures block." (eff.edhd90.opponents.blockIfAble.youChooseHow,
 *                                    op controlBlocks with `turn`, edh-d-89's turn-long form, core/combat.ts#declareBlockers)
 *   CR 603.7, 603.7b, 611.2a, 122.1   "Whenever ~ attacks, until the end of defending player's next turn, that player gets two rad counters whenever they cast a spell."
 *                                    (eff.edhd90.untilEndOfDefendersNextTurn.getsCounters.wheneverTheyCast)
 *   CR 509.3a-d, 603.2c, 608.2d, 607.2a  "Whenever ~ blocks or becomes blocked by one or more creatures, you may exile one of those creatures." and "Your opponents can't cast spells with the
 *                                    same name as a card exiled with ~." (parser/holes/event.ts, parser/lower/scope.ts, eff.edhd90.you.mayExile.oneOf)
 *   CR 611.2a, 601.3, 609.4b, 107.4c, 109.2  "Whenever a creature deals combat damage to enchanted player, that player exiles the top card of their library. Until end of turn, that creature's
 *                                    controller may play that card and they may spend mana as though it were mana of any color to cast that spell." (eff.edhd90.dur.playerMayPlay.theyAnyColor)
 *   CR 106.4, 500.5, 608.2c           "Whenever ~ attacks, add {W}{W}{W} and you gain 3 life. Until end of turn, you don't lose this mana as steps and phases end." (parser/lower/riders.ts)
 *   CR 107.3, 608.2h, 603.12, 701.21a "Whenever you attack, you may sacrifice X Foods. When you do, up to X target attacking creatures each get +3/+3 and gain trample and indestructible until end of
 *                                    turn." (eff.edhd90.you.maySacrifice.X, parser/lower/edhd90.ts#bindSacrificedX)
 *   CR 702.19b-f, 510.1c              "Trample over planeswalkers" (keywords/data/trample-over-planeswalkers.json, core/combat-damage.ts#assignAttacker) and CR 601.2f, 601.2i "This spell
 *                                    costs {3} less to cast for each other spell cast this turn." (cm.edhd90.self.less.perOtherSpellThisTurn)
 *   CR 611.2a, 601.3, 118.9           "Until end of turn, you may play one of those cards without paying its mana cost." (eff.edhd90.permit.play.oneOfGroup.free.durFirst)
 */
import { describe, expect, it } from 'vitest';
import { legalActions, type Action, type GameState, type ObjectId } from '../../../src/index';
import { act, advanceTo, answer, find, scenario } from '../../m3/scenario';
import { applyAction, getChars, mayActAs } from '../../../src/index';
import { card, counters, full, pt, resolveAll, settle } from '../cmd3/helpers';

const PROWLER = card('Test Prowler', 'Artifact', '{0}: Exile target card from a graveyard.\nSpells you cast cost {1} less to cast for each card type they share with cards exiled with Test Prowler.');
const ENGINE = card('Test Engine', 'Artifact Creature — Construct', '', ['2', '2'], '{2}');
const HOUND = card('Test Hound', 'Creature — Dog', '', ['2', '2'], '{2}');
const MITE = card('Test Mite', 'Creature — Insect', '', ['1', '1'], '{2}');
const BREW = card('Test Brew', 'Sorcery', 'You gain 2 life.', undefined, '{1}');
const SIP = card('Test Sip', 'Instant', 'You gain 1 life.', undefined, '{1}');
const DEFS = [PROWLER, ENGINE, HOUND, MITE, BREW, SIP];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const castAction = (s: GameState, name: string, player: 'p1' | 'p2' = 'p1'): Action | undefined =>
  legalActions(s, player).find((a) => a.kind === 'cast' && a.object !== undefined && nameOf(s, a.object) === name)?.action;
const activations = (s: GameState, name: string): Action[] =>
  legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object !== undefined && nameOf(s, a.object) === name).map((a) => a.action);
/** Activate the first ability of `source` ("{T}: Exile target card from a graveyard.") on the card named `what` in a graveyard. */
function exileWith(s0: GameState, source: string, what: string, owner: 'p1' | 'p2' = 'p1'): GameState {
  const target = find(s0, what, 'graveyard', owner);
  const a = activations(s0, source)[0]!;
  return resolveAll(settle(act(s0, a), { targets: [{ kind: 'object', id: target }] }), { targets: [{ kind: 'object', id: target }] });
}

describe('CR 601.2f, 205.2a, 607.2a: spells cost {1} less for each card type they share with cards exiled with ~ (Cemetery Prowler)', () => {
  it('an exiled artifact creature card: a {2} artifact creature spell costs {0} (two shared types), a {2} creature spell {1}, a sorcery its full cost', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Prowler'], graveyard: ['Test Engine'], hand: ['Test Engine', 'Test Hound', 'Test Brew'] } });
    expect(castAction(s, 'Test Engine')).toBeUndefined(); // nothing exiled yet: no reduction, no mana
    s = exileWith(s, 'Test Prowler', 'Test Engine');
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Engine')).toBe(true);
    expect(castAction(s, 'Test Engine')).toBeDefined();
    expect(castAction(s, 'Test Hound')).toBeUndefined(); // {1} left, no land
    expect(castAction(s, 'Test Brew')).toBeUndefined();
  });
  it('ruling 2021-11-19: two exiled creature cards reduce a creature spell by {1}, not {2} (the card types are counted, not the cards); with one land it is castable', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Prowler'], graveyard: ['Test Hound', 'Test Mite'], hand: ['Test Hound', 'Test Brew'] } });
    s = exileWith(exileWith(s, 'Test Prowler', 'Test Hound'), 'Test Prowler', 'Test Mite');
    expect(s.zones.exile.length).toBe(2);
    expect(castAction(s, 'Test Hound')).toBeUndefined(); // {2} - 1 = {1}, no land
    let w = scenario([], { defs: DEFS, p1: { battlefield: ['Test Prowler', 'Plains'], graveyard: ['Test Hound', 'Test Mite'], hand: ['Test Hound', 'Test Brew'] } });
    w = exileWith(exileWith(w, 'Test Prowler', 'Test Hound'), 'Test Prowler', 'Test Mite');
    expect(castAction(w, 'Test Hound')).toBeDefined(); // {1}: the Plains pays it
  });
  it('CR 607.2a: a card in exile that ~ did not exile reduces nothing; a card exiled with ~ that left exile no longer counts (CR 400.7)', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Prowler'], exile: ['Test Engine'], hand: ['Test Engine'] } });
    expect(castAction(s, 'Test Engine')).toBeUndefined();
  });
  it('the opponent\'s spells are not reduced (caster: you)', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Prowler'], graveyard: ['Test Sip'], hand: ['Test Sip'] }, p2: { hand: ['Test Sip'] } });
    s = exileWith(s, 'Test Prowler', 'Test Sip');
    expect(castAction(s, 'Test Sip')).toBeDefined(); // yours: {1} - 1
    const t = act(s, { type: 'pass', player: 'p1' });
    expect(t.pending?.player).toBe('p2');
    expect(castAction(t, 'Test Sip', 'p2')).toBeUndefined(); // the opponent's: still {1}, no land
  });
});

describe('CR 605.1a, 605.3b, 106.3: each creature you control has "Whenever a mana ability of ~ resolves, put a number of +1/+1 counters on it equal to the amount of mana ~ produced. This ability triggers only once each turn." (Tyvar the Bellicose)', () => {
  const BANNER = card('Test Banner', 'Enchantment', 'Each creature you control has "Whenever a mana ability of this creature resolves, put a number of +1/+1 counters on it equal to the amount of mana this creature produced. This ability triggers only once each turn."');
  const SPROUT = card('Test Sprout', 'Creature — Elf', '{T}: Add {G}.', ['1', '1']);
  const TWIN = card('Test Twin Sprout', 'Creature — Elf', '{T}: Add {G}{G}.', ['1', '1']);
  const PUMP = card('Test Pump Sprout', 'Creature — Elf', '{0}: Add {G}.', ['1', '1']);
  const STONE = card('Test Green Stone', 'Artifact', '{T}: Add {G}.');
  const D = [BANNER, SPROUT, TWIN, PUMP, STONE];
  const byName = (s: GameState, name: string, player = 'p1'): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name && s.objects[id]!.controller === player)!;
  const tapForMana = (s: GameState, source: ObjectId, player: 'p1' | 'p2' = 'p1'): GameState => {
    const a = legalActions(s, player).find((x) => x.kind === 'activate' && x.isMana === true && x.object === source);
    if (!a) throw new Error(`no mana ability of ${source}`);
    return act(s, a.action);
  };
  it('the synthetic cards are automated; the granted trigger is not a mana ability (it adds no mana, CR 605.1b): it uses the stack', () => {
    for (const d of D) expect(full(d), d.name).toBe(true);
    let s = scenario([], { defs: D, p1: { battlefield: ['Test Banner', 'Test Sprout'] } });
    const sprout = byName(s, 'Test Sprout');
    s = tapForMana(s, sprout);
    expect(s.zones.stack.length).toBe(1);
    expect(counters(s, sprout, '+1/+1')).toBe(0);
    s = resolveAll(settle(s));
    expect(counters(s, sprout, '+1/+1')).toBe(1);
  });
  it('the counters equal the mana that activation produced: {G}{G} gives two', () => {
    let s = scenario([], { defs: D, p1: { battlefield: ['Test Banner', 'Test Twin Sprout'] } });
    const twin = byName(s, 'Test Twin Sprout');
    s = resolveAll(settle(tapForMana(s, twin)));
    expect(counters(s, twin, '+1/+1')).toBe(2);
  });
  it('"triggers only once each turn": a second activation the same turn puts no more counters; ruling 2023-05-12: each creature\'s ability triggers once for that creature', () => {
    let s = scenario([], { defs: D, p1: { battlefield: ['Test Banner', 'Test Pump Sprout', 'Test Sprout'] } });
    const pump = byName(s, 'Test Pump Sprout');
    const sprout = byName(s, 'Test Sprout');
    s = resolveAll(settle(tapForMana(s, pump)));
    s = resolveAll(settle(tapForMana(s, pump)));
    expect(counters(s, pump, '+1/+1')).toBe(1);
    s = resolveAll(settle(tapForMana(s, sprout)));
    expect(counters(s, sprout, '+1/+1')).toBe(1);
  });
  it('negative: a noncreature mana source gets nothing (the grant is to creatures), and a creature of the player who does not control the grant has no such ability', () => {
    let s = scenario([], { defs: D, p1: { battlefield: ['Test Banner', 'Test Green Stone'] } });
    const stone = byName(s, 'Test Green Stone');
    s = tapForMana(s, stone);
    expect(s.zones.stack.length).toBe(0);
    expect(counters(s, stone, '+1/+1')).toBe(0);
    let t = scenario([], { defs: D, p1: { battlefield: ['Test Sprout'] }, p2: { battlefield: ['Test Banner'] } });
    const sprout = byName(t, 'Test Sprout');
    t = tapForMana(t, sprout);
    expect(t.zones.stack.length).toBe(0);
    expect(counters(resolveAll(settle(t)), sprout, '+1/+1')).toBe(0);
  });
});

describe('CR 509.1, 509.1a, 509.1c: "Creatures your opponents control block this turn if able, and you choose how those creatures block." (Brutal Hordechief)', () => {
  const HORDE = card('Test Horde Lord', 'Creature — Orc', '{0}: Creatures your opponents control block this turn if able, and you choose how those creatures block.', ['3', '3']);
  const RAIDER = card('Test Raider', 'Creature — Orc', '', ['2', '2']);
  const GUARD = card('Test Guard', 'Creature — Human', '', ['2', '2']);
  const SENTRY = card('Test Sentry', 'Creature — Human', '', ['1', '3']);
  const D = [HORDE, RAIDER, GUARD, SENTRY];
  const on = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name)!;
  const activateHorde = (s0: GameState, player: 'p1' | 'p2' = 'p1'): GameState => {
    const a = legalActions(s0, player).find((x) => x.kind === 'activate' && x.object !== undefined && nameOf(s0, x.object) === 'Test Horde Lord')!;
    return resolveAll(settle(act(s0, a.action)));
  };
  /** p1 attacks p2 with the Raider (and the Horde Lord when `both`); returns the state at the declare blockers decision. */
  const toBlocks = (s0: GameState, both = false): GameState => {
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    const attackers = both ? [on(s, 'Test Raider'), on(s, 'Test Horde Lord')] : [on(s, 'Test Raider')];
    s = resolveAll(answer(s, { kind: 'declareAttackers', attacks: attackers.map((attacker) => ({ attacker, defender: 'p2' })) }));
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareBlockers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    return s;
  };
  const start = (): GameState => scenario([], { defs: D, p1: { battlefield: ['Test Horde Lord', 'Test Raider'] }, p2: { battlefield: ['Test Guard', 'Test Sentry'] } });
  it('is full', () => expect(full(HORDE)).toBe(true));
  it('after the ability resolved, p2\'s declaration is made from p1\'s seat (decidedBy), and the blocks p1 chooses are made', () => {
    let s = toBlocks(activateHorde(start()));
    expect(s.pending!.kind).toBe('declareBlockers');
    expect(s.pending!.player).toBe('p2');
    expect(s.pending!.decidedBy).toBe('p1');
    const raider = on(s, 'Test Raider');
    const blocks = [{ blocker: on(s, 'Test Guard'), attacker: raider }, { blocker: on(s, 'Test Sentry'), attacker: raider }];
    const a = { type: 'answer' as const, player: 'p2' as const, decisionId: s.pending!.id, answer: { kind: 'declareBlockers' as const, blocks } };
    expect(mayActAs(s, 'p1', a)).toBe(true);
    expect(mayActAs(s, 'p2', a)).toBe(false);
    s = applyAction(s, a).state;
    expect(s.combat!.attackers.find((x) => x.id === raider)!.blockedBy.sort()).toEqual(blocks.map((b) => b.blocker).sort());
  });
  it('CR 509.1c: the creatures must block if able: an empty declaration, or one that leaves a creature able to block out, is refused; ruling 2014-11-24: the declaration must be legal', () => {
    const s = toBlocks(activateHorde(start()));
    const raider = on(s, 'Test Raider');
    const none = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [] } });
    expect(none.error).toBeDefined();
    const one = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: on(s, 'Test Guard'), attacker: raider }] } });
    expect(one.error).toBeDefined();
    const yours = applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: on(s, 'Test Horde Lord'), attacker: raider }] } });
    expect(yours.error).toBeDefined();
  });
  it('the negative case: without the ability, p2 declares their own blockers and may block with none', () => {
    let s = toBlocks(start());
    expect(s.pending!.decidedBy).toBeUndefined();
    s = answer(s, { kind: 'declareBlockers', blocks: [] });
    expect(s.combat!.blockers).toEqual([]);
  });
  it('"this turn": the choice is gone next turn; the chooser\'s own creatures are not "those creatures" (they declare their own blocks, and need not block)', () => {
    let s = activateHorde(start());
    expect(s.turn.blocksBy).toBe('p1');
    s = advanceTo(s, 2, 'upkeep');
    expect(s.turn.blocksBy).toBeUndefined();
    // on p2's turn p1 activates it again (instant speed), then p2 attacks p1: p1 declares p1's own blocks, and may declare none
    for (let i = 0; i < 10 && s.pending?.player !== 'p1'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = activateHorde(s, 'p1');
    expect(s.turn.blocksBy).toBe('p1');
    for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = resolveAll(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: on(s, 'Test Guard'), defender: 'p1' }] }));
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareBlockers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(s.pending!.player).toBe('p1');
    expect(s.pending!.decidedBy).toBeUndefined();
    s = answer(s, { kind: 'declareBlockers', blocks: [] });
    expect(s.combat!.blockers).toEqual([]);
  });
});

describe('CR 603.7b, 611.2a, 122.1: "until the end of defending player\'s next turn, that player gets two rad counters whenever they cast a spell" (Nuka-Nuke Launcher)', () => {
  const BOMBER = card('Test Bomber', 'Creature — Robot', "Whenever Test Bomber attacks, until the end of defending player's next turn, that player gets two rad counters whenever they cast a spell.", ['2', '2']);
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const D = [BOMBER, ZAP];
  const rad = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.counters['rad'] ?? 0;
  const attack = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    const bomber = s.zones.battlefield.find((id) => nameOf(s, id) === 'Test Bomber')!;
    return resolveAll(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bomber, defender: 'p2' }] }));
  };
  const zap = (s0: GameState, who: 'p1' | 'p2'): GameState => {
    let s = s0;
    for (let i = 0; i < 10 && s.pending?.player !== who; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    return resolveAll(settle(act(s, castAction(s, 'Test Zap', who)!)));
  };
  it('is full', () => expect(full(BOMBER)).toBe(true));
  it('the defending player gets two rad counters for each spell they cast, the rest of this turn and during their next turn; the attacking player\'s spells give none', () => {
    let s = attack(scenario([], { defs: D, p1: { battlefield: ['Test Bomber'], hand: ['Test Zap'] }, p2: { hand: ['Test Zap', 'Test Zap', 'Test Zap'] } }));
    expect(rad(s, 'p2')).toBe(0);
    s = zap(s, 'p2'); // still p1's turn, after the attack
    expect(rad(s, 'p2')).toBe(2);
    s = zap(s, 'p1');
    expect(rad(s, 'p1')).toBe(0);
    expect(rad(s, 'p2')).toBe(2);
    s = advanceTo(s, 2, 'upkeep');
    s = zap(s, 'p2'); // the defending player's next turn
    expect(rad(s, 'p2')).toBe(4);
  });
  it('the negative case: after the end of that player\'s next turn their spells give no more counters', () => {
    let s = attack(scenario([], { defs: D, p1: { battlefield: ['Test Bomber'] }, p2: { hand: ['Test Zap'] } }));
    s = advanceTo(s, 3, 'upkeep');
    const before = rad(s, 'p2');
    s = zap(s, 'p2');
    expect(rad(s, 'p2')).toBe(before);
  });
});

describe('CR 509.3c, 603.2c, 608.2d, 607.2a: "Whenever ~ blocks or becomes blocked by one or more creatures, you may exile one of those creatures." (Godsend)', () => {
  const ANGEL = card('Test Angel', 'Creature — Angel', "Whenever Test Angel blocks or becomes blocked by one or more creatures, you may exile one of those creatures.\nYour opponents can't cast spells with the same name as a card exiled with Test Angel.", ['3', '3']);
  const PAWN = card('Test Pawn', 'Creature — Human', '', ['1', '1']);
  const KNAVE = card('Test Knave', 'Creature — Human', '', ['1', '1']);
  const D = [ANGEL, PAWN, KNAVE];
  const on = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name)!;
  const toBlock = (s0: GameState, attackers: string[]): GameState => {
    let s = s0;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = resolveAll(answer(s, { kind: 'declareAttackers', attacks: attackers.map((n) => ({ attacker: on(s, n), defender: 'p2' })) }));
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareBlockers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    return s;
  };
  /** Resolve the stack, answering the "may" with `yes` and the choice with `pick`; returns the state and what the choice offered. */
  const resolveWith = (s0: GameState, yes: boolean, pick?: ObjectId): { s: GameState; offered: ObjectId[]; triggers: number } => {
    let s = s0;
    let offered: ObjectId[] = [];
    const triggers = s.zones.stack.length;
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      const d = s.pending!;
      if (d.kind === 'chooseObjects') { offered = (d as unknown as { options: ObjectId[] }).options; s = answer(s, { kind: 'chooseObjects', ids: [pick ?? offered[0]!] }); }
      else if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else s = settle(s);
    }
    return { s, offered, triggers };
  };
  it('is full', () => expect(full(ANGEL)).toBe(true));
  it('ruling 2014-04-26: blocked by two creatures it triggers ONCE; you choose one of them as it resolves (no target) and exile it; the other stays', () => {
    let s = toBlock(scenario([], { defs: D, p1: { battlefield: ['Test Angel'] }, p2: { battlefield: ['Test Pawn', 'Test Knave'] } }), ['Test Angel']);
    const angel = on(s, 'Test Angel');
    const pawn = on(s, 'Test Pawn');
    const knave = on(s, 'Test Knave');
    s = settle(answer(s, { kind: 'declareBlockers', blocks: [{ blocker: pawn, attacker: angel }, { blocker: knave, attacker: angel }] }));
    const r = resolveWith(s, true, knave);
    expect(r.triggers).toBe(1);
    expect([...r.offered].sort()).toEqual([pawn, knave].sort());
    expect(r.s.zones.exile.map((id) => nameOf(r.s, id))).toEqual(['Test Knave']);
    expect(r.s.zones.battlefield).toContain(pawn);
  });
  it('when it blocks, "those creatures" are the attackers it blocks (never itself); the opponent then can\'t cast a spell with the exiled card\'s name', () => {
    let s = toBlock(scenario([], { defs: D, p1: { battlefield: ['Test Pawn'], hand: ['Test Pawn', 'Test Knave'] }, p2: { battlefield: ['Test Angel'] } }), ['Test Pawn']);
    const pawn = on(s, 'Test Pawn');
    const angel = on(s, 'Test Angel');
    s = settle(answer(s, { kind: 'declareBlockers', blocks: [{ blocker: angel, attacker: pawn }] }));
    const r = resolveWith(s, true);
    expect(r.offered.length <= 1 && !r.offered.includes(angel)).toBe(true); // one option (the attacker): the Angel itself is never offered
    expect(r.s.zones.exile.map((id) => nameOf(r.s, id))).toEqual(['Test Pawn']);
    let t = r.s;
    for (let i = 0; i < 40 && !(t.turn.step === 'main2' && t.pending?.kind === 'priority'); i++) t = t.pending?.kind === 'priority' ? act(t, { type: 'pass', player: t.pending.player }) : settle(t);
    expect(castAction(t, 'Test Pawn', 'p1')).toBeUndefined(); // p1 is an opponent of the Angel's controller
    expect(castAction(t, 'Test Knave', 'p1')).toBeDefined();
  });
  it('the negative case: unblocked, nothing triggers; declining the "may" exiles nothing', () => {
    let s = toBlock(scenario([], { defs: D, p1: { battlefield: ['Test Angel'] }, p2: { battlefield: ['Test Pawn'] } }), ['Test Angel']);
    s = settle(answer(s, { kind: 'declareBlockers', blocks: [] }));
    expect(s.zones.stack.length).toBe(0);
    let t = toBlock(scenario([], { defs: D, p1: { battlefield: ['Test Angel'] }, p2: { battlefield: ['Test Pawn'] } }), ['Test Angel']);
    t = settle(answer(t, { kind: 'declareBlockers', blocks: [{ blocker: on(t, 'Test Pawn'), attacker: on(t, 'Test Angel') }] }));
    expect(resolveWith(t, false).s.zones.exile).toEqual([]);
  });
});

describe('CR 611.2a, 601.3, 609.4b: "Until end of turn, that creature\'s controller may play that card and they may spend mana as though it were mana of any color to cast that spell." (Curse of Hospitality)', () => {
  const CURSE = card('Test Welcome', 'Enchantment — Aura Curse', "Enchant player\nWhenever a creature deals combat damage to enchanted player, that player exiles the top card of their library. Until end of turn, that creature's controller may play that card and they may spend mana as though it were mana of any color to cast that spell.", undefined, '{0}');
  const RAIDER = card('Test Raider', 'Creature — Orc', '', ['2', '2']);
  const BREW = card('Test Red Brew', 'Sorcery', 'You gain 2 life.', undefined, '{R}');
  const D = [CURSE, RAIDER, BREW];
  const on = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name)!;
  /** p1 enchants p2 with the Curse, attacks p2 with the Raider and goes on to the second main phase. */
  const hit = (s0: GameState): GameState => {
    let s = resolveAll(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Welcome', 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] }), { targets: [{ kind: 'player', id: 'p2' }] });
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = resolveAll(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: on(s, 'Test Raider'), defender: 'p2' }] }));
    for (let i = 0; i < 80 && !(s.turn.step === 'main2' && s.pending?.kind === 'priority' && s.zones.stack.length === 0); i++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else s = settle(s);
    }
    return s;
  };
  const start = (): GameState => scenario([], { defs: D, p1: { battlefield: ['Test Raider', 'Plains'], hand: ['Test Welcome'] }, p2: { library: ['Test Red Brew'] } });
  it('is full', () => expect(full(CURSE)).toBe(true));
  it('the enchanted player exiles their top card; the creature\'s controller may cast it this turn with mana of any color (a Plains pays {R})', () => {
    const s = hit(start());
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Red Brew']);
    expect(castAction(s, 'Test Red Brew', 'p1')).toBeDefined();
    const before = s.players.find((p) => p.id === 'p1')!.life;
    const t = resolveAll(settle(act(s, castAction(s, 'Test Red Brew', 'p1')!)));
    expect(t.players.find((p) => p.id === 'p1')!.life).toBe(before + 2);
  });
  it('the negative cases: the enchanted player may not play it; after this turn the creature\'s controller may not either', () => {
    let s = hit(start());
    const t = act(s, { type: 'pass', player: 'p1' });
    expect(castAction(t, 'Test Red Brew', 'p2')).toBeUndefined();
    s = advanceTo(s, 3, 'main1');
    expect(castAction(s, 'Test Red Brew', 'p1')).toBeUndefined();
  });
});

describe('CR 106.4, 500.5, 608.2c: "add {W}{W}{W} and you gain 3 life. Until end of turn, you don\'t lose this mana as steps and phases end." (Colossal Plow)', () => {
  const PLOW = card('Test Plow', 'Creature — Ox', "Whenever Test Plow attacks, add {W}{W}{W} and you gain 3 life. Until end of turn, you don't lose this mana as steps and phases end.", ['6', '6']);
  const OX = card('Test Ox', 'Creature — Ox', 'Whenever Test Ox attacks, add {W}{W}{W} and you gain 3 life.', ['6', '6']);
  const D = [PLOW, OX];
  const pool = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.manaPool.length;
  const attackThenMain2 = (name: string): { atAttack: GameState; main2: GameState } => {
    let s = scenario([], { defs: D, p1: { battlefield: [name] } });
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    const me = s.zones.battlefield.find((id) => nameOf(s, id) === name)!;
    const atAttack = resolveAll(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: me, defender: 'p2' }] }));
    let m = atAttack;
    for (let i = 0; i < 80 && !(m.turn.step === 'main2' && m.pending?.kind === 'priority'); i++) {
      if (m.pending?.kind === 'declareBlockers') m = answer(m, { kind: 'declareBlockers', blocks: [] });
      else if (m.pending?.kind === 'priority') m = act(m, { type: 'pass', player: m.pending.player });
      else m = settle(m);
    }
    return { atAttack, main2: m };
  };
  it('is full', () => expect(full(PLOW)).toBe(true));
  it('the three mana and 3 life are gained; the mana is still in the pool in the second main phase', () => {
    const { atAttack, main2 } = attackThenMain2('Test Plow');
    expect(pool(atAttack)).toBe(3);
    expect(atAttack.players.find((p) => p.id === 'p1')!.life).toBe(23); // 20 + 3
    expect(pool(main2)).toBe(3);
  });
  it('the negative case: without the rider sentence the mana empties as the step ends (CR 500.5)', () => {
    const { atAttack, main2 } = attackThenMain2('Test Ox');
    expect(pool(atAttack)).toBe(3);
    expect(pool(main2)).toBe(0);
  });
});

describe('CR 107.3, 608.2h, 603.12: "you may sacrifice X Foods. When you do, up to X target attacking creatures each get +3/+3 ..." (Campsite Cuisine)', () => {
  const CUISINE = card('Test Cookout', 'Enchantment', 'Whenever you attack, you may sacrifice X Foods. When you do, up to X target attacking creatures each get +3/+3 and gain trample and indestructible until end of turn.');
  const FOOD = card('Test Snack', 'Artifact — Food', '');
  const BEAR = card('Test Cub', 'Creature — Bear', '', ['2', '2']);
  const D = [CUISINE, FOOD, BEAR];
  const cubs = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Cub');
  const snacks = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Snack');
  const toTrigger = (): GameState => {
    let s = scenario([], { defs: D, p1: { battlefield: ['Test Cookout', 'Test Snack', 'Test Snack', 'Test Snack', 'Test Cub', 'Test Cub', 'Test Cub'] } });
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    return settle(answer(s, { kind: 'declareAttackers', attacks: cubs(s).map((attacker) => ({ attacker, defender: 'p2' })) }));
  };
  it('is full', () => expect(full(CUISINE)).toBe(true));
  it('two Foods sacrificed: up to two attacking creatures get +3/+3, trample and indestructible; a third target is refused, the third creature is unchanged', () => {
    let s = toTrigger();
    const [a, b, c] = cubs(s);
    const two = snacks(s).slice(0, 2);
    let maxTargets = -1;
    for (let i = 0; i < 60 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); i++) {
      const d = s.pending!;
      if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: two });
      else if (d.kind === 'chooseTargets') {
        maxTargets = (d as unknown as { specs: { max: number }[] }).specs?.[0]?.max ?? maxTargets;
        const three = applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'chooseTargets', targets: [a, b, c].map((id) => ({ kind: 'object' as const, id: id! })) } });
        expect(three.error).toBeDefined();
        s = answer(s, { kind: 'chooseTargets', targets: [a, b].map((id) => ({ kind: 'object' as const, id: id! })) });
      } else if (d.kind === 'priority') s = act(s, { type: 'pass', player: d.player });
      else s = settle(s);
    }
    expect(snacks(s).length).toBe(1);
    expect(pt(s, a!)).toBe('5/5');
    expect(pt(s, b!)).toBe('5/5');
    expect(pt(s, c!)).toBe('2/2');
    expect(JSON.stringify(getChars(s, a!)!.keywords)).toMatch(/trample.*indestructible|indestructible.*trample/);
  });
  it('the negative case: declining sacrifices nothing and pumps nothing', () => {
    let s = toTrigger();
    s = resolveAll(s, { yes: false });
    expect(snacks(s).length).toBe(3);
    expect(cubs(s).every((id) => pt(s, id) === '2/2')).toBe(true);
  });
});

describe('CR 702.19c: trample over planeswalkers; CR 601.2f: "This spell costs {3} less to cast for each other spell cast this turn." (Thrasta, Tempest\'s Roar)', () => {
  const STOMPER = card('Test Stomper', 'Creature — Dinosaur', 'Trample over planeswalkers', ['5', '5']);
  const GIANT = card('Test Giant', 'Creature — Giant', 'Trample over planeswalkers', ['7', '7']);
  const TRAMPLER = card('Test Trampler', 'Creature — Beast', 'Trample', ['5', '5']);
  const WALKER = card('Test Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.');
  const WALL = card('Test Wall', 'Creature — Wall', '', ['3', '3']);
  const TITAN = card('Test Titan', 'Creature — Dinosaur', 'This spell costs {3} less to cast for each other spell cast this turn.', ['6', '6'], '{6}');
  const SIP = card('Test Sip', 'Instant', 'You gain 1 life.');
  const D = [STOMPER, GIANT, TRAMPLER, WALKER, WALL, TITAN, SIP];
  const on = (s: GameState, name: string): ObjectId => s.zones.battlefield.find((id) => nameOf(s, id) === name)!;
  const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  /** p1 attacks p2's planeswalker with `attacker`; p2 blocks with `blockers`; stops at the damage assignment decision (or after damage when there is none). */
  const toDamage = (attacker: string, loyalty: number, blockers: string[] = []): GameState => {
    let s = scenario([], { defs: D, p1: { battlefield: [attacker] }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty } }, ...blockers] } });
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    s = resolveAll(answer(s, { kind: 'declareAttackers', attacks: [{ attacker: on(s, attacker), defender: on(s, 'Test Walker') }] }));
    for (let i = 0; i < 60 && s.pending?.kind !== 'assignDamage' && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: blockers.map((b) => ({ blocker: on(s, b), attacker: on(s, attacker) })) });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    return s;
  };
  const assign = (s: GameState, amounts: [string, number][]) => applyAction(s, { type: 'answer', player: s.pending!.player, decisionId: s.pending!.id, answer: { kind: 'assignDamage', amounts: amounts.map(([id, amount]) => ({ id, amount })) } });
  it('the synthetic cards are full', () => { for (const d of [STOMPER, GIANT, TITAN]) expect(full(d), d.name).toBe(true); });
  it('unblocked, attacking a planeswalker with 2 loyalty: 2 to the planeswalker and 3 to its controller; the controller gets nothing before the planeswalker has its loyalty', () => {
    const s = toDamage('Test Stomper', 2);
    expect(s.pending!.kind).toBe('assignDamage');
    const walker = on(s, 'Test Walker');
    expect(assign(s, [[walker, 1], ['p2', 4]]).error).toBeDefined();
    const t = assign(s, [[walker, 2], ['p2', 3]]);
    expect(t.error).toBeUndefined();
    expect(life(t.state, 'p2')).toBe(17);
    expect(t.state.zones.battlefield.includes(walker)).toBe(false);
  });
  it('ruling 2021-06-18: blocked by a 3/3 while attacking a planeswalker with 2 loyalty, a 7/7 assigns 3, 2 and 2; the planeswalker gets nothing before the blocker has lethal damage', () => {
    const s = toDamage('Test Giant', 2, ['Test Wall']);
    expect(s.pending!.kind).toBe('assignDamage');
    const walker = on(s, 'Test Walker');
    const wall = on(s, 'Test Wall');
    expect(assign(s, [[wall, 2], [walker, 5]]).error).toBeDefined();
    const t = assign(s, [[wall, 3], [walker, 2], ['p2', 2]]);
    expect(t.error).toBeUndefined();
    expect(life(t.state, 'p2')).toBe(18);
  });
  it('the negative case (CR 702.19f): plain trample attacking a planeswalker never assigns to the player: all 5 go to the planeswalker unblocked', () => {
    const s = toDamage('Test Trampler', 2);
    expect(s.pending?.kind).not.toBe('assignDamage');
    expect(life(s, 'p2')).toBe(20);
  });
  it('with damage no greater than the loyalty there is nothing to choose: all of it goes to the planeswalker', () => {
    const s = toDamage('Test Stomper', 6);
    expect(s.pending?.kind).not.toBe('assignDamage');
    expect(life(s, 'p2')).toBe(20);
    expect(s.objects[on(s, 'Test Walker')]!.counters['loyalty']).toBe(1);
  });
  const KNIGHT = card('Test Knight', 'Creature — Knight', 'First strike', ['3', '3']);
  /** p1 attacks `defName` with `attackers`, nobody blocks; each damage assignment gives the first recipient its lethal and the last the rest. */
  const fight = (attackers: string[], p1bf: (string | { name: string; counters: Record<string, number> })[], p2bf: (string | { name: string; counters: Record<string, number> })[], defName: string, names: string[] = []): GameState => {
    let s = scenario(names, { defs: [...D, KNIGHT], p1: { battlefield: p1bf }, p2: { battlefield: p2bf } });
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
    const def = s.zones.battlefield.find((id) => nameOf(s, id) === defName)!;
    s = resolveAll(answer(s, { kind: 'declareAttackers', attacks: attackers.map((a) => ({ attacker: on(s, a), defender: def })) }));
    for (let i = 0; i < 80 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'assignDamage') {
        const r = (d as unknown as { recipients: { id: string; lethal: number }[]; amount: number });
        s = assign(s, [[r.recipients[0]!.id, r.recipients[0]!.lethal], [r.recipients[r.recipients.length - 1]!.id, r.amount - r.recipients[0]!.lethal]]).state;
      } else s = act(s, { type: 'pass', player: d.player });
    }
    return s;
  };
  it('CR 702.19e: the planeswalker it attacks is removed from combat (a first striker kills it): unblocked, all its damage goes to the defending player; plain trample gives none (CR 702.19f)', () => {
    const s = fight(['Test Stomper', 'Test Knight'], ['Test Stomper', 'Test Knight'], [{ name: 'Test Walker', counters: { loyalty: 2 } }], 'Test Walker');
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Walker')).toBe(false);
    expect(life(s, 'p2')).toBe(15);
    const t = fight(['Test Trampler', 'Test Knight'], ['Test Trampler', 'Test Knight'], [{ name: 'Test Walker', counters: { loyalty: 2 } }], 'Test Walker');
    expect(life(t, 'p2')).toBe(20);
  });
  it('ruling 2021-06-18: with a 2/2 also attacking the same planeswalker (7 loyalty), unblocked, the trampler may assign 5 to the planeswalker and 2 to the player, whatever the order of the attackers', () => {
    const CUB = card('Test Cub', 'Creature — Bear', '', ['2', '2']);
    for (const order of [['Test Giant', 'Test Cub'], ['Test Cub', 'Test Giant']]) {
      let s = scenario([], { defs: [...D, CUB], p1: { battlefield: order }, p2: { battlefield: [{ name: 'Test Walker', counters: { loyalty: 7 } }] } });
      for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = act(s, { type: 'pass', player: s.pending!.player });
      const walker = on(s, 'Test Walker');
      s = resolveAll(answer(s, { kind: 'declareAttackers', attacks: order.map((a) => ({ attacker: on(s, a), defender: walker })) }));
      for (let i = 0; i < 60 && s.pending?.kind !== 'assignDamage'; i++) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : act(s, { type: 'pass', player: s.pending!.player });
      expect(s.pending!.kind).toBe('assignDamage');
      const t = assign(s, [[walker, 5], ['p2', 2]]);
      expect(t.error, order.join()).toBeUndefined();
      expect(life(t.state, 'p2')).toBe(18);
    }
  });
  it('the negative case: attacking a battle, trample over planeswalkers changes nothing: the damage goes to the battle, never its protector', () => {
    const siege = 'Invasion of Ergamon // Truga Cliffcharger';
    const s = fight(['Test Stomper'], ['Test Stomper', { name: siege, counters: { defense: 9 } }], [], siege, [siege]);
    const b = s.zones.battlefield.find((id) => nameOf(s, id).startsWith('Invasion'))!;
    expect(life(s, 'p2')).toBe(20);
    expect(s.objects[b]!.counters['defense']).toBe(4);
  });
  it('the cost: each other spell cast this turn, by any player, makes it {3} cheaper; with none it costs {6}', () => {
    let s = scenario([], { defs: D, p1: { hand: ['Test Titan', 'Test Sip', 'Test Sip'] }, p2: { hand: ['Test Sip'] } });
    expect(castAction(s, 'Test Titan')).toBeUndefined();
    s = resolveAll(settle(act(s, castAction(s, 'Test Sip')!)));
    expect(castAction(s, 'Test Titan')).toBeUndefined(); // {3} left
    const t = act(s, { type: 'pass', player: 'p1' });
    const u = resolveAll(settle(act(t, castAction(t, 'Test Sip', 'p2')!)));
    expect(u.turn.activePlayer).toBe('p1');
    expect(castAction(u, 'Test Titan')).toBeDefined(); // two other spells: {0}
  });
});

describe('CR 601.3, 118.9: "Until end of turn, you may play one of those cards without paying its mana cost." (Fire Lord Ozai)', () => {
  const LORD = card('Test Fire Lord', 'Legendary Creature — Human', "{0}: Exile the top two cards of target player's library. Until end of turn, you may play one of those cards without paying its mana cost.", ['4', '4']);
  const BREW = card('Test Red Brew', 'Sorcery', 'You gain 2 life.', undefined, '{R}');
  const D = [LORD, BREW];
  const activate = (s0: GameState): GameState => {
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && x.object !== undefined && nameOf(s0, x.object) === 'Test Fire Lord')!;
    return resolveAll(settle(act(s0, a.action), { targets: [{ kind: 'player', id: 'p2' }] }), { targets: [{ kind: 'player', id: 'p2' }] });
  };
  const start = (): GameState => scenario([], { defs: D, p1: { battlefield: ['Test Fire Lord'] }, p2: { library: ['Test Red Brew', 'Test Red Brew'] } });
  it('is full', () => expect(full(LORD)).toBe(true));
  it('one of the two exiled cards is cast with no mana; then the other may not be cast (one card only)', () => {
    let s = activate(start());
    expect(s.zones.exile.filter((id) => nameOf(s, id) === 'Test Red Brew').length).toBe(2);
    expect(castAction(s, 'Test Red Brew')).toBeDefined();
    const before = s.players.find((p) => p.id === 'p1')!.life;
    s = resolveAll(settle(act(s, castAction(s, 'Test Red Brew')!)));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(before + 2);
    expect(castAction(s, 'Test Red Brew')).toBeUndefined();
  });
  it('the negative case: next turn the exiled cards may not be played', () => {
    let s = activate(start());
    s = advanceTo(s, 3, 'main1');
    expect(castAction(s, 'Test Red Brew')).toBeUndefined();
  });
});
