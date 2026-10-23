/**
 * State-based actions on objects (CR 704.5d-z) with real cards. Boards are set up directly, then one priority pass runs the check
 * (CR 704.3: SBAs are checked before a player would receive priority).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, cloneState, createToken, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../src/index';
import { Game } from '../../src/core/game';
import { getTokensFor } from '../fixtures';
import { put } from '../m3/scenario';
import { act, answer, find, findAll, inGraveyard, logHas, onBattlefield, pass, scenario, tweak } from './helpers';

/** Add a card to a zone after the scenario has started (test setup), then let the next pass run the state-based action check. */
function add(s: GameState, owner: PlayerId, zone: 'battlefield' | 'graveyard' | 'hand', name: string, opts: { counters?: Record<string, number> } = {}): { s: GameState; id: ObjectId } {
  let id = '';
  const t = tweak(s, (x) => { id = put(x, owner, zone, { name, ...(opts.counters ? { counters: opts.counters } : {}) }); });
  return { s: t, id };
}

describe('CR 704.5d-e: tokens and copies', () => {
  it('CR 704.5d: a token that is in a zone other than the battlefield ceases to exist (a token creature that dies)', () => {
    const s0 = scenario(['Plains'], {});
    const g = new Game(cloneState(s0));
    const def = compileCard(getTokensFor('Raise the Alarm')[0]!); // the 1/1 white Soldier (the fixture also has Firebender Ascension's 2/2 red Soldier)
    const id = createToken(g, def, 'p1')!;
    const withToken = g.s;
    expect(withToken.objects[id]!.kind).toBe('token');
    expect(withToken.objects[id]!.cardId).toBeUndefined();
    // Give it lethal damage: it is destroyed (704.5g), goes to the graveyard, and ceases to exist in the next check (704.5d).
    const damaged = tweak(withToken, (t) => { t.objects[id]!.damage = 1; });
    const s = pass(damaged);
    expect(s.zones.graveyard.p1).toEqual([]);
    expect(Object.values(s.objects).filter((o) => o.kind === 'token')).toEqual([]);
    expect(logHas(s, /Soldier .* ceases to exist/, 'CR 704.5d')).toBe(true);
    // Last known information of the token that died is kept (CR 603.10).
    expect(s.lki[id]!.leftZone).toBe('battlefield');
  });

  it('CR 704.5d: a token put into another zone (bounced to its owner\'s hand by hand) ceases to exist', () => {
    const s0 = scenario(['Plains'], {});
    const g = new Game(cloneState(s0));
    const id = createToken(g, compileCard(getTokensFor('Raise the Alarm')[0]!), 'p1')!;
    const withToken = g.s;
    // A manual adjustment (milestone 3) moves the token to its owner's hand; state-based actions then remove it.
    const s = pass(tweak(withToken, (t) => {
      t.zones.battlefield = t.zones.battlefield.filter((x) => x !== id);
      t.objects[id]!.zone = 'hand';
      t.zones.hand.p1!.push(id);
    }));
    expect(s.objects[id]).toBeUndefined();
    expect(s.zones.hand.p1).not.toContain(id);
  });

  it('CR 704.5e: a copy of a spell that is not on the stack ceases to exist', () => {
    const s0 = scenario(['Plains'], {});
    const id = 'o-copy';
    const withCopy = tweak(s0, (t) => {
      t.objects[id] = { ...t.objects[t.zones.library.p1![0]!]!, id, kind: 'spellCopy', zone: 'graveyard' };
      t.zones.graveyard.p1!.push(id);
    });
    const s = pass(withCopy);
    expect(s.objects[id]).toBeUndefined();
    expect(s.zones.graveyard.p1).toEqual([]);
  });
});

describe('CR 704.5f-h: toughness and damage', () => {
  it('CR 704.5f: a creature with toughness 0 or less is put into its owner\'s graveyard (-1/-1 counters), regeneration or indestructible notwithstanding', () => {
    const s0 = scenario(['Darksteel Myr', 'Grizzly Bears'], { p1: { battlefield: ['Darksteel Myr', 'Grizzly Bears'] } });
    const s = pass(tweak(s0, (t) => {
      t.objects[find(t, 'Darksteel Myr', 'battlefield')]!.counters['-1/-1'] = 1; // 0/1 -> -1/0
      t.objects[find(t, 'Grizzly Bears', 'battlefield')]!.counters['-1/-1'] = 1; // 2/2 -> 1/1: fine
    }));
    expect(inGraveyard(s, 'Darksteel Myr', 'p1')).toBe(true); // indestructible does not help (CR 704.5f is not destruction)
    expect(onBattlefield(s, 'Grizzly Bears', 'p1')).toBe(true);
  });

  it('CR 704.5g: damage equal to toughness is lethal; one less is not', () => {
    const s0 = scenario(['Hill Giant', 'Craw Wurm'], { p1: { battlefield: ['Hill Giant', 'Craw Wurm'] } });
    const s = pass(tweak(s0, (t) => {
      t.objects[find(t, 'Hill Giant', 'battlefield')]!.damage = 3;
      t.objects[find(t, 'Craw Wurm', 'battlefield')]!.damage = 3; // 6/4
    }));
    expect(inGraveyard(s, 'Hill Giant', 'p1')).toBe(true);
    expect(onBattlefield(s, 'Craw Wurm', 'p1')).toBe(true);
  });

  it('CR 704.5g: a creature whose toughness is not a number the engine can evaluate yet ("*") is never judged by toughness', () => {
    const star = compileCard({ name: 'Test Star', layout: 'normal', type_line: 'Creature — Test', mana_cost: '{2}', power: '*', toughness: '1+*', oracle_text: '', colors: [] } as OracleCard);
    const s0 = scenario([], { p1: { battlefield: ['Test Star'] }, defs: [star] });
    const s = pass(tweak(s0, (t) => { t.objects[find(t, 'Test Star', 'battlefield')]!.damage = 5; }));
    expect(onBattlefield(s, 'Test Star', 'p1')).toBe(true);
  });

  it('CR 704.3: state-based actions are performed simultaneously and the check repeats: a creature dies, then the Aura on it goes too', () => {
    const s0 = scenario(['Hill Giant', 'Grizzly Bears', 'Pacifism'], { p1: { battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Hill Giant'] } });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const { s: s1, id: pac } = add(s0, 'p1', 'battlefield', 'Pacifism');
    const s = pass(tweak(s1, (t) => { t.objects[pac]!.attachedTo = giant; t.objects[giant]!.damage = 3; t.objects[find(t, 'Grizzly Bears', 'battlefield')]!.damage = 2; }));
    expect(inGraveyard(s, 'Hill Giant', 'p2') && inGraveyard(s, 'Grizzly Bears', 'p1')).toBe(true);
    expect(inGraveyard(s, 'Pacifism', 'p1')).toBe(true);
  });
});

describe('CR 704.5i, 704.5q, 704.5v: loyalty, counters and defense', () => {
  it('CR 704.5i: a planeswalker with 0 loyalty is put into its owner\'s graveyard', () => {
    const s0 = scenario(['Jace Beleren', 'Liliana of the Veil'], { p1: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }, { name: 'Liliana of the Veil', counters: { loyalty: 1 } }] } });
    const s = pass(tweak(s0, (t) => { delete t.objects[find(t, 'Liliana of the Veil', 'battlefield')]!.counters.loyalty; }));
    expect(inGraveyard(s, 'Liliana of the Veil', 'p1')).toBe(true);
    expect(onBattlefield(s, 'Jace Beleren', 'p1')).toBe(true);
  });

  it('CR 704.5q: +1/+1 and -1/-1 counters on the same permanent cancel in pairs', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: [{ name: 'Grizzly Bears', counters: { '+1/+1': 3, '-1/-1': 1 } }] } });
    const s = pass(s0);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(s.objects[bears]!.counters).toEqual({ '+1/+1': 2 });
    expect(logHas(s, /loses 1 \+1\/\+1 and 1 -1\/-1 counters/, 'CR 704.5q')).toBe(true);
  });

  it('CR 613.4c: +1/+1 and -1/-1 counters change power and toughness (a 2/2 with two +1/+1 counters survives 3 damage)', () => {
    const s0 = scenario(['Grizzly Bears'], { p1: { battlefield: [{ name: 'Grizzly Bears', counters: { '+1/+1': 2 } }] } });
    const s = pass(tweak(s0, (t) => { t.objects[find(t, 'Grizzly Bears', 'battlefield')]!.damage = 3; }));
    expect(onBattlefield(s, 'Grizzly Bears', 'p1')).toBe(true);
  });

  it('CR 704.5v: a battle with 0 defense counters is put into its owner\'s graveyard', () => {
    const siege = 'Invasion of Ergamon // Truga Cliffcharger';
    const s0 = scenario([siege], { p1: { battlefield: [{ name: siege, counters: { defense: 1 } }] } });
    const s = pass(tweak(s0, (t) => { delete t.objects[find(t, siege, 'battlefield')]!.counters.defense; }));
    expect(inGraveyard(s, siege, 'p1')).toBe(true);
    expect(logHas(s, /defense 0/, 'CR 704.5v')).toBe(true);
  });

  it('CR 704.5w (2026-09-25 edition): a battle that is not a Siege with 0 defense counters goes too, cited by its own rule', () => {
    // No printed battle is anything but a Siege yet (CR 205.3q); a synthetic one with no battle type, protected by its controller (CR 310.9a)
    const frontier = compileCard({ name: 'Test Frontier', layout: 'normal', type_line: 'Battle', oracle_text: '', mana_cost: '{2}', defense: '3', colors: [] } as OracleCard as never);
    const s0 = scenario([], { p1: { battlefield: [{ name: 'Test Frontier', counters: { defense: 1 } }] }, defs: [frontier] });
    const s = pass(tweak(s0, (t) => { delete t.objects[find(t, 'Test Frontier', 'battlefield')]!.counters.defense; }));
    expect(inGraveyard(s, 'Test Frontier', 'p1')).toBe(true);
    expect(logHas(s, /defense 0/, 'CR 704.5w')).toBe(true);
  });

  it('CR 704.5y: a Siege\'s controller can never be its protector: an opponent becomes its protector', () => {
    const siege = 'Invasion of Ergamon // Truga Cliffcharger';
    const s0 = scenario([siege], { p1: { battlefield: [{ name: siege, counters: { defense: 4 } }] } });
    const battle = find(s0, siege, 'battlefield');
    const s = pass(tweak(s0, (t) => { t.objects[battle]!.protector = 'p1'; }));
    expect(s.objects[battle]!.protector).toBe('p2');
    expect(logHas(s, /Bob becomes the protector of Invasion of Ergamon/, 'CR 704.5y')).toBe(true);
  });
});

describe('CR 704.5j: the legend rule', () => {
  it('CR 704.5j: with two legendary permanents of the same name, their controller chooses one; the rest go to the graveyard', () => {
    const s0 = scenario(['Isamaru, Hound of Konda'], { p1: { battlefield: ['Isamaru, Hound of Konda'] } });
    const { s: s1, id: second } = add(s0, 'p1', 'battlefield', 'Isamaru, Hound of Konda');
    const first = find(s0, 'Isamaru, Hound of Konda', 'battlefield', 'p1');
    let s = pass(s1);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1, rules: ['CR 704.5j'] });
    const d = s.pending as { options: string[] };
    expect([...d.options].sort()).toEqual([first, second].sort());
    s = answer(s, { kind: 'chooseObjects', ids: [second] });
    expect(s.pending).toMatchObject({ kind: 'priority' });
    expect(s.zones.battlefield).toContain(second);
    expect(s.zones.battlefield).not.toContain(first);
    expect(inGraveyard(s, 'Isamaru, Hound of Konda', 'p1')).toBe(true);
    expect(logHas(s, /Isamaru, Hound of Konda is put into its owner's graveyard \(legend rule\)/, 'CR 704.5j')).toBe(true);
  });

  it('CR 704.5j: the choice is mandatory and must name one of the permanents (an invalid answer is rejected)', () => {
    const s0 = scenario(['Isamaru, Hound of Konda'], { p1: { battlefield: ['Isamaru, Hound of Konda'] } });
    const s = pass(add(s0, 'p1', 'battlefield', 'Isamaru, Hound of Konda').s);
    expect(() => answer(s, { kind: 'chooseObjects', ids: [] })).toThrow(/Choose exactly 1/);
    expect(() => answer(s, { kind: 'chooseObjects', ids: [find(s, 'Isamaru, Hound of Konda', 'battlefield'), 'nope'] })).toThrow();
  });

  it('CR 704.5j: only permanents controlled by the same player count: each player may control their own copy', () => {
    const s0 = scenario(['Isamaru, Hound of Konda'], { p1: { battlefield: ['Isamaru, Hound of Konda'] }, p2: { battlefield: ['Isamaru, Hound of Konda'] } });
    const s = pass(s0);
    expect(s.pending).toMatchObject({ kind: 'priority' });
    expect(findAll(s, 'Isamaru, Hound of Konda', 'battlefield')).toHaveLength(2);
  });

  it('CR 704.5j: several groups are decided one after the other (Isamaru x2, Thalia x2) and three copies keep one', () => {
    const s0 = scenario(['Isamaru, Hound of Konda', 'Thalia, Guardian of Thraben'], { p1: { battlefield: ['Isamaru, Hound of Konda', 'Thalia, Guardian of Thraben'] } });
    let t = add(s0, 'p1', 'battlefield', 'Isamaru, Hound of Konda').s;
    t = add(t, 'p1', 'battlefield', 'Isamaru, Hound of Konda').s;
    t = add(t, 'p1', 'battlefield', 'Thalia, Guardian of Thraben').s;
    let s = pass(t);
    const first = s.pending as { options: string[] };
    expect(first.options).toHaveLength(3); // Isamaru x3
    s = answer(s, { kind: 'chooseObjects', ids: [first.options[0]!] });
    const second = s.pending as { options: string[]; kind: string };
    expect(second.kind).toBe('chooseObjects');
    expect(second.options).toHaveLength(2); // Thalia x2
    s = answer(s, { kind: 'chooseObjects', ids: [second.options[1]!] });
    expect(s.pending).toMatchObject({ kind: 'priority' });
    expect(findAll(s, 'Isamaru, Hound of Konda', 'battlefield')).toHaveLength(1);
    expect(findAll(s, 'Thalia, Guardian of Thraben', 'battlefield')).toHaveLength(1);
    expect(s.zones.graveyard.p1).toHaveLength(3);
  });
});

describe('CR 704.5k: the world rule', () => {
  it('CR 704.5k: of two permanents with the supertype world, the one that has had it the shortest time stays', () => {
    const s0 = scenario(['Arboria'], { p1: { battlefield: ['Arboria'] } });
    const older = find(s0, 'Arboria', 'battlefield');
    const { s: s1, id: newer } = add(s0, 'p1', 'battlefield', 'Arboria');
    const s = pass(s1);
    expect(s.zones.battlefield).toContain(newer);
    expect(s.zones.battlefield).not.toContain(older);
    expect(inGraveyard(s, 'Arboria', 'p1')).toBe(true);
  });

  it('CR 704.5k: in a tie for the shortest time, all of them are put into their owners\' graveyards', () => {
    const s0 = scenario(['Arboria'], { p1: { battlefield: ['Arboria'] } });
    const { s: s1, id: other } = add(s0, 'p2', 'battlefield', 'Arboria');
    const s = pass(tweak(s1, (t) => { t.objects[other]!.timestamp = t.objects[find(t, 'Arboria', 'battlefield', 'p1')]!.timestamp; }));
    expect(findAll(s, 'Arboria', 'battlefield')).toEqual([]);
    expect(inGraveyard(s, 'Arboria', 'p1') && inGraveyard(s, 'Arboria', 'p2')).toBe(true);
  });
});

describe('CR 704.5m: Auras', () => {
  const setup = (extra: string[] = []) => scenario(['Hill Giant', 'Pacifism', 'Mountain', 'Black Knight', ...extra], { p1: { battlefield: ['Mountain'] }, p2: { battlefield: ['Hill Giant', 'Black Knight'] } });

  it('CR 704.5m: an Aura attached to a legal object stays', () => {
    const s0 = setup();
    const { s: s1, id: pac } = add(s0, 'p1', 'battlefield', 'Pacifism');
    const s = pass(tweak(s1, (t) => { t.objects[pac]!.attachedTo = find(t, 'Hill Giant', 'battlefield'); }));
    expect(onBattlefield(s, 'Pacifism', 'p1')).toBe(true);
  });

  it('CR 704.5m: an Aura that is not attached to anything is put into its owner\'s graveyard', () => {
    const s = pass(add(setup(), 'p1', 'battlefield', 'Pacifism').s);
    expect(inGraveyard(s, 'Pacifism', 'p1')).toBe(true);
    expect(logHas(s, /Pacifism is put into its owner's graveyard \(Aura not attached to anything\)/, 'CR 704.5m')).toBe(true);
  });

  it('CR 704.5m, 303.4c: an Aura attached to an illegal object (Pacifism enchants creatures; it is on a land) goes to the graveyard', () => {
    const s0 = setup();
    const { s: s1, id: pac } = add(s0, 'p1', 'battlefield', 'Pacifism');
    const s = pass(tweak(s1, (t) => { t.objects[pac]!.attachedTo = find(t, 'Mountain', 'battlefield'); }));
    expect(inGraveyard(s, 'Pacifism', 'p1')).toBe(true);
  });

  it('CR 702.16c: an Aura attached to a permanent with protection from it goes to the graveyard (white Pacifism on Black Knight, protection from white)', () => {
    const s0 = setup();
    const { s: s1, id: pac } = add(s0, 'p1', 'battlefield', 'Pacifism');
    const s = pass(tweak(s1, (t) => { t.objects[pac]!.attachedTo = find(t, 'Black Knight', 'battlefield'); }));
    expect(inGraveyard(s, 'Pacifism', 'p1')).toBe(true);
  });

  it('CR 303.4c: an Aura goes to the graveyard when the object it enchants is gone', () => {
    const s0 = setup();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const { s: s1, id: pac } = add(s0, 'p1', 'battlefield', 'Pacifism');
    let s = pass(tweak(s1, (t) => { t.objects[pac]!.attachedTo = giant; }));
    expect(onBattlefield(s, 'Pacifism', 'p1')).toBe(true);
    s = pass(tweak(s, (t) => { t.objects[giant]!.damage = 3; }));
    expect(inGraveyard(s, 'Hill Giant', 'p2') && inGraveyard(s, 'Pacifism', 'p1')).toBe(true);
  });

  it('CR 702.5a, 303.4a: a creature that is also an Aura can not enchant anything: it becomes unattached and is put into the graveyard (CR 303.4d)', () => {
    const odd = compileCard({ name: 'Test Aura Creature', layout: 'normal', type_line: 'Enchantment Creature — Aura', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'Enchant creature', colors: [] } as OracleCard);
    const s0 = scenario(['Hill Giant'], { p2: { battlefield: ['Hill Giant'] }, defs: [odd] });
    const { s: s1, id } = add(s0, 'p1', 'battlefield', 'Test Aura Creature');
    const s = pass(tweak(s1, (t) => { t.objects[id]!.attachedTo = find(t, 'Hill Giant', 'battlefield'); }));
    expect(inGraveyard(s, 'Test Aura Creature', 'p1')).toBe(true);
  });

  it('CR 704.5z: of several Roles one player controls on the same permanent, only the most recent stays', () => {
    const role = (name: string) => compileCard({ name, layout: 'normal', type_line: 'Enchantment — Aura Role', oracle_text: 'Enchant creature', colors: [] } as OracleCard);
    const s0 = scenario(['Hill Giant'], { p2: { battlefield: ['Hill Giant'] }, defs: [role('Test Role A'), role('Test Role B')] });
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const a = add(s0, 'p1', 'battlefield', 'Test Role A');
    const b = add(a.s, 'p1', 'battlefield', 'Test Role B');
    const s = pass(tweak(b.s, (t) => { t.objects[a.id]!.attachedTo = giant; t.objects[b.id]!.attachedTo = giant; }));
    expect(inGraveyard(s, 'Test Role A', 'p1')).toBe(true);
    expect(onBattlefield(s, 'Test Role B', 'p1')).toBe(true);
  });
});

describe('CR 704.5n, 704.5p: Equipment and other attachments', () => {
  const setup = () => scenario(['Hill Giant', 'Bonesplitter', 'Mountain', 'Grizzly Bears'], { p1: { battlefield: ['Mountain'] }, p2: { battlefield: ['Hill Giant', 'Grizzly Bears'] } });

  it('CR 704.5n: an Equipment attached to a creature stays; when the creature leaves it becomes unattached and remains on the battlefield', () => {
    const s0 = setup();
    const giant = find(s0, 'Hill Giant', 'battlefield');
    const { s: s1, id: eq } = add(s0, 'p1', 'battlefield', 'Bonesplitter');
    let s = pass(tweak(s1, (t) => { t.objects[eq]!.attachedTo = giant; }));
    expect(s.objects[eq]!.attachedTo).toBe(giant);
    s = pass(tweak(s, (t) => { t.objects[giant]!.damage = 3; }));
    expect(inGraveyard(s, 'Hill Giant', 'p2')).toBe(true);
    expect(onBattlefield(s, 'Bonesplitter', 'p1')).toBe(true);
    expect(s.objects[eq]!.attachedTo).toBeUndefined();
  });

  it('CR 301.5, 704.5n: an Equipment can\'t be attached to anything that isn\'t a creature (a land, a player)', () => {
    const s0 = setup();
    const { s: s1, id: eq } = add(s0, 'p1', 'battlefield', 'Bonesplitter');
    const onLand = pass(tweak(s1, (t) => { t.objects[eq]!.attachedTo = find(t, 'Mountain', 'battlefield'); }));
    expect(onLand.objects[eq]!.attachedTo).toBeUndefined();
    expect(logHas(onLand, /Bonesplitter becomes unattached/, 'CR 704.5n')).toBe(true);
    const onPlayer = pass(tweak(s1, (t) => { t.objects[eq]!.attachedTo = 'p2'; }));
    expect(onPlayer.objects[eq]!.attachedTo).toBeUndefined();
  });

  it('CR 704.5p: a creature (or any permanent that is not an Aura, Equipment or Fortification) that is attached to something becomes unattached', () => {
    const s0 = setup();
    const bears = find(s0, 'Grizzly Bears', 'battlefield');
    const s = pass(tweak(s0, (t) => { t.objects[bears]!.attachedTo = find(t, 'Hill Giant', 'battlefield'); }));
    expect(s.objects[bears]!.attachedTo).toBeUndefined();
    expect(onBattlefield(s, 'Grizzly Bears', 'p2')).toBe(true);
    expect(logHas(s, /Grizzly Bears becomes unattached/, 'CR 704.5p')).toBe(true);
  });

  it('a resolving effect can attach by hand (manual "attach" operation): Equip is manual text until milestone 5', () => {
    const s0 = scenario(['Hill Giant', 'Bonesplitter', 'Lightning Bolt', 'Mountain'], { p1: { battlefield: ['Bonesplitter', 'Mountain'], hand: ['Lightning Bolt'] }, p2: { battlefield: ['Hill Giant'] }, manual: ['Lightning Bolt'] });
    const eq = find(s0, 'Bonesplitter', 'battlefield');
    const giant = find(s0, 'Hill Giant', 'battlefield');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand', 'p1') });
    s = answer(s, { kind: 'payCost', auto: true });
    s = pass(pass(s));
    expect(s.pending).toMatchObject({ kind: 'manualResolve' });
    // Attaching something to itself is refused, and so is attaching to something that does not exist.
    expect(() => answer(s, { kind: 'manualResolve', ops: [{ op: 'attach', object: eq, to: eq }] })).toThrow(/itself/);
    expect(() => answer(s, { kind: 'manualResolve', ops: [{ op: 'attach', object: eq, to: 'nope' }] })).toThrow();
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'attach', object: eq, to: giant }] });
    expect(s.objects[eq]!.attachedTo).toBe(giant);
    expect(logHas(s, /Alice attaches Bonesplitter to Hill Giant by hand/)).toBe(true);
    // Detaching again.
    const t2 = tweak(s, () => undefined);
    expect(t2.objects[eq]!.attachedTo).toBe(giant);
  });
});
