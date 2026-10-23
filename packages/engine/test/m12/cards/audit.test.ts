/**
 * M12 audit (docs/audits/2026-10-17-M12.md): "whenever one or more creatures ... deal combat damage to a player" in a 3-4 player game (CR 603.2c, 510.2).
 * The combat damage dealt to two players at once is one occurrence for EACH player dealt damage, with that player's damage, so "that player" is one player
 * (the rulings of Professional Face-Breaker and Popular Entertainer: it triggers once for each of those players). Before the fix the batch was one
 * occurrence: one trigger, and "target creature that player controls" offered the creatures of every player dealt damage. Wordings of Popular Entertainer
 * (its granted ability) and Puppet Master, String Puller, compiled by the default compiler (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { answer, find, mpScenario, pass } from '../rules/helpers';
import { scenario } from '../../m3/scenario';

const synthetic = (name: string, type: string, cost: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', type_line: type, mana_cost: cost, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);

const ENTERTAINER = synthetic('Test Entertainer', 'Enchantment', '{1}{R}', 'Whenever one or more creatures you control deal combat damage to a player, goad target creature that player controls.');
const PUPPETEER = synthetic('Test Puppeteer', 'Enchantment', '{2}{R}', 'Whenever one or more goaded creatures deal combat damage to one of your opponents, create a Treasure token.');
const LANCER = synthetic('Test Lancer', 'Creature — Human Knight', '{1}{W}', 'First strike', ['2', '2']);
const DEFS = [ENTERTAINER, PUPPETEER, LANCER];

const mine = (s: GameState, p: PlayerId, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.defs[s.objects[id]!.defId]!.name === name);

/** Pass priority until `player` declares attackers (others: no attack, or what goad requires; no blocks). */
function toAttacks(s: GameState, player: PlayerId): GameState {
  let t = s;
  for (let i = 0; i < 400; i++) {
    if (t.pending?.kind === 'declareAttackers' && t.pending.player === player) return t;
    if (t.pending?.kind === 'declareAttackers') { t = answer(t, { kind: 'declareAttackers', attacks: t.pending.obeying ?? [] }); continue; }
    if (t.pending?.kind === 'declareBlockers') { t = answer(t, { kind: 'declareBlockers', blocks: [] }); continue; }
    if (t.pending?.kind !== 'priority') throw new Error(`unexpected ${t.pending?.kind}: ${t.pending?.prompt}`);
    t = pass(t);
  }
  throw new Error(`${player} never declared attackers`);
}

/** Play on to the end step; each target decision on the way is recorded (the players who control its legal targets) and answered with its first option. */
function toEnd(s: GameState): { s: GameState; targets: PlayerId[][] } {
  let t = s;
  const targets: PlayerId[][] = [];
  for (let i = 0; i < 400 && t.turn.step !== 'end'; i++) {
    const d = t.pending!;
    if (d.kind === 'chooseTargets') {
      targets.push([...new Set(d.objects.map((id) => t.objects[id]!.controller))].sort());
      t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: d.objects[0]! }] });
    } else if (d.kind === 'order') t = answer(t, { kind: 'order', ids: d.items.map((x) => x.id) });
    else if (d.kind === 'declareBlockers') t = answer(t, { kind: 'declareBlockers', blocks: [] });
    else if (d.kind === 'priority') t = pass(t);
    else throw new Error(`unexpected ${d.kind}: ${d.prompt}`);
  }
  return { s: t, targets };
}

describe('CR 603.2c: "one or more creatures you control deal combat damage to a player" triggers once for each player dealt damage', () => {
  const setup = (): GameState => mpScenario({
    defs: DEFS, cards: ['Grizzly Bears', 'Hill Giant'],
    zones: { p1: { battlefield: ['Test Entertainer', 'Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, p3: { battlefield: ['Hill Giant'] }, p4: { battlefield: ['Hill Giant'] } },
  });

  it('Alice\'s creatures hit Bob and Carol at once: two triggers, each targeting only the creatures of the player it was dealt to', () => {
    let s = toAttacks(setup(), 'p1');
    const [a, b, c] = mine(s, 'p1', 'Grizzly Bears');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }, { attacker: c!, defender: 'p3' }] });
    const r = toEnd(s);
    expect(r.targets.sort()).toEqual([['p2'], ['p3']]);
    expect(mine(r.s, 'p2', 'Hill Giant').map((id) => r.s.objects[id]!.goaded)).toEqual([[{ by: 'p1' }]]);
    expect(mine(r.s, 'p3', 'Hill Giant').map((id) => r.s.objects[id]!.goaded)).toEqual([[{ by: 'p1' }]]);
    expect(mine(r.s, 'p4', 'Hill Giant').map((id) => r.s.objects[id]!.goaded ?? [])).toEqual([[]]);
  });

  it('two creatures hit the same player: one trigger ("one or more")', () => {
    let s = toAttacks(setup(), 'p1');
    const [a, b] = mine(s, 'p1', 'Grizzly Bears');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }] });
    expect(toEnd(s).targets).toEqual([['p2']]);
  });

  it('review (CR 510.4, 603.2c): a first striker and a creature without first strike hit Bob: one trigger in EACH combat damage step (two events)', () => {
    let s = mpScenario({
      defs: DEFS, cards: ['Grizzly Bears', 'Hill Giant'],
      zones: { p1: { battlefield: ['Test Entertainer', 'Test Lancer', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant', 'Hill Giant'] } },
    });
    s = toAttacks(s, 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: mine(s, 'p1', 'Test Lancer')[0]!, defender: 'p2' }, { attacker: mine(s, 'p1', 'Grizzly Bears')[0]!, defender: 'p2' }] });
    expect(toEnd(s).targets).toEqual([['p2'], ['p2']]);
  });

  it('review (CR 510.2, 306.8 cite unverified): combat damage to Carol\'s planeswalker is not damage to a player: one trigger, for Bob only', () => {
    let s = mpScenario({
      defs: DEFS, cards: ['Grizzly Bears', 'Hill Giant', 'Jace Beleren'],
      zones: { p1: { battlefield: ['Test Entertainer', 'Grizzly Bears', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] }, p3: { battlefield: ['Hill Giant', { name: 'Jace Beleren', counters: { loyalty: 5 } }] } },
    });
    s = toAttacks(s, 'p1');
    const [a, b] = mine(s, 'p1', 'Grizzly Bears');
    const jace = find(s, 'Jace Beleren', 'battlefield', 'p3');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: jace }] });
    const r = toEnd(s);
    expect(r.s.objects[jace]!.counters?.['loyalty']).toBe(3); // the Bears dealt 2 combat damage to Jace (CR 120.3c)
    expect(r.targets).toEqual([['p2']]);
  });

  it('m12 design D16: in a two-player game it plays as before (one trigger for the one opponent)', () => {
    let s = scenario(['Grizzly Bears', 'Hill Giant'], { defs: DEFS, p1: { battlefield: ['Test Entertainer', 'Grizzly Bears', 'Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
    s = toAttacks(s, 'p1');
    const [a, b] = mine(s, 'p1', 'Grizzly Bears');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: a!, defender: 'p2' }, { attacker: b!, defender: 'p2' }] });
    const r = toEnd(s);
    expect(r.targets).toEqual([['p2']]);
    expect(r.s.objects[find(r.s, 'Hill Giant', 'battlefield', 'p2')]!.goaded).toEqual([{ by: 'p1' }]);
  });
});

describe('CR 603.2c: "one or more goaded creatures deal combat damage to one of your opponents" (Puppet Master, String Puller)', () => {
  const run = (defenders: PlayerId[]): GameState => {
    let s = mpScenario({
      defs: DEFS, cards: ['Grizzly Bears', 'Hill Giant'],
      zones: { p1: { battlefield: ['Test Puppeteer'] }, p2: { battlefield: ['Hill Giant', 'Grizzly Bears'] } },
      setup: (x) => { for (const id of x.zones.battlefield) if (x.objects[id]!.controller === 'p2') x.objects[id]!.goaded = [{ by: 'p1' }]; },
    });
    s = toAttacks(s, 'p2');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: mine(s, 'p2', 'Hill Giant')[0]!, defender: defenders[0]! }, { attacker: mine(s, 'p2', 'Grizzly Bears')[0]!, defender: defenders[1]! }] });
    return toEnd(s).s;
  };
  const treasures = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p1' && /Treasure/.test(s.defs[s.objects[id]!.defId]!.name)).length;

  it("Bob's goaded creatures hit Carol and Dan at once: two Treasures; both hit Carol: one", () => {
    expect(treasures(run(['p3', 'p4']))).toBe(2);
    expect(treasures(run(['p3', 'p3']))).toBe(1);
  });
});
