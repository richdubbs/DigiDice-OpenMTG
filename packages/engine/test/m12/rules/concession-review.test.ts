/**
 * M12-2 review fixes (m12 design D11; CR 104.3a, 800.4a): the re-run of an action after a concession.
 *  1. An answer never passes from one player to another (`Suspension.answeredBy`, core/game.ts#choose); the conceder's answers are dropped.
 *  2. A concession before the game begins changes no library, hand or answer of the other players (core/start.ts applies it where it was made).
 *  3. A concession while another concession waits for a decision: both are applied, in order, to the settled state of the action they interrupted.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, createGame, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, concede, find, logHas, mpConfig, mpScenario, passUntil, playerOf } from './helpers';

const handCards = (s: GameState, p: string): string[] => s.zones.hand[p]!.map((id) => s.objects[id]!.cardId!).sort();

describe('M12-2 review fix 1: answers stay with the player who gave them (CR 104.3a, m12 design D11)', () => {
  it('CR 802.4: Bob declared no blockers and concedes while Carol declares hers: Carol is still asked (Bob\'s answer never becomes hers)', () => {
    let s = mpScenario({ cards: ['Grizzly Bears'], zones: { p1: { battlefield: ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] }, p2: { battlefield: ['Grizzly Bears'] }, p3: { battlefield: ['Grizzly Bears'] }, p4: { battlefield: ['Grizzly Bears'] } } });
    const mine = s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1');
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: mine[0]!, defender: 'p2' }, { attacker: mine[1]!, defender: 'p3' }, { attacker: mine[2]!, defender: 'p4' }] });
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the blocks');
    expect(s.pending?.player).toBe('p2');
    s = answer(s, { kind: 'declareBlockers', blocks: [] });
    expect(s.pending).toMatchObject({ kind: 'declareBlockers', player: 'p3' });
    const t = concede(s, 'p2').state;
    expect(t.pending).toMatchObject({ kind: 'declareBlockers', player: 'p3' });
    expect(logHas(t, /Carol declares no blockers/)).toBe(false);
    expect(t.suspended?.answers).toEqual([]);
    expect(t.suspended?.answeredBy).toEqual([]);
  });

  it('CR 103.5: Alice keeps, Bob mulligans, Carol is deciding; Bob concedes: Carol is still asked, Alice still kept', () => {
    const cfg = mpConfig();
    let s = createGame({ ...cfg, options: { ...cfg.options, skipMulligans: false } });
    s = answer(s, { kind: 'mulligan', keep: true });
    s = answer(s, { kind: 'mulligan', keep: false });
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p3' });
    expect(s.suspended?.answeredBy).toEqual(['p1', 'p2']);
    const t = concede(s, 'p2').state;
    expect(t.pending).toMatchObject({ kind: 'mulligan', player: 'p3', mulligans: 0 });
    expect(t.log.filter((l) => /keeps\./.test(l.text)).map((l) => l.text)).toEqual(['Alice keeps.']);
  });

  it('m12 design D16: a two-player suspension records no answeredBy', () => {
    const cfg = mpConfig({ players: 3 });
    const two = createGame({ ...cfg, players: cfg.players.slice(0, 2), options: { startingPlayer: 'p1' } });
    const t = answer(two, { kind: 'mulligan', keep: true });
    expect(Object.hasOwn(t.suspended!, 'answeredBy')).toBe(false);
  });
});

describe('M12-2 review fix 2: a concession before the game begins (CR 103, 104.3a)', () => {
  it('Alice mulligans, Bob, Carol and Dan keep, Alice decides again; Bob concedes: every other library and hand stays as it was, and Alice is still asked', () => {
    const cfg = mpConfig();
    let s = createGame({ ...cfg, options: { ...cfg.options, skipMulligans: false } });
    s = answer(s, { kind: 'mulligan', keep: false });
    for (let i = 0; i < 3; i++) s = answer(s, { kind: 'mulligan', keep: true });
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p1' });
    const before = { p1: handCards(s, 'p1'), p3: handCards(s, 'p3'), p4: handCards(s, 'p4'), lib3: s.zones.library['p3']!.map((id) => s.objects[id]!.cardId) };
    const t = concede(s, 'p2').state;
    expect(t.pending).toMatchObject({ kind: 'mulligan', player: 'p1', mulligans: 1 });
    expect(handCards(t, 'p1')).toEqual(before.p1);
    expect(handCards(t, 'p3')).toEqual(before.p3);
    expect(handCards(t, 'p4')).toEqual(before.p4);
    expect(t.zones.library['p3']!.map((id) => t.objects[id]!.cardId)).toEqual(before.lib3);
    expect(playerOf(t, 'p2').left).toBeDefined();
    expect(t.zones.hand['p2']).toEqual([]);
    expect(t.log.filter((l) => /keeps\./.test(l.text)).map((l) => l.text)).toEqual(['Bob keeps.', 'Carol keeps.', 'Dan keeps.']);
    const u = answer(t, { kind: 'mulligan', keep: true });
    expect(u.stage).toBe('playing');
    expect(handCards(u, 'p3')).toEqual(before.p3); // Carol draws nothing before her turn
    expect(u.players.filter((p) => p.left).map((p) => p.id)).toEqual(['p2']);
  });

  it('two players concede before the start, one after the other: both leave, in the order they conceded, and the start goes on', () => {
    const cfg = mpConfig();
    let s = createGame({ ...cfg, options: { ...cfg.options, skipMulligans: false } });
    s = answer(s, { kind: 'mulligan', keep: true });
    const t = concede(concede(s, 'p3').state, 'p4').state;
    expect(t.pending).toMatchObject({ kind: 'mulligan', player: 'p2' });
    expect([playerOf(t, 'p3').left?.order, playerOf(t, 'p4').left?.order]).toEqual([1, 2]);
  });
});

describe('M12-2 review fix 3: a concession while another concession waits for a decision (CR 104.3a, 800.4a)', () => {
  it('Alice\'s Shock at Carol is taken back once Carol concedes; Dan concedes while Bob chooses a target: Alice\'s cast stays taken back, Carol left first', () => {
    const watcher = compileCard({ name: 'Life Watcher', layout: 'normal', mana_cost: '{1}', type_line: 'Enchantment', oracle_text: 'Whenever a creature leaves the battlefield, target player gains 1 life.' } as OracleCard);
    let s = mpScenario({
      cards: ['Shock', 'Mountain', 'Grizzly Bears'], defs: [watcher],
      zones: { p1: { hand: ['Shock'], battlefield: ['Mountain'] }, p2: { battlefield: ['Life Watcher'] }, p3: { battlefield: ['Grizzly Bears'] }, p4: { battlefield: ['Grizzly Bears'] } },
    });
    const mountain = find(s, 'Mountain', 'battlefield', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] });
    expect(s.pending?.kind).toBe('payCost');
    s = concede(s, 'p3').state;
    expect(s.pending).toMatchObject({ kind: 'chooseTargets', player: 'p2' }); // Bob's trigger for Carol's Bears
    expect(s.suspended?.action).toEqual({ type: 'concede', player: 'p3' });
    const t = concede(s, 'p4').state;
    expect(t.zones.stack.every((id) => t.objects[id]!.kind === 'ability')).toBe(true); // no Shock on the stack
    expect(t.zones.hand['p1']!.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Shock')).toBe(true);
    expect(t.objects[mountain]!.tapped).toBe(false);
    expect(logHas(t, /Alice's action in progress is taken back/, 'CR 733.1')).toBe(true);
    expect([playerOf(t, 'p3').left?.order, playerOf(t, 'p4').left?.order]).toEqual([1, 2]);
    const concedes = t.log.filter((l) => /concedes\.$/.test(l.text)).map((l) => l.text);
    expect(concedes).toEqual(['Carol concedes.', 'Dan concedes.']);
  });
});
