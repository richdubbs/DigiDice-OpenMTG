/**
 * std-costs-1 (lane std-costs): collect evidence X and the cards a "this way" count names, played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10).
 *
 *   CR 701.59a, 107.3   "you may collect evidence X. When you do, ... X ...": the collector chooses X as they collect; the reflexive trigger keeps that X (CR 603.12)
 *   CR 601.2c, 601.2f   "collect evidence X, where X is the total mana value of the permanents this spell targets": the targets are chosen, then the total cost
 *   CR 608.2c, 608.2h   "If C, exile a card ... Then search its owner's ... for any number of cards with that name": the sentences acting on the exiled card are
 *                       part of the branch; "each card exiled from their hand this way" counts only the search's exile
 *   CR 118.3, 107.3a    "Exile one or more other artifacts you control with total mana value X": X is announced, then permanents adding up to exactly X are exiled
 *   CR 601.2b, 601.2f   "you may sacrifice any number of ... This spell costs {1} less to cast for each permanent sacrificed this way": the number is announced
 *                       with the cost, the reduction reads it; a spell castable only with the sacrifices is offered
 *   CR 122.1, 201.5     "Whenever this creature enters or attacks, put a doom counter on it. Then for each doom counter on it, ...": the object itself, once per counter
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal, passBoth, scenario } from '../../m3/scenario';
import { declareAttackers, lifeOf, toDeclareAttackers, tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}

interface Script { yes?: boolean[]; numbers?: number[]; targets?: TargetChoice[][]; objects?: ObjectId[][] }
/** Answer every decision but priority from the script (defaults: no, the minimum, no targets, the first `min` options). */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], numbers: [...(script.numbers ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.numbers.shift() ?? p.min });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), script);
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
/** p1 attacks with `attacker`, nobody blocks; pass through combat damage, answering the script, until the stack is empty after damage. */
function attack(s0: GameState, attacker: ObjectId, script: Script): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), [[attacker]]);
  for (let i = 0; i < 40; i++) {
    s = drive(s, script);
    if (s.turn.step === 'endCombat' && s.zones.stack.length === 0) return s;
    s = passBoth(s);
  }
  throw new Error('combat did not finish');
}
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const named = (s: GameState, name: string, zone: 'battlefield' | 'exile' | 'graveyard' | 'hand' | 'library', p?: string): ObjectId[] => {
  const ids = zone === 'battlefield' || zone === 'exile' ? s.zones[zone] : s.zones[zone][p ?? 'p1']!;
  return ids.filter((id) => s.objects[id]!.defId === name);
};
const gy = (s: GameState, p = 'p1'): ObjectId[] => s.zones.graveyard[p]!;

const BEAR = card('Test Bear', 'Creature — Bear', '', '{2}', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', '{3}', ['4', '4']);
const RELIC = card('Test Relic', 'Artifact', '', '{4}');
const CHARM = card('Test Charm', 'Artifact', '', '{1}');
const DRAKE = card('Test Ember Drake', 'Creature — Dragon', 'Flying\nWhenever this creature deals combat damage to a player, you may collect evidence X. When you do, this creature deals X damage to each creature that player controls.', '{0}', ['3', '3']);
const AUTOPSY = card('Test Autopsy', 'Instant', 'As an additional cost to cast this spell, collect evidence X, where X is the total mana value of the permanents this spell targets.\nDestroy up to one target artifact and up to one target creature.');
const HUSH = card('Test Hush-Up', 'Sorcery', "As an additional cost to cast this spell, you may collect evidence 3.\nIf evidence was collected, exile a card from an opponent's graveyard. Then search its owner's graveyard, hand, and library for any number of cards with that name and exile them. That player shuffles, then draws a card for each card exiled from their hand this way.");
const GEAR = card('Test Gear', 'Artifact', '', '{2}');
const WORKSHOP = card('Test Workshop', 'Artifact', '{T}, Exile one or more other artifacts you control with total mana value X: Return target artifact card with mana value X or less from your graveyard to the battlefield.');
const ASP = card('Test Grave Asp', 'Creature — Snake', 'As an additional cost to cast this spell, you may sacrifice any number of artifacts. This spell costs {1} less to cast for each permanent sacrificed this way.\nWhenever this creature enters or attacks, put a doom counter on it. Then for each doom counter on it, each opponent loses 2 life unless that player sacrifices a creature of their choice or discards a card.', '{4}{W}', ['3', '3']);
const URN = card('Test Urn', 'Artifact', '{0}, Sacrifice this artifact: Draw a card.\nWhen this artifact is put into a graveyard from the battlefield, for each fate counter on it, you gain 2 life.');
const DEFS = [BEAR, OGRE, RELIC, CHARM, GEAR, WORKSHOP, DRAKE, AUTOPSY, HUSH, ASP, URN];

describe('std-costs-1: the synthetic cards are automated', () => {
  it('every card plays fully', () => {
    for (const d of DEFS) expect(d.automation.level, `${d.name}: ${JSON.stringify(d.automation)}`).toBe('full');
  });
});

describe('CR 701.59a, 107.3, 603.12: "you may collect evidence X. When you do, ... X ..."', () => {
  const board = (): GameState => scenario([], {
    defs: DEFS,
    p1: { battlefield: [{ name: 'Test Ember Drake', since: 0 }, 'Test Bear'], graveyard: ['Test Relic', 'Test Charm', 'Test Charm'] },
    p2: { battlefield: ['Test Bear', 'Test Ogre'] },
  });

  it('CR 701.59a, 603.12: X is chosen as evidence is collected; the reflexive trigger deals that X to each creature of the damaged player only', () => {
    let s = board();
    const relic = find(s, 'Test Relic', 'graveyard');
    s = attack(s, find(s, 'Test Ember Drake', 'battlefield'), { yes: [true], numbers: [4], objects: [[relic]] });
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(named(s, 'Test Relic', 'exile')).toHaveLength(1);
    expect(gy(s).map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Charm', 'Test Charm']);
    // 4 damage: both of p2's creatures die; p1's own Bear is not "that player"'s
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2')).toHaveLength(0);
    expect(named(s, 'Test Bear', 'battlefield')).toHaveLength(1);
    expect(s.objects[named(s, 'Test Bear', 'battlefield')[0]!]!.controller).toBe('p1');
  });

  it('CR 701.59a: a smaller X exiles cards with total mana value X or more and deals only X (the Ogre survives 2)', () => {
    let s = board();
    const charms = gy(s).filter((id) => s.objects[id]!.defId === 'Test Charm');
    s = attack(s, find(s, 'Test Ember Drake', 'battlefield'), { yes: [true], numbers: [2], objects: [[...charms]] });
    expect(named(s, 'Test Charm', 'exile')).toHaveLength(2);
    expect(named(s, 'Test Relic', 'graveyard')).toHaveLength(1);
    const ogre = named(s, 'Test Ogre', 'battlefield');
    expect(ogre).toHaveLength(1);
    expect(s.objects[ogre[0]!]!.damage).toBe(2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Test Bear' && s.objects[id]!.controller === 'p2')).toHaveLength(0);
  });

  it('CR 603.12, 608.2d: declining collects nothing and the reflexive trigger never happens', () => {
    let s = board();
    s = attack(s, find(s, 'Test Ember Drake', 'battlefield'), { yes: [false] });
    expect(gy(s)).toHaveLength(3);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.controller === 'p2')).toHaveLength(2);
  });
});

describe('CR 601.2c, 601.2f, 701.59a: "collect evidence X, where X is the total mana value of the permanents this spell targets"', () => {
  it('CR 601.2f: X is the targets\' total mana value (4 + 2), paid from the graveyard', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Autopsy'], graveyard: ['Test Relic', 'Test Charm', 'Test Charm', 'Test Charm'] }, p2: { battlefield: ['Test Relic', 'Test Bear'] } });
    const theirRelic = find(s, 'Test Relic', 'battlefield');
    const bear = find(s, 'Test Bear', 'battlefield');
    const mine = gy(s);
    const relic = mine.find((id) => s.objects[id]!.defId === 'Test Relic')!;
    const charms = mine.filter((id) => s.objects[id]!.defId === 'Test Charm');
    s = cast(s, 'Test Autopsy', { targets: [[obj(theirRelic)], [obj(bear)]], objects: [[relic, charms[0]!, charms[1]!]] });
    expect(s.zones.stack).toHaveLength(1);
    expect(named(s, 'Test Relic', 'exile')).toHaveLength(1);
    expect(named(s, 'Test Charm', 'exile')).toHaveLength(2);
    s = resolveAll(s);
    expect(named(s, 'Test Relic', 'graveyard', 'p2')).toHaveLength(1);
    expect(named(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(1);
  });

  it('CR 601.2c, 601.2f: with no targets X is 0 and nothing is exiled', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Autopsy'], graveyard: ['Test Charm'] }, p2: { battlefield: ['Test Bear'] } });
    s = resolveAll(cast(s, 'Test Autopsy', { targets: [[], []] }));
    expect(named(s, 'Test Charm', 'graveyard')).toHaveLength(1);
    expect(named(s, 'Test Bear', 'battlefield')).toHaveLength(1);
  });

  it('CR 601.2h, 701.59b: targets whose total the graveyard can\'t reach can\'t be paid for: the cast is refused', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Autopsy'], graveyard: ['Test Charm'] }, p2: { battlefield: ['Test Relic'] } });
    const theirRelic = find(s, 'Test Relic', 'battlefield');
    expect(() => cast(s, 'Test Autopsy', { targets: [[obj(theirRelic)], []] })).toThrow(/evidence|graveyard|pay/i);
  });
});

describe('CR 608.2c, 608.2h, 701.23a: "If C, exile a card ... Then search its owner\'s ... for any number of cards with that name"', () => {
  const board = (): GameState => scenario([], {
    defs: DEFS,
    p1: { hand: ['Test Hush-Up'], graveyard: ['Test Relic'] },
    p2: { graveyard: ['Test Bear', 'Test Ogre'], hand: ['Test Bear', 'Test Ogre'], library: ['Test Bear'] },
  });

  it('CR 608.2c, 201.2: the exiled card\'s name; the owner draws one card for each card exiled from their hand (not the graveyard card)', () => {
    let s = board();
    const bearGy = named(s, 'Test Bear', 'graveyard', 'p2')[0]!;
    const hand0 = s.zones.hand['p2']!.length;
    s = cast(s, 'Test Hush-Up', { yes: [true], objects: [[find(s, 'Test Relic', 'graveyard')]] });
    const bears = (): ObjectId[] => [...named(s, 'Test Bear', 'hand', 'p2'), ...named(s, 'Test Bear', 'library', 'p2')];
    const found = bears();
    s = resolveAll(s, { objects: [[bearGy], found] });
    expect(named(s, 'Test Bear', 'exile')).toHaveLength(3);
    expect(named(s, 'Test Ogre', 'graveyard', 'p2')).toHaveLength(1);
    expect(named(s, 'Test Ogre', 'hand', 'p2')).toHaveLength(1);
    // one Bear left the hand, one card was drawn for it
    expect(s.zones.hand['p2']!.length).toBe(hand0);
  });

  it('CR 608.2c: without the evidence nothing is exiled, searched or drawn', () => {
    let s = board();
    const hand0 = s.zones.hand['p2']!.length;
    s = resolveAll(cast(s, 'Test Hush-Up', { yes: [false] }));
    expect(s.zones.exile).toHaveLength(0);
    expect(s.zones.hand['p2']!.length).toBe(hand0);
    expect(gy(s, 'p2')).toHaveLength(2);
  });
});

describe('CR 118.3, 107.3a, 602.2b: "Exile one or more other artifacts you control with total mana value X"', () => {
  const board = (): GameState => scenario([], { defs: DEFS, p1: { battlefield: ['Test Workshop', 'Test Charm', 'Test Charm', 'Test Relic'], graveyard: ['Test Gear'] } });
  function activate(s0: GameState, script: Script): GameState {
    const w = find(s0, 'Test Workshop', 'battlefield');
    const la = legal(s0, 'p1', 'activate').filter((a) => a.object === w && !a.isMana)[0];
    if (!la) throw new Error('no activated ability');
    return drive(act(s0, la.action), script);
  }

  it('CR 107.3a, 118.3: X = 2 is paid with two artifacts of mana value 1, and the card with mana value 2 or less returns', () => {
    let s = board();
    const charms = named(s, 'Test Charm', 'battlefield');
    const gear = find(s, 'Test Gear', 'graveyard');
    s = activate(s, { numbers: [2], targets: [[obj(gear)]], objects: [[...charms]] });
    expect(named(s, 'Test Charm', 'exile')).toHaveLength(2);
    expect(named(s, 'Test Relic', 'battlefield')).toHaveLength(1);
    s = resolveAll(s);
    expect(named(s, 'Test Gear', 'battlefield')).toHaveLength(1);
  });

  it('CR 118.3: the total must be exactly X: a permanent of mana value 4 does not pay X = 2', () => {
    const s = board();
    const relic = find(s, 'Test Relic', 'battlefield');
    const gear = find(s, 'Test Gear', 'graveyard');
    expect(() => activate(s, { numbers: [2], targets: [[obj(gear)]], objects: [[relic]] })).toThrow();
  });

  it('CR 107.3a, 601.2f: an X no set of the other artifacts adds up to (3 from 1 + 1 + 4) can\'t be announced', () => {
    const s = board();
    const gear = find(s, 'Test Gear', 'graveyard');
    expect(() => activate(s, { numbers: [3], targets: [[obj(gear)]] })).toThrow(/X = 3/);
  });

  it('CR 118.3: the source itself is not one of the "other" artifacts; with none other it can\'t be activated', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Workshop'], graveyard: ['Test Gear'] } });
    const w = find(s, 'Test Workshop', 'battlefield');
    expect(legal(s, 'p1', 'activate').some((a) => a.object === w && !a.isMana)).toBe(false);
  });
});

describe('CR 601.2b, 601.2f: "you may sacrifice any number of ... costs {1} less to cast for each permanent sacrificed this way"', () => {
  const canCast = (s: GameState): boolean => legal(s, 'p1', 'cast').some((a) => a.object === find(s, 'Test Grave Asp', 'hand', 'p1'));

  it('CR 601.2f: castable only with the sacrifices; two artifacts sacrificed take {2} off {4}{W}', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Grave Asp'], battlefield: ['Plains', 'Plains', 'Plains', 'Test Charm', 'Test Charm'] } });
    expect(canCast(s)).toBe(true);
    s = cast(s, 'Test Grave Asp', { numbers: [2] });
    expect(s.zones.stack).toHaveLength(1);
    expect(named(s, 'Test Charm', 'graveyard')).toHaveLength(2);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Plains' && s.objects[id]!.tapped)).toHaveLength(3);
  });

  it('CR 601.2b, 601.2h: a number that leaves the total cost unpayable is refused; too few artifacts and the spell is not offered', () => {
    const s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Grave Asp'], battlefield: ['Plains', 'Plains', 'Plains', 'Test Charm', 'Test Charm'] } });
    expect(() => cast(s, 'Test Grave Asp', { numbers: [1] })).toThrow();
    const t = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Grave Asp'], battlefield: ['Plains', 'Plains', 'Plains', 'Test Charm'] } });
    expect(canCast(t)).toBe(false);
  });

  it('CR 601.2b: announcing 0 pays the full cost and sacrifices nothing', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Grave Asp'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Test Charm'] } });
    s = cast(s, 'Test Grave Asp', { numbers: [0] });
    expect(s.zones.stack).toHaveLength(1);
    expect(named(s, 'Test Charm', 'battlefield')).toHaveLength(1);
  });
});

describe('CR 122.1, 201.5, 608.2c: "enters or attacks, put a doom counter on it. Then for each doom counter on it, ..."', () => {
  it('CR 201.5: "it" is the creature itself; on entering one counter, one loss of 2 life', () => {
    let s = scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Grave Asp'], battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Bear'] } });
    s = resolveAll(cast(s, 'Test Grave Asp', { numbers: [0] }), { yes: [false] });
    const asp = find(s, 'Test Grave Asp', 'battlefield');
    expect(s.objects[asp]!.counters['doom']).toBe(1);
    expect(lifeOf(s, 'p2')).toBe(18);
    expect(s.zones.hand['p2']).toHaveLength(1);
  });

  it('CR 608.2c, 118.12: once per counter, each time the opponent may discard instead of losing life', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Grave Asp', since: 0 }] }, p2: { hand: ['Test Bear', 'Test Ogre'] } });
    const asp = find(s, 'Test Grave Asp', 'battlefield');
    s = attack(s, asp, { yes: [true, false] });
    expect(s.objects[asp]!.counters['doom']).toBe(1);
    expect(s.zones.hand['p2']).toHaveLength(1); // discarded once instead of losing 2 life
    expect(lifeOf(s, 'p2')).toBe(20 - 3); // only the combat damage
  });
});

describe('CR 122.1, 603.10a: "for each <kind> counter on it" after the object left the battlefield reads it as it last existed', () => {
  it('CR 603.10a, 608.2h: two fate counters on the sacrificed artifact, two gains of 2 life', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Urn'] } });
    const urn = find(s, 'Test Urn', 'battlefield');
    s = tweak(s, (t) => { t.objects[urn]!.counters['fate'] = 2; });
    const la = legal(s, 'p1', 'activate').filter((a) => a.object === urn && !a.isMana)[0]!;
    s = resolveAll(drive(act(s, la.action)));
    expect(lifeOf(s, 'p1')).toBe(24);
  });
});
