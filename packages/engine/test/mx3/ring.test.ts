/**
 * MX3: the Ring tempts you (CR 701.54). The emblem named The Ring and its four cumulative abilities (CR 701.54c), the choice of a Ring-bearer (CR 701.54a),
 * the designation and its end (CR 701.54a-b, 701.54e), the triggers on the Ring tempting you and on choosing a Ring-bearer (CR 701.54d), and real cards on the
 * game path (fixture cards compiled by the default compiler) driven with real actions. Synthetic cards are compiled from their Oracle-style wording.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, getChars, missingCapabilities, validateAbility, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../src/index';
import { RING_ABILITIES, ringAbilitiesAt, ringBearerOf, timesTempted } from '../../src/core/ring';
import { getCard } from '../fixtures';
import { act, answer, find, pass, scenario, tweak } from '../m5/helpers';
import { cast, drive, resolveTop, target } from '../m5/cr-examples/helpers';
import { declareAttackers, declareBlockers, lifeOf, passUntil, toDeclareAttackers, toDeclareBlockers } from '../m4/helpers';

const card = (name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);

const TEMPT = card('Test Temptation', 'Sorcery', 'The Ring tempts you.');
const LISTENER = card('Test Listener', 'Enchantment', 'Whenever the Ring tempts you, you gain 1 life.');
const CHOOSER = card('Test Chooser', 'Enchantment', 'Whenever you choose a creature as your Ring-bearer, you gain 2 life.');
const DEFS = [TEMPT, LISTENER, CHOOSER];
const CARDS = ['Grizzly Bears', 'Hill Giant', 'Plains', 'Forest', 'Mountain', 'Act of Treason'];

const ringOf = (s: GameState, p = 'p1') => s.designations.ring?.[p];
const emblemOf = (s: GameState, p = 'p1') => s.objects[ringOf(s, p)!.emblem!]!;
const handSize = (s: GameState, p: string) => s.zones.hand[p]!.length;
/** Pass priority (declaring no attackers and no blockers) until `done`. */
function until(s: GameState, done: (s: GameState) => boolean): GameState {
  for (let i = 0; i < 120 && !done(s); i++) {
    if (s.pending?.kind === 'declareAttackers') s = declareAttackers(s, []);
    else if (s.pending?.kind === 'declareBlockers') s = declareBlockers(s, []);
    else s = drive(pass(s));
  }
  if (!done(s)) throw new Error('never reached the state');
  return s;
}
const graveNames = (s: GameState, p: string) => s.zones.graveyard[p]!.map((id) => s.defs[s.objects[id]!.defId]!.name);

/** Cast Test Temptation (from p1's hand) and resolve it, choosing `bearer` when the engine asks. */
function tempt(s: GameState, bearer?: ObjectId): GameState {
  s = resolveTop(cast(s, 'Test Temptation'), bearer ? [{ kind: 'chooseObjects', ids: [bearer] }] : []);
  return drive(s);
}

/** A board where p1 can cast Test Temptation `n` times (one copy in hand per temptation). */
const board = (n: number, p1Bf: (string | { name: string; tapped?: boolean })[] = [], p2Bf: (string | { name: string; tapped?: boolean })[] = [], extraHand: string[] = []): GameState =>
  scenario(CARDS, { defs: DEFS, p1: { hand: [...Array(n).fill('Test Temptation'), ...extraHand], battlefield: p1Bf }, p2: { battlefield: p2Bf } });

describe('MX3: capabilities and the cards on the game path', () => {
  it('action:ringTempts, the trigger event and the filter field are advertised (native handler, emitter, both evaluators)', () => {
    for (const c of ['action:ringTempts', 'feature:action.native.ringTempts', 'feature:ev.action.ringTempts', 'filter:ringBearer']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
  it('the four abilities of The Ring are valid data (schema and lint) and need only capabilities the engine has (CR 701.54c)', () => {
    for (const a of ringAbilitiesAt(4)) {
      expect(validateAbility(a), a.text).toEqual([]);
      expect(missingCapabilities(a, ENGINE_CAPABILITIES), a.text).toEqual([]);
    }
    expect(ringAbilitiesAt(0)).toHaveLength(1);
    expect(ringAbilitiesAt(9)).toHaveLength(4);
  });
  it('the Ring cards compile to full automation', () => {
    // Call of the Ring is full since FAST5 T44 read "you may pay 2 life. If you do, draw a card." (an optional pay step, CR 119.4, 608.2d)
    for (const n of ['Claim the Precious', 'Birthday Escape', 'Bilbo, Retired Burglar', 'Gandalf, Friend of the Shire', 'Frodo Baggins', 'Dúnedain Rangers', 'Call of the Ring']) {
      expect(compileCard(getCard(n)).automation.level, n).toBe('full');
    }
    // Nazgûl is full since Standard merge wave 5: r3-static reads its deck rule ("A deck can have up to nine cards named Nazgûl", a deck-construction
    // rule with no effect in the game, CR 100.2a); chapter III of One Ring, outside CR 701.54, keeps it partial
    expect(compileCard(getCard('Nazgûl')).automation.level).toBe('full');
    expect(compileCard(getCard('One Ring to Rule Them All')).automation.level).toBe('partial');
    const call = compileCard(getCard('Call of the Ring')).faces[0]!.abilities;
    expect(call[1]).toMatchObject({ kind: 'triggered', trigger: { on: [{ ev: 'action', verb: 'ringTempts', actor: 'you', object: { types: ['Creature'] } }] } });
    expect(call[1]).toMatchObject({ effect: { steps: [{ op: 'pay', who: { ref: 'you' }, cost: { other: [{ kind: 'payLife', amount: 2 }] }, then: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] }] } });
    expect((call[1] as { effect: { steps: { mandatory?: boolean }[] } }).effect.steps[0]!.mandatory).toBeUndefined(); // "you may" (CR 119.4)
  });
});

describe('CR 701.54a, 701.54c: the first temptation', () => {
  it('the player gets an emblem named The Ring with its first ability, then chooses a creature they control as Ring-bearer', () => {
    let s = board(1, ['Grizzly Bears', 'Hill Giant'], ['Grizzly Bears']);
    const giant = find(s, 'Hill Giant', 'battlefield', 'p1');
    s = resolveTop(cast(s, 'Test Temptation'));
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', player: 'p1', min: 1, max: 1 });
    const options = (s.pending as unknown as { options: string[] }).options;
    expect(options.sort()).toEqual([find(s, 'Grizzly Bears', 'battlefield', 'p1'), giant].sort()); // only creatures p1 controls (CR 701.54a)
    s = drive(answer(s, { kind: 'chooseObjects', ids: [giant] }));
    expect(timesTempted(s, 'p1')).toBe(1);
    expect(ringBearerOf(s, 'p1')).toBe(giant);
    const emblem = emblemOf(s);
    expect(emblem.zone).toBe('command');
    expect(emblem.owner).toBe('p1');
    expect(s.zones.command).toContain(emblem.id);
    expect(s.defs[emblem.defId]!.name).toBe('The Ring');
    expect(s.defs[emblem.defId]!.faces[0]!.abilities.map((a) => a.text)).toEqual([RING_ABILITIES[0]!.text]);
    expect(s.log.some((l) => /gets an emblem named The Ring/.test(l.text) && l.rules?.includes('CR 701.54c'))).toBe(true);
  });

  it('with one creature the choice is made for the player; with none, the Ring still tempts them (CR 701.54d) and there is no Ring-bearer', () => {
    let s = board(2, [], [], ['Test Listener']);
    s = resolveTop(cast(s, 'Test Listener'));
    const life = lifeOf(s, 'p1');
    s = tempt(s);
    expect(timesTempted(s, 'p1')).toBe(1);
    expect(ringBearerOf(s, 'p1')).toBeUndefined();
    expect(emblemOf(s).zone).toBe('command');
    s = resolveTop(s); // "whenever the Ring tempts you" (CR 701.54d) triggered although nothing could be chosen
    expect(lifeOf(s, 'p1')).toBe(life + 1);
  });

  it('the same creature may be chosen again, and the count grows each time; the emblem gains its abilities cumulatively', () => {
    let s = board(4, ['Grizzly Bears']);
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    for (let i = 1; i <= 4; i++) {
      s = tempt(s);
      expect(timesTempted(s, 'p1')).toBe(i);
      expect(ringBearerOf(s, 'p1')).toBe(bears);
      expect(s.defs[emblemOf(s).defId]!.faces[0]!.abilities.map((a) => a.text)).toEqual(RING_ABILITIES.slice(0, i).map((a) => a.text));
    }
    expect(s.zones.command.filter((id) => s.objects[id]!.kind === 'emblem')).toHaveLength(1); // one emblem per player (CR 701.54c)
  });
});

describe('CR 701.54d: "whenever the Ring tempts you" and "whenever you choose a creature as your Ring-bearer"', () => {
  it('choosing a creature triggers the second; no creature to choose triggers only the first', () => {
    let s = board(1, [], [], ['Test Chooser', 'Test Listener']);
    s = resolveTop(cast(resolveTop(cast(s, 'Test Chooser')), 'Test Listener'));
    s = tempt(s);
    expect(s.zones.stack.map((id) => s.objects[id]!.stack?.sourceName ?? s.defs[s.objects[id]!.defId]?.name)).toHaveLength(1); // the listener only
    let t2 = board(1, ['Grizzly Bears'], [], ['Test Chooser']);
    t2 = resolveTop(cast(t2, 'Test Chooser'));
    const life = lifeOf(t2, 'p1');
    t2 = tempt(t2);
    expect(t2.zones.stack).toHaveLength(1);
    t2 = resolveTop(t2);
    expect(lifeOf(t2, 'p1')).toBe(life + 2);
  });

  it('Gandalf, Friend of the Shire: draws only when a creature other than Gandalf is chosen (CR 603.4)', () => {
    let s = scenario([...CARDS, 'Gandalf, Friend of the Shire'], { defs: DEFS, p1: { hand: ['Test Temptation', 'Test Temptation'], battlefield: ['Gandalf, Friend of the Shire', 'Grizzly Bears'] } });
    const gandalf = find(s, 'Gandalf, Friend of the Shire', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = tempt(s, gandalf);
    expect(s.zones.stack).toHaveLength(0); // the intervening "if" is false: no trigger
    s = tempt(s, bears);
    expect(s.zones.stack).toHaveLength(1);
    const hand = handSize(s, 'p1');
    s = resolveTop(s);
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });

  it('Nazgûl: entering tempts you, and the temptation puts a +1/+1 counter on each Wraith you control', () => {
    let s = scenario([...CARDS, 'Nazgûl', 'Swamp'], { defs: DEFS, p1: { hand: ['Nazgûl'], battlefield: ['Swamp', 'Swamp', 'Swamp'] } });
    s = resolveTop(cast(s, 'Nazgûl')); // the creature spell resolves; its enters trigger goes on the stack
    s = drive(resolveTop(s)); // the Ring tempts you: Nazgûl is the only creature
    const naz = find(s, 'Nazgûl', 'battlefield');
    expect(ringBearerOf(s, 'p1')).toBe(naz);
    s = resolveTop(s); // "whenever the Ring tempts you"
    expect(s.objects[naz]!.counters['+1/+1']).toBe(1);
    expect(getChars(s, naz).supertypes).toContain('Legendary'); // the Ring's first ability (CR 701.54c)
  });
});

describe('CR 701.54c: the abilities of The Ring', () => {
  it('level 1: your Ring-bearer is legendary and can\'t be blocked by creatures with greater power', () => {
    let s = board(1, ['Grizzly Bears'], ['Hill Giant', 'Grizzly Bears']);
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    expect(getChars(s, bears).supertypes).not.toContain('Legendary');
    s = tempt(s);
    expect(getChars(s, bears).supertypes).toContain('Legendary');
    s = declareAttackers(toDeclareAttackers(s), [[bears]]);
    s = toDeclareBlockers(s);
    const giant = find(s, 'Hill Giant', 'battlefield', 'p2');
    const theirBears = find(s, 'Grizzly Bears', 'battlefield', 'p2');
    expect(() => declareBlockers(s, [[giant, bears]])).toThrow(); // 3 power > 2 power (CR 509.1b)
    s = declareBlockers(s, [[theirBears, bears]]); // equal power may block
    expect(s.combat?.blockers.some((b) => b.id === theirBears)).toBe(true);
  });

  it('level 2: whenever your Ring-bearer attacks, draw a card, then discard a card', () => {
    let s = board(2, ['Grizzly Bears']);
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    s = tempt(tempt(s));
    expect(handSize(s, 'p1')).toBe(0);
    s = declareAttackers(toDeclareAttackers(s), [[bears]]);
    s = passUntil(s, (x) => x.zones.stack.length > 0, 'the attack trigger');
    s = drive(pass(pass(s)));
    expect(handSize(s, 'p1')).toBe(0); // drew one, then discarded it (the only card in hand, CR 701.9b)
    expect(graveNames(s, 'p1').filter((n) => n === 'Plains')).toHaveLength(1); // the scenario library is Plains
  });

  it('level 3: the creature blocking your Ring-bearer is sacrificed by its controller at end of combat', () => {
    let s = scenario([...CARDS, 'Maritime Guard'], { defs: DEFS, p1: { hand: Array(3).fill('Test Temptation'), battlefield: ['Grizzly Bears'] }, p2: { battlefield: ['Maritime Guard'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    const guard = find(s, 'Maritime Guard', 'battlefield', 'p2');
    s = tempt(tempt(tempt(s)));
    s = declareAttackers(toDeclareAttackers(s), [[bears]]);
    for (let i = 0; i < 20 && s.pending?.kind !== 'declareBlockers'; i++) {
      s = s.pending?.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: [s.zones.hand.p1![0]!] }) : drive(pass(s)); // the level-2 loot
    }
    s = declareBlockers(s, [[guard, bears]]); // power 1, not greater than 2: a legal block (level 1)
    for (let i = 0; i < 40 && s.turn.step !== 'main2'; i++) s = drive(pass(s));
    expect(s.zones.battlefield).not.toContain(guard); // 2 damage did not kill the 1/3: it was sacrificed at end of combat (CR 701.21a)
    expect(graveNames(s, 'p2')).toContain('Maritime Guard');
    expect(s.zones.battlefield).toContain(bears);
    expect(s.log.some((l) => /Bob sacrifices Maritime Guard/.test(l.text))).toBe(true);
  });

  it('level 4: whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life', () => {
    let s = board(4, ['Grizzly Bears']);
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    s = tempt(tempt(tempt(tempt(s))));
    const before = lifeOf(s, 'p2');
    s = declareAttackers(toDeclareAttackers(s), [[bears]]);
    for (let i = 0; i < 40 && s.turn.step !== 'main2'; i++) {
      if (s.pending?.kind === 'declareBlockers') { s = declareBlockers(s, []); continue; }
      if (s.pending?.kind === 'chooseObjects') { s = answer(s, { kind: 'chooseObjects', ids: [s.zones.hand.p1![0]!] }); continue; }
      s = drive(pass(s));
    }
    expect(lifeOf(s, 'p2')).toBe(before - 2 - 3);
  });
});

describe('CR 701.54a, 701.54e: the designation ends', () => {
  it('when another player gains control of the Ring-bearer, even after control returns', () => {
    let s = scenario(CARDS, { defs: DEFS, p1: { battlefield: ['Hill Giant'] }, p2: { hand: ['Act of Treason'], battlefield: ['Mountain', 'Mountain', 'Mountain'] } });
    const g2 = find(s, 'Hill Giant', 'battlefield', 'p1');
    s = tweak(s, (x) => { x.designations.ring = { p1: { tempted: 1, bearer: g2 } }; }); // as a temptation left it (tested above)
    expect(ringBearerOf(s, 'p1')).toBe(g2);
    s = until(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority' && x.pending.player === 'p2');
    s = resolveTop(cast(s, 'Act of Treason', [target(g2)], 'p2'));
    expect(getChars(s, g2).controller).toBe('p2');
    expect(ringBearerOf(s, 'p1')).toBeUndefined();
    expect(ringBearerOf(s, 'p2')).toBeUndefined(); // it is nobody's Ring-bearer
    s = until(s, (x) => x.turn.activePlayer === 'p1' && x.turn.step === 'main1');
    expect(getChars(s, g2).controller).toBe('p1');
    expect(ringBearerOf(s, 'p1')).toBeUndefined(); // CR 701.54a: getting it back does not make it the Ring-bearer again
  });

  it('when it leaves the battlefield (CR 400.7): Claim the Precious destroys it, then tempts you with the creatures left', () => {
    let s = scenario([...CARDS, 'Claim the Precious', 'Swamp'], { defs: DEFS, p1: { hand: ['Test Temptation', 'Claim the Precious'], battlefield: ['Grizzly Bears', 'Hill Giant', 'Swamp', 'Swamp', 'Swamp'] } });
    const giant = find(s, 'Hill Giant', 'battlefield', 'p1');
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    s = tempt(s, giant);
    s = resolveTop(cast(s, 'Claim the Precious', [target(giant)])); // destroy, then the Ring tempts you: only the Bears are left
    expect(ringBearerOf(s, 'p1')).toBe(bears);
    expect(timesTempted(s, 'p1')).toBe(2);
  });
});

describe('cards that read the designation (CR 701.54e)', () => {
  it('Dúnedain Rangers: landfall tempts you only if you don\x27t control a Ring-bearer', () => {
    let s = scenario([...CARDS, 'Dúnedain Rangers'], { defs: DEFS, p1: { hand: ['Forest', 'Test Temptation'], battlefield: ['Dúnedain Rangers'] } });
    s = drive(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand', 'p1') }));
    expect(s.zones.stack).toHaveLength(1); // no Ring-bearer yet: it triggers
    s = drive(resolveTop(s));
    expect(timesTempted(s, 'p1')).toBe(1);
    expect(ringBearerOf(s, 'p1')).toBe(find(s, 'Dúnedain Rangers', 'battlefield'));
    s = tweak(s, (x) => { x.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn = 0; const id = x.zones.battlefield.find((i) => x.defs[x.objects[i]!.defId]!.name === 'Forest')!; x.zones.battlefield = x.zones.battlefield.filter((i) => i !== id); x.objects[id]!.zone = 'hand'; x.zones.hand.p1!.push(id); });
    s = drive(act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand', 'p1') }));
    expect(s.zones.stack).toHaveLength(0); // you control a Ring-bearer: the intervening "if" is false (CR 603.4)
  });

  it('Frodo Baggins must be blocked if able only while he is your Ring-bearer', () => {
    const setup = (): GameState => scenario([...CARDS, 'Frodo Baggins', 'Maritime Guard'], { defs: DEFS, p1: { hand: ['Test Temptation'], battlefield: ['Frodo Baggins', 'Grizzly Bears'] }, p2: { battlefield: ['Maritime Guard'] } });
    const attack = (s: GameState): GameState => toDeclareBlockers(declareAttackers(toDeclareAttackers(s), [[find(s, 'Frodo Baggins', 'battlefield')]]));
    // the Bears are the Ring-bearer: no requirement on Frodo, so p2 may block nothing
    let s = attack(tempt(setup(), find(setup(), 'Grizzly Bears', 'battlefield')));
    expect(() => declareBlockers(s, [])).not.toThrow();
    // Frodo is the Ring-bearer: the Guard (power 1, not greater than Frodo's 1) must block him (CR 509.1c)
    s = setup();
    const frodo = find(s, 'Frodo Baggins', 'battlefield');
    s = attack(tempt(s, frodo));
    expect(() => declareBlockers(s, [])).toThrow();
    s = declareBlockers(s, [[find(s, 'Maritime Guard', 'battlefield'), frodo]]);
    expect(s.combat?.blockers).toHaveLength(1);
  });

  it('One Ring to Rule Them All: chapter I tempts you, then each player mills cards equal to your Ring-bearer\'s power', () => {
    let s = scenario([...CARDS, 'One Ring to Rule Them All', 'Swamp'], { defs: DEFS, p1: { hand: ['One Ring to Rule Them All'], battlefield: ['Hill Giant', 'Swamp', 'Swamp', 'Swamp', 'Swamp'] } });
    const lib1 = s.zones.library.p1!.length;
    const lib2 = s.zones.library.p2!.length;
    s = resolveTop(cast(s, 'One Ring to Rule Them All'));
    s = drive(resolveTop(s)); // chapter I
    expect(ringBearerOf(s, 'p1')).toBe(find(s, 'Hill Giant', 'battlefield'));
    expect(lib1 - s.zones.library.p1!.length).toBe(3);
    expect(lib2 - s.zones.library.p2!.length).toBe(3);
  });
});
