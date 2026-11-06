/**
 * edh-d-84 (Commander coordinator D, lane must-finish-5000; Yes Man, Personal Securitron #3821): the round's readings played through the engine with a synthetic card
 * (invented name, the same wording, design 6.10) compiled by the game's default compiler, in a four-player game (Alice p1 is the active player of turn 1). Each test
 * names the rule it checks, with its negative case. CR cites are from the Comprehensive Rules of 2026-09-25 (media.wizards.com text, fetched 2026-11-05).
 *
 *   CR 603.12, 608.2c, 613.1b  "{T}: Target opponent gains control of ~. When they do, you draw two cards and put a quest counter on ~." (the reflexive trigger
 *                              waits for the control change: no draw when ~ is gone, ruling 2024-03-08)
 *   CR 602.5b                  "Activate only during your turn." (the restriction stays with the object when its controller changes)
 *   CR 702.26b, 702.26d        phased out in response: treated as though it doesn't exist, nobody gains control, no draw (review finding, edh-d-84)
 *   CR 800.4a                  its controller (not its owner) leaves the game: control returns to the owner (ruling 2024-03-08)
 *   CR 603.10a, 111.2, 122.1   "When ~ leaves the battlefield, its owner creates a tapped 1/1 white Soldier creature token for each quest counter on it." (the
 *                              counters as it last existed; the owner, not the controller, creates the tokens)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, concede, find, mpScenario, passUntil, resolveStack } from '../../m12/rules/helpers';
import { activate, cast } from '../../m5/cr-examples/helpers';

const card = (name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef => compileCard({
  name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}),
} as OracleCard);
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const tgt = (...ids: string[]): DecisionAnswer => ({ kind: 'chooseTargets', targets: ids.map((id) => (/^p[1-4]$/.test(id) ? { kind: 'player' as const, id } : { kind: 'object' as const, id })) });
const ctl = (s: GameState, id: ObjectId): PlayerId => s.objects[id]!.controller;
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const quest = (s: GameState, id: ObjectId): number => s.objects[id]?.counters?.quest ?? 0;
const soldiers = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name.includes('Soldier'));

const SECURITRON = card('Test Securitron', 'Legendary Artifact Creature — Robot', [
  '{T}: Target opponent gains control of ~. When they do, you draw two cards and put a quest counter on ~. Activate only during your turn.',
  'Wild Card — When ~ leaves the battlefield, its owner creates a tapped 1/1 white Soldier creature token for each quest counter on it.',
].join('\n'), '{1}', ['2', '2']);
const BOUNCE = card('Test Recall', 'Instant', "Return target creature to its owner's hand.");
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const BANISH = card('Test Banish', 'Instant', 'Exile target creature.');
const FADE = card('Test Fade', 'Instant', 'Target creature phases out.');

const game = (setup?: (g: GameState) => void) => mpScenario({
  defs: [SECURITRON, BOUNCE, SMITE, BANISH, FADE],
  zones: { p1: { battlefield: ['Test Securitron'] }, p2: { hand: ['Test Recall', 'Test Smite', 'Test Banish', 'Test Fade'] }, p3: { hand: ['Test Smite'] } },
  ...(setup ? { setup } : {}),
});
/** p1 activates targeting `who` and everyone passes: the ability and its reflexive trigger resolve. */
const give = (s: GameState, who: PlayerId): GameState => resolveStack(activate(s, find(s, 'Test Securitron', 'battlefield', 'p1'), [tgt(who)]));

describe('edh-d-84: Yes Man, Personal Securitron', () => {
  it('compiles full', () => expect(full(SECURITRON)).toBe(true));

  it('CR 603.12, 613.1b: the target opponent gains control; then the activator draws two and the card gets a quest counter (no one else draws)', () => {
    let s = game();
    const sec = find(s, 'Test Securitron', 'battlefield', 'p1');
    const before = { p1: hand(s, 'p1'), p2: hand(s, 'p2'), p3: hand(s, 'p3'), p4: hand(s, 'p4') };
    s = give(s, 'p3');
    expect(ctl(s, sec)).toBe('p3');
    expect(s.objects[sec]!.owner).toBe('p1');
    expect(hand(s, 'p1')).toBe(before.p1 + 2);
    expect(hand(s, 'p3')).toBe(before.p3);
    expect(hand(s, 'p2')).toBe(before.p2);
    expect(hand(s, 'p4')).toBe(before.p4);
    expect(quest(s, sec)).toBe(1);
    expect(s.objects[sec]!.tapped).toBe(true);
  });

  it('negative (CR 115.1, 601.2c): the activator cannot target itself', () => {
    const s = game();
    expect(() => activate(s, find(s, 'Test Securitron', 'battlefield', 'p1'), [tgt('p1')])).toThrow();
  });

  it('negative (ruling 2024-03-08, CR 603.12): returned to hand in response, nobody gains control: no cards, no counter, no Soldiers', () => {
    let s = game();
    const sec = find(s, 'Test Securitron', 'battlefield', 'p1');
    const drawn = hand(s, 'p1');
    s = activate(s, sec, [tgt('p2')]);
    s = act(s, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    s = cast(s, 'Test Recall', [tgt(sec)], 'p2');
    s = resolveStack(s);
    expect(s.zones.hand.p1!.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Securitron')).toBe(true);
    expect(hand(s, 'p1')).toBe(drawn + 1); // the card itself, nothing drawn
    expect(soldiers(s, 'p1')).toEqual([]);
    expect(soldiers(s, 'p2')).toEqual([]);
  });

  it('CR 602.5b: the new controller activates it on its own turn, targeting the owner; not during another player\'s turn', () => {
    let s = game();
    const sec = find(s, 'Test Securitron', 'battlefield', 'p1');
    s = give(s, 'p2');
    expect(ctl(s, sec)).toBe('p2');
    // negative: still p1's turn; p2 may not activate (not its turn), and p1 no longer controls it
    s = act(s, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    expect(() => activate(s, sec)).toThrow();
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.player === 'p2' && x.zones.stack.length === 0, 'p2 main phase', 80);
    expect(s.objects[sec]!.tapped).toBe(false);
    const p2Hand = hand(s, 'p2');
    s = resolveStack(activate(s, sec, [tgt('p1')]));
    expect(ctl(s, sec)).toBe('p1');
    expect(hand(s, 'p2')).toBe(p2Hand + 2);
    expect(quest(s, sec)).toBe(2);
  });

  it('CR 603.10a: destroyed under an opponent\'s control, its OWNER creates one tapped Soldier per quest counter it had', () => {
    let s = game();
    const sec = find(s, 'Test Securitron', 'battlefield', 'p1');
    s = give(s, 'p3');
    expect(quest(s, sec)).toBe(1);
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Smite', [tgt(sec)], 'p2');
    s = resolveStack(s);
    expect(s.zones.battlefield.includes(sec)).toBe(false);
    const mine = soldiers(s, 'p1');
    expect(mine.length).toBe(1);
    expect(s.objects[mine[0]!]!.tapped).toBe(true);
    expect(soldiers(s, 'p3')).toEqual([]);
    expect(soldiers(s, 'p2')).toEqual([]);
  });

  it('CR 603.10a, 122.1: two counters, exiled: two tapped Soldiers for the owner', () => {
    let s = game();
    const sec = find(s, 'Test Securitron', 'battlefield', 'p1');
    s = give(s, 'p2');
    s = passUntil(s, (x) => x.turn.number === 2 && x.turn.step === 'main1' && x.pending?.player === 'p2' && x.zones.stack.length === 0, 'p2 main phase', 80);
    s = resolveStack(activate(s, sec, [tgt('p4')]));
    expect(ctl(s, sec)).toBe('p4');
    expect(quest(s, sec)).toBe(2);
    s = cast(s, 'Test Banish', [tgt(sec)], 'p2');
    s = resolveStack(s);
    expect(soldiers(s, 'p1').length).toBe(2);
    expect(soldiers(s, 'p1').every((id) => s.objects[id]!.tapped)).toBe(true);
    expect(soldiers(s, 'p4')).toEqual([]);
    expect(soldiers(s, 'p2')).toEqual([]);
  });

  it('negative: with no quest counter, leaving makes no Soldier', () => {
    let s = game();
    const sec = find(s, 'Test Securitron', 'battlefield', 'p1');
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Smite', [tgt(sec)], 'p2');
    s = resolveStack(s);
    expect(s.zones.battlefield.includes(sec)).toBe(false);
    expect(soldiers(s, 'p1')).toEqual([]);
  });

  it('CR 800.4a (ruling 2024-03-08): its controller, not its owner, leaves the game: the owner controls it again, with its counter', () => {
    let s = game();
    const sec = find(s, 'Test Securitron', 'battlefield', 'p1');
    s = give(s, 'p3');
    expect(ctl(s, sec)).toBe('p3');
    s = concede(s, 'p3').state;
    expect(s.zones.battlefield.includes(sec)).toBe(true);
    expect(ctl(s, sec)).toBe('p1');
    expect(quest(s, sec)).toBe(1);
  });

  it('negative (CR 702.26b, 702.26d): phased out in response, it is treated as though it does not exist: no control change, no cards, no counter, also after it phases in', () => {
    let s = game();
    const sec = find(s, 'Test Securitron', 'battlefield', 'p1');
    const drawn = hand(s, 'p1');
    s = activate(s, sec, [tgt('p2')]);
    s = act(s, { type: 'pass', player: 'p1' });
    s = cast(s, 'Test Fade', [tgt(sec)], 'p2');
    s = resolveStack(s);
    expect(s.objects[sec]!.phasedOut).toBe(true);
    expect(hand(s, 'p1')).toBe(drawn);
    expect(quest(s, sec)).toBe(0);
    s = passUntil(s, (x) => x.turn.number === 5 && x.turn.step === 'main1', 'p1 next main phase', 400);
    expect(s.objects[sec]!.phasedOut).toBe(false);
    expect(ctl(s, sec)).toBe('p1');
    expect(quest(s, sec)).toBe(0);
  });
});
