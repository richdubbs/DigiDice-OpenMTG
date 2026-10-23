/**
 * Standard round 4, slice r4-static: an ability a static ability grants that names the granting object ("Equipped creature has "{T}, Sacrifice Test Torch:
 * Test Torch deals 2 damage to any target.""). Played through the engine with synthetic cards compiled by the game's default compiler (design 6.10).
 *
 *   CR 201.5a  inside the quote the outer card's name is the object whose static ability grants the quoted one (front/selfref.ts, `{ref:'grantor'}`)
 *   CR 613.1f                       layer 6 writes that object as a fixed reference of the granted ability (statics/mods.ts#withGrantor)
 *   CR 118.3, 701.21a, 701.26a      "Sacrifice <it>" / "Tap <it>" in the cost of the granted ability pay with the granting Equipment
 *   CR 400.7, 608.2h                the reference names the object while it stays on the battlefield; damage from it after it was sacrificed uses its last known information
 */
import { describe, expect, it } from 'vitest';
import { compileCard, validateAbility, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.autoRatio === 1 && d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const TORCH = card('Test Torch', 'Artifact — Equipment', 'Equipped creature has "{T}, Sacrifice Test Torch: Test Torch deals 2 damage to any target."\nEquip {1}');
const ROD = card('Test Rod', 'Artifact — Equipment', 'Equipped creature has "{1}, {T}, Tap Test Rod: Put a charge counter on Test Rod."\nEquip {1}');
const DISC = card('Test Disc', 'Artifact — Equipment', 'Equipped creature has "{T}: Tap target creature. Return Test Disc to its owner\'s hand."\nEquip {1}');

/** p1 with a Bear wearing the Equipment `eq`, and a second Bear for p2. */
function equipped(eq: CardDef): { s: GameState; bear: ObjectId; gear: ObjectId; foe: ObjectId } {
  const s = scenario([], { p1: { battlefield: ['Test Bear', eq.name, 'Plains'] }, p2: { battlefield: ['Test Bear'] }, defs: [BEAR, eq] });
  const bear = find(s, 'Test Bear', 'battlefield', 'p1');
  const gear = find(s, eq.name, 'battlefield', 'p1');
  s.objects[gear]!.attachedTo = bear;
  s.objects[bear]!.controlledSinceTurn = -1; // no summoning sickness: {T} abilities may be activated (CR 302.6)
  return { s, bear, gear, foe: find(s, 'Test Bear', 'battlefield', 'p2') };
}
/** The granted ability the creature can activate now. */
function grantedOf(s: GameState, source: ObjectId): string {
  const a = legal(s, 'p1', 'activate').map((x) => x.action as { source?: string; ability?: string }).find((x) => x.source === source && x.ability?.startsWith('g:') === true);
  if (a?.ability === undefined) throw new Error(`no granted ability on ${source}: ${JSON.stringify(legal(s, 'p1', 'activate'))}`);
  return a.ability;
}
function resolve(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 20 && s.zones.stack.length > 0; guard++) s = pass(pass(s));
  return s;
}
function payAll(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; guard < 10 && s.pending?.kind === 'payCost'; guard++) s = answer(s, { kind: 'payCost', auto: true });
  return s;
}

describe('CR 201.5a, 613.1f: the granting object of a granted ability', () => {
  it('the three Equipment are automated; the reference is written only inside the granted ability', () => {
    for (const d of [TORCH, ROD, DISC]) expect(full(d), d.name).toBe(true);
    expect(JSON.stringify(TORCH.faces)).toContain('"ref":"grantor"');
  });
  it('the lint refuses the granting object outside an ability a static ability grants (a resolved effect\'s grant, a printed ability)', () => {
    // the granted ability itself, printed on its own, and the static ability that grants it
    const outer = TORCH.faces[0]!.abilities[0]! as unknown as { effects: { mods: { add: unknown[] }[] }[] };
    const granted = outer.effects[0]!.mods[0]!.add[0];
    expect(validateAbility(granted as never).some((i) => i.code === 'bad-grantor')).toBe(true);
    expect(validateAbility(outer as never).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('CR 118.3, 701.21a, 608.2h: "{T}, Sacrifice Test Torch: Test Torch deals 2 damage to any target": the Equipment is sacrificed and still deals the damage', () => {
    const { s: s0, bear, gear } = equipped(TORCH);
    let s = act(s0, { type: 'activate', player: 'p1', source: bear, ability: grantedOf(s0, bear) });
    for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      else s = payAll(s);
    }
    expect(s.objects[gear]?.zone ?? 'graveyard').not.toBe('battlefield');
    s = resolve(s);
    expect(life(s, 'p2')).toBe(18);
  });
  it('CR 701.26a, 122.1: "{1}, {T}, Tap Test Rod: Put a charge counter on Test Rod": the Equipment is tapped and gets the counter, not the creature', () => {
    const { s: s0, bear, gear } = equipped(ROD);
    let s = payAll(act(s0, { type: 'activate', player: 'p1', source: bear, ability: grantedOf(s0, bear) }));
    expect(s.objects[gear]!.tapped).toBe(true);
    s = resolve(s);
    expect(s.objects[gear]!.counters['charge']).toBe(1);
    expect(s.objects[bear]!.counters['charge'] ?? 0).toBe(0);
  });
  it('CR 400.7: "Tap target creature. Return Test Disc to its owner\'s hand": the Equipment returns to its owner\'s hand, the creature stays', () => {
    const { s: s0, bear, gear, foe } = equipped(DISC);
    let s = act(s0, { type: 'activate', player: 'p1', source: bear, ability: grantedOf(s0, bear) });
    for (let guard = 0; guard < 10 && s.pending && s.pending.kind !== 'priority'; guard++) {
      if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: foe }] });
      else s = payAll(s);
    }
    s = resolve(s);
    expect(s.objects[foe]!.tapped).toBe(true);
    expect(s.zones.hand.p1!.some((id) => s.objects[id]!.defId === 'Test Disc')).toBe(true);
    expect(s.objects[bear]!.zone).toBe('battlefield');
    expect(gear).toBeDefined();
  });
  it('CR 613.1f: an unequipped creature has no such ability', () => {
    const { s, bear, gear } = equipped(ROD);
    delete s.objects[gear]!.attachedTo;
    expect(getChars(s, bear)!.abilities.some((a) => a.origin === 'granted')).toBe(false);
  });
});

describe('CR 603.12, 701.21a: a granted trigger whose reflexive part sacrifices the granting Equipment', () => {
  const LAMP = card('Test Lamp', 'Artifact — Equipment', 'Equipped creature has "Whenever this creature attacks, you may sacrifice Test Lamp. When you do, this creature deals 3 damage to any target."\nEquip {1}');
  it('is automated', () => expect(full(LAMP)).toBe(true));
  it('the Equipment is sacrificed and the creature deals the damage; declining keeps it', () => {
    for (const yes of [true, false]) {
      const { s: s0, bear, gear } = equipped(LAMP);
      let s = s0;
      for (let guard = 0; guard < 20 && s.pending?.kind !== 'declareAttackers'; guard++) s = pass(s);
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
      for (let guard = 0; guard < 40 && s.turn.step !== 'combatDamage' && s.turn.step !== 'end'; guard++) {
        const p = s.pending;
        if (p?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes } as never);
        else if (p?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
        else if (p?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] } as never);
        else s = pass(s);
      }
      expect(s.objects[gear]?.zone === 'battlefield', `yes=${yes}`).toBe(!yes);
      expect(life(s, 'p2'), `yes=${yes}`).toBe(yes ? 15 : 18); // 3 from the reflexive trigger, 2 combat damage from the Bear
    }
  });
});
