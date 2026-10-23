/**
 * M12-2 (docs/design/m12-multiplayer.md D11, E8): a concession while another player's action is suspended (CR 104.3a). The concession is applied to the
 * state the action started from, then the action is run again with the answers already given; it is rolled back only when it no longer fits.
 */
import { describe, expect, it } from 'vitest';
import { createGame, type GameState } from '../../../src/index';
import { act, answer, concede, find, logHas, mpConfig, mpScenario, passUntil, playerOf } from './helpers';

/** Alice attacks Carol with one Grizzly Bears and Dan with the other; Carol and Dan each have a Grizzly Bears to block with. */
function attackCarolAndDan(): { s: GameState; toCarol: string; toDan: string } {
  let s = mpScenario({ cards: ['Grizzly Bears'], zones: { p1: { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }, p3: { battlefield: ['Grizzly Bears'] }, p4: { battlefield: ['Grizzly Bears'] } } });
  const [toCarol, toDan] = s.zones.battlefield.filter((id) => s.objects[id]!.owner === 'p1');
  s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the attack declaration');
  // declared Dan's first: the blocks are still asked in APNAP order (CR 802.4)
  s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: toDan!, defender: 'p4' }, { attacker: toCarol!, defender: 'p3' }] });
  s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers', 'the blocks');
  return { s, toCarol: toCarol!, toDan: toDan! };
}

describe('CR 104.3a, m12 design D11: a concession during another player\'s suspended action', () => {
  it('CR 802.4: the defending players declare blockers in APNAP order (Carol before Dan, whatever the order of the attacks)', () => {
    const { s } = attackCarolAndDan();
    expect(s.pending).toMatchObject({ kind: 'declareBlockers', player: 'p3' });
  });

  it('CR 104.3a: a concession during another player\'s blocks re-runs them: the blocks already declared are kept, the next defending player is asked again', () => {
    let { s, toCarol } = attackCarolAndDan();
    const carols = find(s, 'Grizzly Bears', 'battlefield', 'p3');
    s = answer(s, { kind: 'declareBlockers', blocks: [{ blocker: carols, attacker: toCarol }] });
    expect(s.pending).toMatchObject({ kind: 'declareBlockers', player: 'p4' });
    const t = concede(s, 'p2').state; // Bob, not in this combat, concedes
    expect(playerOf(t, 'p2').left).toBeDefined();
    expect(t.pending).toMatchObject({ kind: 'declareBlockers', player: 'p4' });
    expect(t.suspended?.answers).toEqual([{ kind: 'declareBlockers', blocks: [{ blocker: carols, attacker: toCarol }] }]);
    expect(logHas(t, /taken back/)).toBe(false);
    const u = answer(t, { kind: 'declareBlockers', blocks: [] });
    expect(u.combat?.attackers.find((a) => a.id === toCarol)?.blockedBy).toEqual([carols]);
  });

  it('CR 104.3a, 800.4a, 800.4e: the defending player who is deciding concedes: their blocks are not asked any more, what attacked them attacks nothing', () => {
    let { s, toCarol } = attackCarolAndDan();
    s = concede(s, 'p3').state;
    expect(s.pending).toMatchObject({ kind: 'declareBlockers', player: 'p4' });
    expect(s.combat?.attackers.find((a) => a.id === toCarol)?.defender).toBeNull();
    s = answer(s, { kind: 'declareBlockers', blocks: [] });
    s = passUntil(s, (x) => x.turn.step === 'endCombat', 'the end of combat');
    expect(playerOf(s, 'p4').life).toBe(18);
    expect(s.players.filter((p) => p.life !== 20).map((p) => p.id)).toEqual(['p4']); // CR 800.4e: no damage to Carol
  });

  it('CR 104.3a: a concession during another player\'s cast re-runs it with the answers already given (the targets stay chosen)', () => {
    let s = mpScenario({ cards: ['Shock', 'Mountain'], zones: { p1: { hand: ['Shock'], battlefield: ['Mountain'] } } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p4' }] });
    expect(s.pending?.kind).toBe('payCost');
    const t = concede(s, 'p2').state;
    expect(t.pending).toMatchObject({ kind: 'payCost', player: 'p1' });
    const u = answer(t, { kind: 'payCost', auto: true });
    expect(u.zones.stack).toHaveLength(1);
    expect(u.objects[u.zones.stack[0]!]!.stack!.targets).toEqual([[{ kind: 'player', id: 'p4' }]]);
  });

  it('CR 104.3a, 800.4a: an answer that no longer fits (the target conceded) rolls the action back to the state after the concession, with a log line', () => {
    let s = mpScenario({ cards: ['Shock', 'Mountain'], zones: { p1: { hand: ['Shock'], battlefield: ['Mountain'] } } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'hand', 'p1') });
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] });
    const t = concede(s, 'p3').state;
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(t.zones.stack).toEqual([]);
    expect(t.zones.hand['p1']!.map((id) => t.defs[t.objects[id]!.defId]!.name)).toContain('Shock');
    expect(logHas(t, /Alice's action in progress is taken back/, 'CR 733.1')).toBe(true);
  });

  it('CR 104.3a: the acting player concedes: their own action is abandoned', () => {
    let s = mpScenario({ cards: ['Shock', 'Mountain'], zones: { p1: { hand: ['Shock'], battlefield: ['Mountain'] } } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'hand', 'p1') });
    const t = concede(s, 'p1').state;
    expect(t.zones.stack).toEqual([]);
    expect(t.pending).toMatchObject({ kind: 'priority', player: 'p2' });
    expect(logHas(t, /taken back/)).toBe(false);
  });

  it('CR 103.5c, 800.6, 104.3a: before the game begins, the first mulligan is free; a concession re-runs the start procedure without the leaver', () => {
    const cfg = mpConfig({ players: 3 });
    let s = createGame({ ...cfg, options: { ...cfg.options, skipMulligans: false } });
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p1', handSize: 7 }); // CR 800.6: the first mulligan doesn't count
    s = answer(s, { kind: 'mulligan', keep: true });
    expect(s.pending).toMatchObject({ kind: 'mulligan', player: 'p2' });
    const t = concede(s, 'p2').state;
    expect(playerOf(t, 'p2').left).toBeDefined();
    expect(t.zones.hand['p2']).toEqual([]);
    expect(t.zones.library['p2']).toEqual([]);
    expect(t.pending).toMatchObject({ kind: 'mulligan', player: 'p3' }); // Alice's keep stays; Bob is not asked any more
    const u = answer(t, { kind: 'mulligan', keep: false });
    expect(u.pending).toMatchObject({ kind: 'mulligan', player: 'p3', handSize: 6 }); // the free one taken: the next costs a card
    expect(u.zones.hand['p3']).toHaveLength(7);
    expect(u.log.some((l) => /takes mulligan number 1 \(free\)/.test(l.text) && (l.rules ?? []).includes('CR 800.6'))).toBe(true);
  });
});
