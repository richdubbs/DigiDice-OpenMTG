/**
 * M12F (audit docs/audits/2026-10-15-M12.md, defects D1 and D2; CR 603.2c, 510.2): "Whenever one or more creatures ... deal combat damage to a player" (or
 * "to one of your opponents") triggers once for EACH player dealt combat damage in the step (the rulings of Professional Face-Breaker), and "that player" of
 * each trigger is that one player. Before, a 3-4 player combat that damaged two players made one trigger whose "that player" stood for both. The cards are
 * compiled from their Oracle text by the default compiler (design 6.10); 4-player games, and the two-player game where nothing changes.
 */
import { describe, expect, it } from 'vitest';
import { commanderOptions, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { legend } from '../../m11/rules/helpers';
import { scenario } from '../../m3/scenario';
import { answer, find, mpScenario, pass, passUntil } from '../rules/helpers';

const card = (name: string, type: string, cost: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: cost, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);

const FACE_BREAKER = card('Professional Face-Breaker', 'Creature — Human Warrior', '{2}{R}',
  'Menace\nWhenever one or more creatures you control deal combat damage to a player, create a Treasure token.\nSacrifice a Treasure: Exile the top card of your library. You may play that card this turn.', ['2', '3']);
const PUPPET_MASTER = card('Puppet Master, String Puller', 'Legendary Creature — Human Artificer Villain', '{2}{R}',
  "Whenever you attack, goad target creature an opponent controls. It can't block this turn. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)\nWhenever one or more goaded creatures deal combat damage to one of your opponents, create a Treasure token.", ['2', '4']);
const ENTERTAINER = card('Popular Entertainer', 'Legendary Enchantment — Background', '{1}{R}',
  'Commander creatures you own have "Whenever one or more creatures you control deal combat damage to a player, goad target creature that player controls." (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)');
const CAPTAIN = legend('Alpha Captain', '{1}{W}', ['3', '3'], ['W', 'R']);

const treasures = (s: GameState, p: PlayerId): number =>
  s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === 'Treasure Token').length;
const idOf = (s: GameState, defId: string): ObjectId => s.zones.battlefield.find((id) => s.objects[id]!.defId === defId)!;

/** Declare the attacks (the active player's), no blocks, then on to the end of combat; target choices are answered by `pick` (the options offered are recorded). */
function fight(s0: GameState, attacks: { attacker: ObjectId; defender: PlayerId }[], pick: (options: string[]) => string[] = (o) => o.slice(0, 1)) {
  let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === x.turn.activePlayer, 'the attack');
  s = answer(s, { kind: 'declareAttackers', attacks });
  const offered: string[][] = [];
  for (let i = 0; i < 400 && s.turn.step !== 'endCombat' && s.turn.step !== 'main2'; i++) {
    const d = s.pending!;
    if (d.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((x) => x.id) });
    else if (d.kind === 'chooseTargets') {
      const options = [...d.objects];
      offered.push([...options].sort());
      s = answer(s, { kind: 'chooseTargets', targets: pick(options).map((id) => ({ kind: 'object' as const, id })) });
    } else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected ${d.kind}: ${d.prompt}`);
  }
  return { s, offered };
}

describe('CR 603.2c: Professional Face-Breaker (an older full card of the same shape) in a 4-player game', () => {
  it('creatures that deal combat damage to Bob and to Carol make two triggers: two Treasures', () => {
    let s = mpScenario({ defs: [FACE_BREAKER], cards: ['Grizzly Bears', 'Hill Giant'], zones: { p1: { battlefield: ['Professional Face-Breaker', 'Grizzly Bears', 'Hill Giant'] } } });
    s = fight(s, [{ attacker: find(s, 'Grizzly Bears', 'battlefield', 'p1'), defender: 'p2' }, { attacker: find(s, 'Hill Giant', 'battlefield', 'p1'), defender: 'p3' }]).s;
    expect(treasures(s, 'p1')).toBe(2);
  });

  it('two creatures dealing combat damage to the same player still make one trigger (one or more creatures, CR 603.2c)', () => {
    let s = mpScenario({ defs: [FACE_BREAKER], cards: ['Grizzly Bears', 'Hill Giant'], zones: { p1: { battlefield: ['Professional Face-Breaker', 'Grizzly Bears', 'Hill Giant'] } } });
    s = fight(s, [{ attacker: find(s, 'Grizzly Bears', 'battlefield', 'p1'), defender: 'p2' }, { attacker: find(s, 'Hill Giant', 'battlefield', 'p1'), defender: 'p2' }]).s;
    expect(treasures(s, 'p1')).toBe(1);
  });

  it('two players: nothing changes (one opponent, one trigger)', () => {
    let s = scenario(['Grizzly Bears', 'Hill Giant'], { defs: [FACE_BREAKER], p1: { battlefield: ['Professional Face-Breaker', 'Grizzly Bears', 'Hill Giant'] } });
    s = fight(s, [{ attacker: find(s, 'Grizzly Bears', 'battlefield', 'p1'), defender: 'p2' }, { attacker: find(s, 'Hill Giant', 'battlefield', 'p1'), defender: 'p2' }]).s;
    expect(treasures(s, 'p1')).toBe(1);
  });
});

describe('CR 603.2c: Puppet Master, String Puller (audit D2) in a 4-player game', () => {
  it('two creatures goaded by Alice deal combat damage to Carol and to Dan: Alice creates two Treasures', () => {
    let s = mpScenario({
      defs: [PUPPET_MASTER], cards: ['Hill Giant', 'Gray Ogre'],
      zones: { p1: { battlefield: ['Puppet Master, String Puller'] }, p2: { battlefield: ['Hill Giant', 'Gray Ogre'] } },
      setup: (x) => {
        for (const id of x.zones.battlefield) if (x.objects[id]!.owner === 'p2') x.objects[id] = { ...x.objects[id]!, goaded: [{ by: 'p1' }] };
      },
    });
    // on to Bob's turn (Alice's goad lasts until her next turn)
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.pending?.kind === 'declareAttackers', "Bob's attack", 600);
    s = fight(s, [{ attacker: find(s, 'Hill Giant', 'battlefield', 'p2'), defender: 'p3' }, { attacker: find(s, 'Gray Ogre', 'battlefield', 'p2'), defender: 'p4' }]).s;
    expect(treasures(s, 'p1')).toBe(2);
  });
});

describe('CR 603.2c: Popular Entertainer (audit D1) in a 4-player Commander game', () => {
  it("Alice's commander hits Bob and the Bears hit Carol: two triggers, each offering only the creatures of the player it is about", () => {
    let s = mpScenario({
      defs: [ENTERTAINER], cards: ['Grizzly Bears', 'Gray Ogre', 'Hill Giant'],
      commanders: { p1: [CAPTAIN], p2: [legend('Beta Captain', '{1}{W}', ['3', '3'], ['W'])], p3: [legend('Gamma Captain', '{1}{W}', ['3', '3'], ['W'])], p4: [legend('Delta Captain', '{1}{W}', ['3', '3'], ['W'])] }, options: { commander: commanderOptions('commander') },
      zones: { p1: { battlefield: ['Popular Entertainer', 'Grizzly Bears'] }, p2: { battlefield: ['Gray Ogre'] }, p3: { battlefield: ['Hill Giant'] } },
      setup: (x) => {
        const id = x.zones.command.find((o) => x.objects[o]!.defId === 'Alpha Captain')!;
        x.zones.command = x.zones.command.filter((o) => o !== id);
        x.zones.battlefield.push(id);
        x.objects[id] = { ...x.objects[id]!, zone: 'battlefield', controlledSinceTurn: 0 };
      },
    });
    const ogre = find(s, 'Gray Ogre', 'battlefield', 'p2');
    const giant = find(s, 'Hill Giant', 'battlefield', 'p3');
    const r = fight(s, [{ attacker: idOf(s, 'Alpha Captain'), defender: 'p2' }, { attacker: find(s, 'Grizzly Bears', 'battlefield', 'p1'), defender: 'p3' }]);
    expect(r.offered.sort()).toEqual([[giant], [ogre]].sort());
    expect(r.s.objects[ogre]!.goaded).toEqual([{ by: 'p1' }]);
    expect(r.s.objects[giant]!.goaded).toEqual([{ by: 'p1' }]);
  });
});
