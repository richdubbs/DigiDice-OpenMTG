/**
 * Commander lane edh-c, round edh-c-98 (EDHREC ranks 28,001-28,500, third pass): the round's readings played through the engine with synthetic cards (invented names), compiled by
 * the game's default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (see the round's record).
 *
 *   CR 118.12, 118.12a   "Unless an opponent pays {2}, gain control of target artifact for as long as ~ remains on the battlefield." (Scarwood Bandits)
 *   CR 118.12, 508.1     "Defending player may pay {4}. If that player doesn't, ~ can't be blocked this turn." (Shrouded Serpent)
 *   CR 608.2c, 400.7     "You may exile ~. If you do, return it to the battlefield under its owner's control at the beginning of the next end step." (Hikari, Twilight Guardian)
 *   CR 608.2c, 110.4     "Reveal the top card of your library. If it's a creature card, put it onto the battlefield. That creature gains haste until end of turn." (Killer Instinct)
 *   CR 701.9a, 122.1     "Discard any number of creature cards. For each card discarded this way, put two +1/+1 counters on ~." (Mind Maggots)
 *   CR 119.3, 701.20a    "Target player loses 1 life and reveals their hand." (Thoughtcutter Agent)
 *   CR 201.2, 608.2c     "Reveal the top card of your library. If it has the same name as a card in your graveyard, put it into your graveyard. Otherwise, draw a card." (Candles of Leng)
 *   CR 305.7, 608.2d     "You may have target land become a Plains until ~ leaves the battlefield." (Graceful Antelope)
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState, type ObjectId } from '../../../src/index';
import { act, activations, answer, card, cast, drive, find, full, lifeOf, obj, resolveAll, scenario } from '../r3-cost/support';
import { advanceTo, pass } from '../../m3/scenario';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['3', '3']);
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', '{0}', ['2', '2']);
const TRINKET = card('Test Trinket', 'Artifact', '', '{0}');
const counters = (s: GameState, id: ObjectId, kind: string): number => s.objects[id]!.counters[kind] ?? 0;
const handCount = (s: GameState, owner: string): number => Object.values(s.objects).filter((o) => o.zone === 'hand' && o.owner === owner).length;
const inZone = (s: GameState, name: string, zone: string, owner?: string): boolean => Object.values(s.objects).some((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner));

const BANDIT = card('Test Bandit', 'Creature — Human Rogue', '{T}: Unless an opponent pays {2}, gain control of target artifact for as long as this creature remains on the battlefield.', '{0}', ['2', '2']);
describe('CR 118.12, 118.12a, 613.1b: "Unless an opponent pays {2}, gain control of target artifact for as long as ~ remains on the battlefield." (Scarwood Bandits)', () => {
  const play = (opponentMana: number, pays: boolean) => {
    const s0 = scenario([], { defs: [BANDIT, TRINKET], p1: { battlefield: ['Test Bandit'] }, p2: { battlefield: ['Test Trinket', ...Array(opponentMana).fill('Plains')] } });
    const script = { targets: [[obj(find(s0, 'Test Trinket', 'battlefield', 'p2'))]], yes: [pays] };
    return resolveAll(drive(act(s0, (activations(s0, 'Test Bandit')[0] as unknown as { action: Parameters<typeof act>[1] }).action), script), script);
  };
  it('is automated', () => { expect(full(BANDIT)).toBe(true); });
  it('when the opponent does not pay, you gain control of the artifact', () => {
    const s = play(2, false);
    expect(s.objects[find(s, 'Test Trinket', 'battlefield')]!.controller).toBe('p1');
  });
  it('negative: when the opponent pays {2}, the artifact stays theirs', () => {
    const s = play(2, true);
    expect(s.objects[find(s, 'Test Trinket', 'battlefield')]!.controller).toBe('p2');
  });
});

const SERPENT = card('Test Serpent', 'Creature — Serpent', 'Whenever this creature attacks, defending player may pay {4}. If that player doesn\'t, this creature can\'t be blocked this turn.', '{0}', ['2', '2']);
describe('CR 118.12, 509.1b: "Defending player may pay {4}. If that player doesn\'t, ~ can\'t be blocked this turn." (Shrouded Serpent)', () => {
  const blocks = (pays: boolean, mana: number): boolean => {
    const s0 = scenario([], { defs: [SERPENT, BEAR], p1: { battlefield: ['Test Serpent'] }, p2: { battlefield: ['Test Bear', ...Array(mana).fill('Plains')] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Serpent', 'battlefield', 'p1')]]);
    s = resolveAll(drive(s, { yes: [pays] }), { yes: [pays] });
    // an unblockable attacker with no other restriction gives the defender no declare-blockers decision at all (CR 509.1): the game goes on to damage
    const turn = s.turn.number;
    for (let i = 0; i < 40 && s.turn.number === turn && s.pending?.kind === 'priority'; i++) s = pass(s);
    return s.turn.number === turn && s.pending?.kind === 'declareBlockers';
  };
  it('is automated', () => { expect(full(SERPENT)).toBe(true); });
  it('when the defending player does not pay, the creature cannot be blocked', () => { expect(blocks(false, 4)).toBe(false); });
  it('negative: when the defending player pays {4}, it can be blocked; with fewer than four mana the payment cannot be made', () => {
    expect(blocks(true, 4)).toBe(true);
    expect(blocks(true, 3)).toBe(false);
  });
});

const GUARDIAN = card('Test Guardian', 'Creature — Spirit', 'Whenever you cast a Spirit or Arcane spell, you may exile this creature. If you do, return it to the battlefield under its owner\'s control at the beginning of the next end step.', '{0}', ['2', '2']);
const WISP = card('Test Wisp', 'Creature — Spirit', '', '{0}', ['1', '1']);
const CHANT = card('Test Chant', 'Instant — Arcane', '');
describe('CR 608.2c, 400.7, 603.7: "You may exile ~. If you do, return it to the battlefield under its owner\'s control at the beginning of the next end step." (Hikari, Twilight Guardian)', () => {
  const play = (yes: boolean, spell = 'Test Wisp') => {
    const s0 = scenario([], { defs: [GUARDIAN, WISP, BEAR, CHANT], p1: { hand: [spell], battlefield: ['Test Guardian'] } });
    return { s0, s1: resolveAll(cast(s0, spell, { yes: [yes] }), { yes: [yes] }) };
  };
  it('is automated', () => { expect(full(GUARDIAN)).toBe(true); });
  it('on a Spirit cast it may leave and comes back at the next end step as a new object', () => {
    const { s1 } = play(true);
    expect(inZone(s1, 'Test Guardian', 'exile', 'p1')).toBe(true);
    const end = advanceTo(s1, 1, 'end');
    const back = resolveAll(end, { yes: [true] });
    expect(inZone(back, 'Test Guardian', 'battlefield', 'p1')).toBe(true);
    expect(inZone(back, 'Test Guardian', 'exile')).toBe(false);
  });
  it('negative: declining keeps it on the battlefield (nothing returns); a non-Spirit spell does not trigger it', () => {
    expect(inZone(play(false).s1, 'Test Guardian', 'battlefield', 'p1')).toBe(true);
    expect(inZone(play(true, 'Test Bear').s1, 'Test Guardian', 'battlefield', 'p1')).toBe(true);
  });
  it('an Arcane spell (not a Spirit) triggers it too: "Spirit or Arcane" names either subtype', () => {
    expect(inZone(play(true, 'Test Chant').s1, 'Test Guardian', 'exile', 'p1')).toBe(true);
  });
});

const INSTINCT = card('Test Instinct', 'Sorcery', 'Reveal the top card of your library. If it\'s a creature card, put it onto the battlefield. That creature gains haste until end of turn. Sacrifice it at the beginning of the next end step.');
describe('CR 608.2c, 702.10a, 701.21a: "If it\'s a creature card, put it onto the battlefield. That creature gains haste until end of turn. Sacrifice it at the beginning of the next end step." (Killer Instinct)', () => {
  const play = (top: string) => { const s0 = scenario([], { defs: [INSTINCT, BEAR, TRINKET], p1: { hand: ['Test Instinct'], library: [top, 'Plains'] } }); return resolveAll(cast(s0, 'Test Instinct')); };
  it('is automated', () => { expect(full(INSTINCT)).toBe(true); });
  it('a creature card goes onto the battlefield with haste and is sacrificed at the next end step', () => {
    const s = play('Test Bear');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(getChars(s, bear)!.keywords.map((k) => k.keyword)).toContain('haste');
    const later = resolveAll(advanceTo(s, 1, 'end'));
    expect(inZone(later, 'Test Bear', 'graveyard', 'p1')).toBe(true);
  });
  it('negative: a noncreature card stays on top of the library; nothing is sacrificed', () => {
    const s = play('Test Trinket');
    expect(inZone(s, 'Test Trinket', 'battlefield')).toBe(false);
    expect(inZone(s, 'Test Trinket', 'library', 'p1')).toBe(true);
    const later = resolveAll(advanceTo(s, 1, 'end'));
    expect(inZone(later, 'Test Trinket', 'graveyard')).toBe(false);
  });
});

const MAGGOTS = card('Test Maggots', 'Creature — Insect', 'When this creature enters, discard any number of creature cards. For each card discarded this way, put two +1/+1 counters on this creature.', '{0}', ['1', '1']);
describe('CR 701.9a, 701.9b, 122.1, 608.2h: "Discard any number of creature cards. For each card discarded this way, put two +1/+1 counters on ~." (Mind Maggots)', () => {
  const play = (pick: (ids: ObjectId[]) => ObjectId[]) => {
    const s0 = scenario([], { defs: [MAGGOTS, BEAR, GOBLIN, TRINKET], p1: { hand: ['Test Maggots', 'Test Bear', 'Test Goblin', 'Test Trinket'] } });
    const casted = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Maggots', 'hand', 'p1') }), {});
    let s = casted;
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) {
      s = pass(pass(s));
      if (s.pending?.kind === 'chooseObjects') { expect(s.pending.options.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Trinket')).toBe(false); s = answer(s, { kind: 'chooseObjects', ids: pick(s.pending.options) }); }
    }
    return s;
  };
  it('is automated', () => { expect(full(MAGGOTS)).toBe(true); });
  it('discarding both creature cards gives four +1/+1 counters (two for each); the other card stays in hand', () => {
    const s = play((ids) => ids);
    expect(counters(s, find(s, 'Test Maggots', 'battlefield', 'p1'), '+1/+1')).toBe(4);
    expect(inZone(s, 'Test Bear', 'graveyard', 'p1') && inZone(s, 'Test Goblin', 'graveyard', 'p1')).toBe(true);
    expect(inZone(s, 'Test Trinket', 'hand', 'p1')).toBe(true);
  });
  it('negative: discarding none gives no counters; discarding one gives two', () => {
    expect(counters(play(() => []), find(play(() => []), 'Test Maggots', 'battlefield', 'p1'), '+1/+1')).toBe(0);
    const one = play((ids) => ids.slice(0, 1));
    expect(counters(one, find(one, 'Test Maggots', 'battlefield', 'p1'), '+1/+1')).toBe(2);
  });
});

const AGENT = card('Test Agent', 'Artifact Creature — Rogue', '{T}: Target player loses 1 life and reveals their hand.', '{0}', ['1', '1']);
describe('CR 119.3, 701.20a: "Target player loses 1 life and reveals their hand." (Thoughtcutter Agent)', () => {
  const s0 = () => scenario([], { defs: [AGENT, BEAR], p1: { battlefield: ['Test Agent'] }, p2: { hand: ['Test Bear'] } });
  it('is automated', () => { expect(full(AGENT)).toBe(true); });
  it('the target player loses 1 life and the hand is revealed (the reveal is public: no decision, the life is lost)', () => {
    const s = s0();
    const script = { targets: [[{ kind: 'player', id: 'p2' }]] } as never;
    const after = resolveAll(drive(act(s, (activations(s, 'Test Agent')[0] as unknown as { action: Parameters<typeof act>[1] }).action), script), script);
    expect(lifeOf(after, 'p2')).toBe(19);
    expect(lifeOf(after, 'p1')).toBe(20);
  });
});

const CANDLES = card('Test Candles', 'Artifact', '{T}: Reveal the top card of your library. If it has the same name as a card in your graveyard, put it into your graveyard. Otherwise, draw a card.');
describe('CR 201.2, 608.2c: "If it has the same name as a card in your graveyard, put it into your graveyard. Otherwise, draw a card." (Candles of Leng)', () => {
  const play = (graveyard: string[]) => {
    const s0 = scenario([], { defs: [CANDLES, BEAR, GOBLIN], p1: { battlefield: ['Test Candles'], library: ['Test Bear', 'Plains'], graveyard } });
    return resolveAll(drive(act(s0, (activations(s0, 'Test Candles')[0] as unknown as { action: Parameters<typeof act>[1] }).action), {}), {});
  };
  it('is automated', () => { expect(full(CANDLES)).toBe(true); });
  it('a revealed card with the name of a card in your graveyard goes to the graveyard (no draw)', () => {
    const s = play(['Test Bear']);
    expect(s.zones.graveyard['p1']!.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear').length).toBe(2);
    expect(inZone(s, 'Test Bear', 'hand', 'p1')).toBe(false);
  });
  it('negative: a card whose name is not in your graveyard (a different name there) is drawn', () => {
    const s = play(['Test Goblin']);
    expect(inZone(s, 'Test Bear', 'hand', 'p1')).toBe(true);
  });
});

const ANTELOPE = card('Test Antelope', 'Creature — Antelope', 'Whenever this creature deals combat damage to a player, you may have target land become a Plains until this creature leaves the battlefield.', '{0}', ['2', '2']);
describe('CR 305.7, 608.2d, 611.2a: "You may have target land become a Plains until ~ leaves the battlefield." (Graceful Antelope)', () => {
  const play = (yes: boolean) => {
    const s0 = scenario(['Forest'], { defs: [ANTELOPE], p1: { battlefield: ['Test Antelope'] }, p2: { battlefield: ['Forest'] } });
    let s = declareAttackers(toDeclareAttackers(s0), [[find(s0, 'Test Antelope', 'battlefield', 'p1')]]);
    const script = { targets: [[obj(find(s0, 'Forest', 'battlefield', 'p2'))]], yes: [yes] };
    for (let i = 0; i < 30 && s.turn.step !== 'end' && s.turn.number === 1; i++) s = s.pending?.kind === 'priority' ? pass(s) : drive(s, script);
    return s;
  };
  it('is automated', () => { expect(full(ANTELOPE)).toBe(true); });
  it('after combat damage the targeted land is a Plains (it loses its Forest type)', () => {
    const s = play(true);
    expect(getChars(s, find(s, 'Forest', 'battlefield', 'p2'))!.subtypes).toEqual(['Plains']);
  });
  it('negative: declining the option leaves the land a Forest', () => {
    const s = play(false);
    expect(getChars(s, find(s, 'Forest', 'battlefield', 'p2'))!.subtypes).toEqual(['Forest']);
  });
});
