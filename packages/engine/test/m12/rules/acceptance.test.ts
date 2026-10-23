/**
 * M12-2: the acceptance cards whose 4-player scenarios design section 3 gives to M12-2 (docs/design/m12-multiplayer.md 3): "each opponent" and "each other
 * player" in APNAP order without the players who left (CR 101.4, 608.2e, 800.4a), "that player may pay" asked of the right opponent among three (CR 118.12),
 * the monarch and the initiative when their holder leaves (CR 725.4, 726.4), and a 4-player Commander game (CR 903.7, 903.10a, 103.5c, 103.8c).
 * (Mind Control, Act of Treason and the Bribery pattern: leave.test.ts; the Siege: choices.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { commanderOptions, createGame, type GameState } from '../../../src/index';
import { cloneState } from '../../../src/util/clone';
import { legend } from '../../m11/rules/helpers';
import { act, answer, concede, drive, find, lifeOf, mpConfig, mpScenario, pass, passUntil, playerOf, resolveStack } from './helpers';

const lifeLossOrder = (s: GameState, from: number): string[] =>
  s.log.slice(from).flatMap((l) => { const m = /^(\w+) loses 1 life/.exec(l.text); return m ? [m[1]!] : []; });

/** p1 casts Shock at its own creature `name` (its controller's creature dies: the "dies" triggers). */
function shockOwn(s: GameState, name: string): GameState {
  const t = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, name, 'battlefield', 'p1') }] }]);
  return resolveStack(t);
}

describe('M12-2 acceptance cards in a 4-player game (m12 design 3)', () => {
  it('Zulaport Cutthroat: "each opponent loses 1 life" with three opponents, in APNAP order; a player who left is not affected (CR 101.4, 608.2e, 800.4a)', () => {
    let s = mpScenario({ cards: ['Zulaport Cutthroat', 'Shock', 'Mountain'], zones: { p1: { battlefield: ['Zulaport Cutthroat', 'Mountain'], hand: ['Shock'] } } });
    s = concede(s, 'p3').state;
    const from = s.log.length;
    s = shockOwn(s, 'Zulaport Cutthroat');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p4')]).toEqual([21, 19, 19]);
    expect(lifeOf(s, 'p3')).toBe(20);
    expect(lifeLossOrder(s, from)).toEqual(['Bob', 'Dan']);
  });

  it('Blood Artist: "target player" can never be a player who left the game (CR 115.1, 800.4a)', () => {
    let s = mpScenario({ cards: ['Blood Artist', 'Grizzly Bears', 'Shock', 'Mountain'], zones: { p1: { battlefield: ['Blood Artist', 'Grizzly Bears', 'Mountain'], hand: ['Shock'] } } });
    s = concede(s, 'p2').state;
    const t = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Grizzly Bears', 'battlefield', 'p1') }] }]);
    let u = t;
    for (let i = 0; i < 8 && u.pending?.kind !== 'chooseTargets'; i++) u = drive(pass(u));
    expect(u.pending).toMatchObject({ kind: 'chooseTargets', player: 'p1' });
    expect((u.pending as { players: string[] }).players.sort()).toEqual(['p1', 'p3', 'p4']);
  });

  it('Grave Pact: "each other player sacrifices a creature of their choice", each in APNAP order; the player who left is skipped (CR 101.4, 608.2e)', () => {
    const two = ['Grizzly Bears', 'Grizzly Bears'];
    let s = mpScenario({ cards: ['Grave Pact', 'Grizzly Bears', 'Shock', 'Mountain'], zones: { p1: { battlefield: ['Grave Pact', 'Grizzly Bears', 'Mountain'], hand: ['Shock'] }, p2: { battlefield: two }, p3: { battlefield: two }, p4: { battlefield: two } } });
    s = concede(s, 'p3').state;
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Shock', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Grizzly Bears', 'battlefield', 'p1') }] }]);
    const askedOrder: string[] = [];
    for (let i = 0; i < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      if (s.pending?.kind === 'priority') { s = pass(s); continue; }
      if (s.pending?.kind === 'chooseObjects') {
        askedOrder.push(s.pending.player);
        s = answer(s, { kind: 'chooseObjects', ids: [s.pending.options[0]!] });
        continue;
      }
      s = drive(s);
    }
    expect(askedOrder).toEqual(['p2', 'p4']);
    expect(['p2', 'p4'].map((p) => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).length)).toEqual([1, 1]);
  });

  it('Rhystic Study: "unless that player pays {1}" is asked of the opponent who cast the spell, among three (CR 118.12a)', () => {
    let s = mpScenario({
      cards: ['Rhystic Study', 'Shock', 'Mountain'],
      zones: { p1: { battlefield: ['Rhystic Study'] }, p4: { hand: ['Shock'], battlefield: ['Mountain', 'Mountain'] } },
    });
    s = pass(pass(pass(s))); // Alice, Bob, Carol pass: Dan has priority in Alice's main phase
    s = drive(act(s, { type: 'cast', player: 'p4', card: find(s, 'Shock', 'hand', 'p4') }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    for (let i = 0; i < 8 && s.pending?.kind === 'priority'; i++) s = pass(s);
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p4', asker: { kind: 'cost', controller: 'p1' } });
  });

  it('Smothering Tithe: "that player may pay {2}" is asked of the opponent who drew; if they concede while asked, it is not paid (CR 118.12, 800.4f)', () => {
    let s = mpScenario({ cards: ['Smothering Tithe'], zones: { p1: { battlefield: ['Smothering Tithe'] }, p3: { battlefield: ['Plains', 'Plains'] } } });
    s = passUntil(s, (x) => x.pending?.kind === 'yesNo', 'the Tithe question', 400);
    expect(s.turn).toMatchObject({ number: 3, activePlayer: 'p3' }); // Bob drew with no mana: he could not pay (CR 118.3); Carol can
    expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p3', asker: { kind: 'cost', controller: 'p1' } });
    const treasures = (x: GameState): number => x.zones.battlefield.filter((id) => x.objects[id]!.controller === 'p1' && x.objects[id]!.kind === 'token').length;
    expect(treasures(s)).toBe(1); // Bob's draw
    const t = concede(s, 'p3').state;
    expect(treasures(t)).toBe(2); // CR 800.4f: the cost is not paid
    expect(t.log.some((l) => /Carol has left the game: \{2\} is not paid/.test(l.text) && (l.rules ?? []).includes('CR 800.4f'))).toBe(true);
  });

  it('CR 725.4, 726.4: the monarch and the player with the initiative leave: the active player takes each, or the next player when the active player is the one leaving', () => {
    let s = cloneState(mpScenario());
    s.designations = { ...s.designations, monarch: 'p3', initiative: 'p3' };
    let t = concede(s, 'p3').state;
    expect([t.designations.monarch, t.designations.initiative]).toEqual(['p1', 'p1']);
    s = cloneState(mpScenario());
    s.designations = { ...s.designations, monarch: 'p1', initiative: 'p1' };
    t = concede(s, 'p1').state;
    expect([t.designations.monarch, t.designations.initiative]).toEqual(['p2', 'p2']);
  });

  it('4-player Commander: 40 life, the free first mulligan, no draw skip; 21 combat damage from one commander makes a player leave while the game goes on (CR 903.7, 103.5c, 103.8c, 903.10a, 704.6c)', () => {
    const cmd = (n: string) => legend(n, '{1}{W}', ['3', '3'], ['W']);
    const commanders = { p1: [cmd('Alpha Captain')], p2: [cmd('Beta Captain')], p3: [cmd('Gamma Captain')], p4: [cmd('Delta Captain')] };
    const cfg = mpConfig({ commanders, options: { commander: commanderOptions('commander'), startingLife: undefined } });
    const { startingLife: _drop, ...options } = cfg.options!;
    const start = createGame({ ...cfg, options: { ...options, skipMulligans: false } });
    expect(start.players.map((p) => p.life)).toEqual([40, 40, 40, 40]);
    expect(start.pending).toMatchObject({ kind: 'mulligan', player: 'p1', handSize: 7 });
    let s = mpScenario({
      commanders, options: { commander: commanderOptions('commander') },
      setup: (x) => {
        const id = x.zones.command.find((o) => x.objects[o]!.defId === 'Alpha Captain')!;
        x.zones.command = x.zones.command.filter((o) => o !== id);
        x.zones.battlefield.push(id);
        x.objects[id] = { ...x.objects[id]!, zone: 'battlefield', controlledSinceTurn: 0 };
        const bob = x.players.find((p) => p.id === 'p2')!;
        const gamma = x.players.find((p) => p.id === 'p3')!.commanders![0]!.card;
        bob.commanderDamage = { [x.objects[id]!.cardId!]: 19, [gamma]: 20 }; // 20 from Gamma Captain, 19 from Alpha Captain
      },
    });
    expect(s.zones.hand['p1']).toHaveLength(1); // CR 103.8c: Alice drew on the first turn
    s = passUntil(s, (x) => x.pending?.kind === 'declareAttackers', 'the attack');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Alpha Captain')!, defender: 'p2' }] });
    s = passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'the blocks');
    if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    s = passUntil(s, (x) => playerOf(x, 'p2').hasLost, 'the loss');
    expect(playerOf(s, 'p2').left).toMatchObject({ order: 1, rules: ['CR 704.6c'] });
    expect(lifeOf(s, 'p2')).toBe(37);
    expect(s.result).toBeNull();
    expect(s.zones.command.some((id) => s.objects[id]!.owner === 'p2')).toBe(false); // Bob's commander left with him (CR 800.4a)
  });
});
