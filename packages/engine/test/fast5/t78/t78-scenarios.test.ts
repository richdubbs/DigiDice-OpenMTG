/**
 * FAST5 T78: optional cost-like instructions followed by "if you do" / "when you do" ("you may tap two untapped artifacts and/or creatures you control", "you may tap
 * another untapped Elf you control", "then you may sacrifice an artifact", "you may sacrifice a permanent other than that creature or ~", "you may pay life equal to
 * its power", "you may remove a +1/+1 counter from each of two creatures you control", "you may discard a card or sacrifice a land", "tap any number of untapped
 * creatures you control" and its "for each creature tapped this way", the pinned scope of "if you do, draw a card and ...", "the sacrificed creature's power"), played
 * through the engine with synthetic cards compiled by the game's default compiler (wordings are invented, design 6.10).
 *
 *   CR 118.12            "[Do something]. If [a player] does, ...": "if you do" is true when the player chose to and did it
 *   CR 118.3, 608.2d     a player can't choose an action they can't take in full
 *   CR 603.12            "When you do" is a reflexive triggered ability
 *   CR 608.2c, 608.2h    the instructions in order; the sacrificed creature's power is its last known information; "tapped this way" counts what was tapped
 *   CR 701.26a           only an untapped permanent can be tapped
 *   CR 119.4             a player can pay life only if their life total is at least the payment
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, battlefieldNames, find, findAll, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';
import { ruleDenial } from '../../../src/statics/hooks';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };

/** Answer the decisions that come up: targets from `targets`, object choices from `picks`, then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): { s: GameState; asked: string[] } {
  let s = s0;
  const asked: string[] = [];
  const groups = [...(opts.targets ?? [])];
  const picks = [...(opts.picks ?? [])];
  const queue = [...(opts.answers ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    asked.push(s.pending.kind);
    if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (s.pending.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (s.pending.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return { s, asked };
}
type Opts = Parameters<typeof settle>[1];
/** Cast a permanent spell p1 holds, let it resolve, then resolve what it triggered. */
function castAndResolve(s0: GameState, name: string, opts: Opts = {}): { s: GameState; asked: string[] } {
  let r = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }));
  r = settle(pass(pass(r.s)), opts);
  const asked = [...r.asked];
  let s = r.s;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 6; guard++) {
    const next = settle(pass(pass(s)), opts);
    asked.push(...next.asked);
    s = next.s;
  }
  return { s, asked };
}
const handSize = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const power = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.power);
const toughness = (s: GameState, id: ObjectId): number => Number(getChars(s, id)!.toughness);
const tapped = (s: GameState, id: ObjectId): boolean => s.objects[id]!.tapped;
/** The tokens of that name p1 controls. */
const tokens = (s: GameState, name: string, p = 'p1'): number => s.zones.battlefield.filter((id) => s.objects[id]!.defId.startsWith(`token:${name}`) && s.objects[id]!.controller === p).length;

const ELF = card('Test Elf', 'Creature — Elf', '', ['2', '2']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['3', '3']);
const ROCK = card('Test Rock', 'Artifact', '');
const GEM = card('Test Gem', 'Artifact — Gem', '');
const ISLE = card('Test Isle', 'Land', '');

describe('CR 118.12, 701.26a: "you may tap two untapped artifacts and/or creatures you control. If you do, draw a card."', () => {
  const SMITH = card('Test Smith', 'Creature — Dwarf', 'When Test Smith enters, you may tap two untapped artifacts and/or creatures you control. If you do, draw a card.', ['1', '1']);
  it('is automated', () => expect(automated(SMITH)).toBe(true));
  it('with enough untapped permanents: taps two of them (one a creature, one an artifact) and draws', () => {
    const s0 = scenario([], { p1: { hand: ['Test Smith'], battlefield: ['Test Elf', 'Test Rock', 'Test Isle'] }, defs: [SMITH, ELF, ROCK, ISLE] });
    const { s } = castAndResolve(s0, 'Test Smith', { answers: [yes], picks: [[find(s0, 'Test Elf', 'battlefield', 'p1'), find(s0, 'Test Rock', 'battlefield', 'p1')]] });
    expect(tapped(s, find(s0, 'Test Elf', 'battlefield', 'p1'))).toBe(true);
    expect(tapped(s, find(s0, 'Test Rock', 'battlefield', 'p1'))).toBe(true);
    expect(tapped(s, find(s0, 'Test Isle', 'battlefield', 'p1'))).toBe(false); // a land is neither an artifact nor a creature
    expect(handSize(s)).toBe(1);
  });
  it('declined: nothing is tapped, nothing is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Smith'], battlefield: ['Test Elf', 'Test Rock'] }, defs: [SMITH, ELF, ROCK] });
    const { s } = castAndResolve(s0, 'Test Smith', { answers: [no] });
    expect(tapped(s, find(s0, 'Test Elf', 'battlefield', 'p1'))).toBe(false);
    expect(handSize(s)).toBe(0);
  });
  it('CR 118.3: with fewer than two untapped artifacts and creatures (a tapped one does not count; the entering Smith itself does) it cannot be paid: no draw', () => {
    const s0 = scenario([], { p1: { hand: ['Test Smith'], battlefield: [{ name: 'Test Elf', tapped: true }] }, defs: [SMITH, ELF] });
    const { s } = castAndResolve(s0, 'Test Smith', { answers: [yes] });
    expect(tapped(s, find(s0, 'Test Elf', 'battlefield', 'p1'))).toBe(true);
    expect(handSize(s)).toBe(0);
    expect(tapped(s, find(s, 'Test Smith', 'battlefield', 'p1'))).toBe(false);
  });
});

describe('CR 118.12, 603.12: "you may tap another untapped Elf you control. When you do, ..." (never the source itself)', () => {
  const GUIDE = card('Test Guide', 'Creature — Elf', 'When Test Guide enters, you may tap another untapped Elf you control. When you do, you gain 3 life.', ['1', '1']);
  it('is automated', () => expect(automated(GUIDE)).toBe(true));
  it('taps the other Elf, then the reflexive trigger gains 3 life', () => {
    const s0 = scenario([], { p1: { hand: ['Test Guide'], battlefield: ['Test Elf'] }, defs: [GUIDE, ELF] });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
    // Test Elf is a plain Elf-typed? it has the Elf subtype
    const { s } = castAndResolve(s0, 'Test Guide', { answers: [yes] });
    expect(tapped(s, elf)).toBe(true);
    expect(life(s, 'p1')).toBe(23);
  });
  it('with no other untapped Elf (the source is not another one) there is nothing to tap and nothing follows', () => {
    const s0 = scenario([], { p1: { hand: ['Test Guide'] }, defs: [GUIDE] });
    const { s } = castAndResolve(s0, 'Test Guide', { answers: [yes] });
    expect(life(s, 'p1')).toBe(20);
    expect(tapped(s, find(s, 'Test Guide', 'battlefield', 'p1'))).toBe(false);
  });
  it('declined: the Elf stays untapped and no life is gained', () => {
    const s0 = scenario([], { p1: { hand: ['Test Guide'], battlefield: ['Test Elf'] }, defs: [GUIDE, ELF] });
    const { s } = castAndResolve(s0, 'Test Guide', { answers: [no] });
    expect(tapped(s, find(s0, 'Test Elf', 'battlefield', 'p1'))).toBe(false);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 118.12, 701.21a, 603.12: "Then you may sacrifice an artifact. When you do, ..." and "Then you may sacrifice ~. When you do, ..."', () => {
  const BLAST = card('Test Blast', 'Instant', 'Draw a card. Then you may sacrifice an artifact. When you do, Test Blast deals 2 damage to each creature.', undefined, '{0}');
  const SPRING = card('Test Spring', 'Land', '{T}: Add {C}.\n{1}, {T}: Mill two cards. Then you may sacrifice this land. When you do, draw two cards.');
  it('are automated', () => {
    expect(automated(BLAST)).toBe(true);
    expect(automated(SPRING)).toBe(true);
  });
  it('the spell: draws, then (sacrificing an artifact) deals 2 damage to each creature', () => {
    const s0 = scenario([], { p1: { hand: ['Test Blast'], battlefield: ['Test Rock'] }, p2: { battlefield: ['Test Bear'] }, defs: [BLAST, ROCK, BEAR] });
    const r = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Blast', 'hand', 'p1') }));
    const { s } = settle(pass(pass(r.s)), { answers: [yes] });
    const done = s.zones.stack.length > 0 ? settle(pass(pass(s))).s : s;
    expect(battlefieldNames(done, 'p1')).not.toContain('Test Rock');
    expect(done.objects[find(done, 'Test Bear', 'battlefield', 'p2')]!.damage).toBe(2);
    expect(handSize(done)).toBe(1);
  });
  it('the spell: declined (or no artifact): no damage', () => {
    const s0 = scenario([], { p1: { hand: ['Test Blast'], battlefield: ['Test Rock'] }, p2: { battlefield: ['Test Bear'] }, defs: [BLAST, ROCK, BEAR] });
    const r = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Blast', 'hand', 'p1') }));
    const { s } = settle(pass(pass(r.s)), { answers: [no] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Rock');
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.damage).toBe(0);
    const none = scenario([], { p1: { hand: ['Test Blast'] }, p2: { battlefield: ['Test Bear'] }, defs: [BLAST, BEAR] });
    const r2 = settle(act(none, { type: 'cast', player: 'p1', card: find(none, 'Test Blast', 'hand', 'p1') }));
    const { s: t } = settle(pass(pass(r2.s)), { answers: [yes] });
    expect(t.objects[find(t, 'Test Bear', 'battlefield', 'p2')]!.damage).toBe(0);
  });
  it('the land: after milling, sacrificing itself starts the reflexive trigger that draws two cards', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Spring', 'Plains'] }, defs: [SPRING] });
    const spring = find(s0, 'Test Spring', 'battlefield', 'p1');
    const scry = legal(s0, 'p1', 'activate').find((a) => a.object === spring && /mill/i.test(a.label));
    expect(scry, legal(s0, 'p1', 'activate').map((a) => a.label).join(' | ')).toBeDefined();
    const { s } = settle(act(s0, scry!.action), { answers: [yes] });
    const done = s.zones.stack.length > 0 ? settle(pass(pass(s)), { answers: [yes] }).s : s;
    const fin = done.zones.stack.length > 0 ? settle(pass(pass(done))).s : done;
    expect(battlefieldNames(fin, 'p1')).not.toContain('Test Spring');
    expect(handSize(fin)).toBe(2);
  });
});

describe('CR 118.12, 119.4, 608.2h: "you may pay life equal to its power. If you do, put that many +1/+1 counters on it."', () => {
  const NULL = card('Test Broker', 'Creature — Demon', 'Whenever another creature you control enters, you may pay life equal to its power. If you do, put that many +1/+1 counters on it.', ['2', '2']);
  it('is automated', () => expect(automated(NULL)).toBe(true));
  it('pays 3 life for the 3/3 that entered and puts three +1/+1 counters on it (the broker itself is not "another creature")', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Broker'] }, defs: [NULL, BEAR] });
    const { s } = castAndResolve(s0, 'Test Bear', { answers: [yes] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(life(s, 'p1')).toBe(17);
    expect(s.objects[bear]!.counters['+1/+1']).toBe(3);
    expect(power(s, bear)).toBe(6);
  });
  it('declined: no life is paid and there are no counters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Broker'] }, defs: [NULL, BEAR] });
    const { s } = castAndResolve(s0, 'Test Bear', { answers: [no] });
    expect(life(s, 'p1')).toBe(20);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('CR 119.4: a player with less life than its power cannot pay: no question, no counters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Bear'], battlefield: ['Test Broker'] }, defs: [NULL, BEAR], life: 2 });
    const { s } = castAndResolve(s0, 'Test Bear', { answers: [yes] });
    expect(life(s, 'p1')).toBe(2);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('CR 122.1, 608.2d, 118.3: "you may remove a +1/+1 counter from each of two creatures you control. If you do, draw a card and create a 2/2 colorless Robot artifact creature token."', () => {
  const DYAD = card('Test Amalgam', 'Artifact Creature — Construct', 'When Test Amalgam enters, you may remove a +1/+1 counter from each of two creatures you control. If you do, draw a card and create a 2/2 colorless Robot artifact creature token.', ['1', '1']);
  it('is automated', () => expect(automated(DYAD)).toBe(true));
  it('removes one counter from each of two chosen creatures, then draws and creates the Robot', () => {
    const s0 = scenario([], {
      p1: { hand: ['Test Amalgam'], battlefield: [{ name: 'Test Elf', counters: { '+1/+1': 2 } }, { name: 'Test Bear', counters: { '+1/+1': 1 } }] }, defs: [DYAD, ELF, BEAR],
    });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const { s } = castAndResolve(s0, 'Test Amalgam', { answers: [yes], picks: [[elf, bear]] });
    expect(s.objects[elf]!.counters['+1/+1'] ?? 0).toBe(1);
    expect(s.objects[bear]!.counters['+1/+1'] ?? 0).toBe(0);
    expect(handSize(s)).toBe(1);
    expect(tokens(s, 'Robot')).toBe(1);
  });
  it('CR 118.3: with a counter on only one creature, "each of two" can not be done: no question, no draw, no token', () => {
    const s0 = scenario([], { p1: { hand: ['Test Amalgam'], battlefield: [{ name: 'Test Elf', counters: { '+1/+1': 2 } }, 'Test Bear'] }, defs: [DYAD, ELF, BEAR] });
    const { s, asked } = castAndResolve(s0, 'Test Amalgam', { answers: [yes] });
    const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
    expect(s.objects[elf]!.counters['+1/+1']).toBe(2);
    expect(handSize(s)).toBe(0);
    expect(tokens(s, 'Robot')).toBe(0);
    expect(asked).not.toContain('yesNo');
  });
  it('declined: nothing is removed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Amalgam'], battlefield: [{ name: 'Test Elf', counters: { '+1/+1': 1 } }, { name: 'Test Bear', counters: { '+1/+1': 1 } }] }, defs: [DYAD, ELF, BEAR] });
    const { s } = castAndResolve(s0, 'Test Amalgam', { answers: [no] });
    expect(s.objects[find(s0, 'Test Elf', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(1);
    expect(handSize(s)).toBe(0);
  });
});

describe('CR 118.12: "You may discard a card or sacrifice a land. If you do, draw two cards."', () => {
  const ROBBERY = card('Test Robbery', 'Sorcery', 'You may discard a card or sacrifice a land. If you do, draw two cards.');
  it('is automated', () => expect(automated(ROBBERY)).toBe(true));
  it('discarding a card pays it, and "if you do" draws two', () => {
    const s0 = scenario([], { p1: { hand: ['Test Robbery', 'Test Rock'], battlefield: ['Test Isle'] }, defs: [ROBBERY, ROCK, ISLE] });
    const { s } = settle(pass(pass(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Robbery', 'hand', 'p1') })).s)), { answers: [yes] });
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Rock');
    expect(battlefieldNames(s, 'p1')).toContain('Test Isle');
    expect(handSize(s)).toBe(2);
  });
  it('with no card to discard, sacrificing a land pays it instead', () => {
    const s0 = scenario([], { p1: { hand: ['Test Robbery'], battlefield: ['Test Isle'] }, defs: [ROBBERY, ISLE] });
    const { s } = settle(pass(pass(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Robbery', 'hand', 'p1') })).s)), { answers: [yes, yes] });
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Isle');
    expect(handSize(s)).toBe(2);
  });
  it('declining both: nothing is paid and nothing is drawn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Robbery', 'Test Rock'], battlefield: ['Test Isle'] }, defs: [ROBBERY, ROCK, ISLE] });
    const { s } = settle(pass(pass(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Robbery', 'hand', 'p1') })).s)), { answers: [no, no] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Isle');
    expect(handSize(s)).toBe(1);
  });
});

describe('CR 608.2c: "If you do, draw a card and ~ can\'t be blocked this turn / gets +2/+0 until end of turn" (both instructions are under the condition)', () => {
  const GOURMAND = card('Test Gourmand', 'Creature — Vampire', "When Test Gourmand enters, you may sacrifice another creature. If you do, draw a card and ~ can't be blocked this turn.", ['2', '2']);
  const DETECTIVE = card('Test Detective', 'Creature — Devil', 'When Test Detective enters, you may sacrifice an artifact or discard a card. If you do, draw a card and ~ gets +2/+0 until end of turn.', ['2', '2']);
  const BAGGINS = card('Test Baggins', 'Creature — Halfling', 'When Test Baggins enters, you may sacrifice another creature or artifact. If you do, draw a card and create a Treasure token.', ['1', '1']);
  it('are automated', () => {
    expect(automated(GOURMAND)).toBe(true);
    expect(automated(DETECTIVE)).toBe(true);
    expect(automated(BAGGINS)).toBe(true);
  });
  it('can\'t be blocked: draws and the restriction is on; declined: neither', () => {
    const s0 = scenario([], { p1: { hand: ['Test Gourmand'], battlefield: ['Test Elf'] }, defs: [GOURMAND, ELF] });
    const { s } = castAndResolve(s0, 'Test Gourmand', { answers: [yes] });
    expect(handSize(s)).toBe(1);
    expect(ruleDenial(s, { action: 'beBlocked', subject: find(s, 'Test Gourmand', 'battlefield', 'p1') })).not.toBeNull();
    const d = castAndResolve(scenario([], { p1: { hand: ['Test Gourmand'], battlefield: ['Test Elf'] }, defs: [GOURMAND, ELF] }), 'Test Gourmand', { answers: [no] });
    expect(handSize(d.s)).toBe(0);
    expect(ruleDenial(d.s, { action: 'beBlocked', subject: find(d.s, 'Test Gourmand', 'battlefield', 'p1') })).toBeNull();
  });
  it('gets +2/+0: discarding a card pays it; the 2/2 is a 4/2 until end of turn, and draws', () => {
    const s0 = scenario([], { p1: { hand: ['Test Detective', 'Test Rock'] }, defs: [DETECTIVE, ROCK] });
    const { s } = castAndResolve(s0, 'Test Detective', { answers: [yes] });
    const det = find(s, 'Test Detective', 'battlefield', 'p1');
    expect(power(s, det)).toBe(4);
    expect(toughness(s, det)).toBe(2);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Rock');
    expect(handSize(s)).toBe(1);
  });
  it('token: sacrificing a creature draws a card and creates a Treasure', () => {
    const s0 = scenario([], { p1: { hand: ['Test Baggins'], battlefield: ['Test Elf'] }, defs: [BAGGINS, ELF] });
    const { s } = castAndResolve(s0, 'Test Baggins', { answers: [yes] });
    expect(tokens(s, 'Treasure')).toBe(1);
    expect(handSize(s)).toBe(1);
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Elf');
  });
});

describe('CR 608.2c, 608.2d: "If you control a Raccoon, you may discard a card. If you do, draw a card."', () => {
  const TRASH = card('Test Trash', 'Instant', 'Test Trash deals 3 damage to target creature. If you control a Raccoon, you may discard a card. If you do, draw a card.');
  const RACCOON = card('Test Raccoon', 'Creature — Raccoon', '', ['1', '1']);
  const cast = (s0: GameState, answers: DecisionAnswer[]): GameState => {
    const target = find(s0, 'Test Bear', 'battlefield', 'p2');
    const r = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Trash', 'hand', 'p1') }), { targets: [[obj(target)]] });
    return settle(pass(pass(r.s)), { answers }).s;
  };
  it('is automated', () => expect(automated(TRASH)).toBe(true));
  it('with a Raccoon: discarding a card draws one (the damage is dealt either way)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Trash', 'Test Rock'], battlefield: ['Test Raccoon'] }, p2: { battlefield: ['Test Bear'] }, defs: [TRASH, ROCK, RACCOON, BEAR] });
    const s = cast(s0, [yes]);
    expect(zoneNames(s, 'graveyard', 'p1')).toContain('Test Rock');
    expect(handSize(s)).toBe(1);
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Bear');
  });
  it('with a Raccoon, declined: no discard, no draw', () => {
    const s0 = scenario([], { p1: { hand: ['Test Trash', 'Test Rock'], battlefield: ['Test Raccoon'] }, p2: { battlefield: ['Test Bear'] }, defs: [TRASH, ROCK, RACCOON, BEAR] });
    const s = cast(s0, [no]);
    expect(handSize(s)).toBe(1);
    expect(zoneNames(s, 'graveyard', 'p1')).not.toContain('Test Rock');
  });
  it('without a Raccoon: nothing is offered, nothing is discarded, nothing is drawn (the "if you do" is not true)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Trash', 'Test Rock'] }, p2: { battlefield: ['Test Bear'] }, defs: [TRASH, ROCK, BEAR] });
    const s = cast(s0, [yes]);
    expect(handSize(s)).toBe(1);
    expect(zoneNames(s, 'graveyard', 'p1')).not.toContain('Test Rock');
    expect(zoneNames(s, 'graveyard', 'p2')).toContain('Test Bear');
  });
});

describe('CR 701.26a, 608.2c: "tap any number of untapped creatures you control. ~ gets +1/+1 until end of turn for each creature tapped this way."', () => {
  const ORPHANS = card('Test Orphans', 'Creature — Human', 'When Test Orphans enters, tap any number of untapped creatures you control. Test Orphans gets +1/+1 until end of turn for each creature tapped this way.', ['1', '1']);
  it('is automated', () => expect(automated(ORPHANS)).toBe(true));
  it('tapping two of three other untapped creatures (one is already tapped) makes it a 3/3', () => {
    const s0 = scenario([], { p1: { hand: ['Test Orphans'], battlefield: ['Test Elf', 'Test Bear', { name: 'Test Elf', tapped: true }] }, defs: [ORPHANS, ELF, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const free = findAll(s0, 'Test Elf', 'battlefield', 'p1').find((id) => !tapped(s0, id))!;
    const { s } = castAndResolve(s0, 'Test Orphans', { picks: [[free, bear]] });
    const o = find(s, 'Test Orphans', 'battlefield', 'p1');
    expect(tapped(s, free) && tapped(s, bear)).toBe(true);
    expect([power(s, o), toughness(s, o)]).toEqual([3, 3]);
  });
  it('tapping none gives no bonus; the bonus ends with the turn', () => {
    const s0 = scenario([], { p1: { hand: ['Test Orphans'], battlefield: ['Test Elf'] }, defs: [ORPHANS, ELF] });
    const { s } = castAndResolve(s0, 'Test Orphans', { picks: [[]] });
    const o = find(s, 'Test Orphans', 'battlefield', 'p1');
    expect([power(s, o), toughness(s, o)]).toEqual([1, 1]);
    const t0 = scenario([], { p1: { hand: ['Test Orphans'], battlefield: ['Test Elf'] }, defs: [ORPHANS, ELF] });
    const r = castAndResolve(t0, 'Test Orphans', { picks: [[find(t0, 'Test Elf', 'battlefield', 'p1')]] });
    const later = advanceTo(r.s, r.s.turn.number + 1, 'upkeep');
    expect(power(later, find(later, 'Test Orphans', 'battlefield', 'p1'))).toBe(1);
  });
});

describe('CR 608.2h, 701.21a: "you may sacrifice another creature. If you do, put a number of +1/+1 counters on ~ equal to the sacrificed creature\'s power."', () => {
  const RAMPAGER = card('Test Rampager', 'Creature — Wolf', 'When Test Rampager enters, you may sacrifice another creature. If you do, put a number of +1/+1 counters on Test Rampager equal to the sacrificed creature\'s power.', ['2', '2']);
  it('is automated', () => expect(automated(RAMPAGER)).toBe(true));
  it('sacrificing the 3/3 puts three +1/+1 counters on it (last known power)', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rampager'], battlefield: ['Test Bear'] }, defs: [RAMPAGER, BEAR] });
    const { s } = castAndResolve(s0, 'Test Rampager', { answers: [yes] });
    expect(battlefieldNames(s, 'p1')).not.toContain('Test Bear');
    expect(s.objects[find(s, 'Test Rampager', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(3);
  });
  it('the power read is the creature\'s with its counters and effects: a 2/2 with two +1/+1 counters gives four', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rampager'], battlefield: [{ name: 'Test Elf', counters: { '+1/+1': 2 } }] }, defs: [RAMPAGER, ELF] });
    const { s } = castAndResolve(s0, 'Test Rampager', { answers: [yes] });
    expect(s.objects[find(s, 'Test Rampager', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(4);
  });
  it('declined: nothing is sacrificed and no counters', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rampager'], battlefield: ['Test Bear'] }, defs: [RAMPAGER, BEAR] });
    const { s } = castAndResolve(s0, 'Test Rampager', { answers: [no] });
    expect(battlefieldNames(s, 'p1')).toContain('Test Bear');
    expect(s.objects[find(s, 'Test Rampager', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('never silently wrong: "the sacrificed creature" with no sacrifice before it is not automated', () => {
    const d = card('Test Nothing', 'Instant', 'Put a number of +1/+1 counters on target creature equal to the sacrificed creature\'s power.');
    expect(automated(d)).toBe(false);
  });
  it('a reflexive trigger that waits for the payment reads it too (std-rw8: fixed from last known information as the trigger is created, CR 603.12, 608.2h; played in std-rw8-scenarios.test.ts)', () => {
    const d = card('Test Reflex', 'Creature — Goblin', 'When Test Reflex enters, you may sacrifice another creature. When you do, Test Reflex deals damage equal to the sacrificed creature\'s power to target creature.', ['1', '1']);
    expect(automated(d)).toBe(true);
  });
});

describe('CR 608.2c, 608.2h, 118.12: "you may sacrifice a permanent other than that creature or this Equipment. If you do, draw a card."', () => {
  const SAW = card('Test Saw', 'Artifact — Equipment', 'Whenever equipped creature attacks, you may sacrifice a permanent other than that creature or this Equipment. If you do, draw a card.\nEquip {0}');
  it('is automated', () => expect(automated(SAW)).toBe(true));
  it('the equipped creature and the Equipment are not offered: with only those, nothing can be sacrificed; with another permanent it is sacrificed and a card is drawn', () => {
    for (const other of [false, true]) {
      const s0 = scenario([], { p1: { battlefield: ['Test Elf', 'Test Saw', ...(other ? ['Test Rock'] : [])] }, defs: [SAW, ELF, ROCK] });
      const elf = find(s0, 'Test Elf', 'battlefield', 'p1');
      const saw = find(s0, 'Test Saw', 'battlefield', 'p1');
      s0.objects[saw]!.attachedTo = elf;
      let s = s0;
      for (let g = 0; g < 40 && s.pending?.kind !== 'declareAttackers'; g++) s = pass(s);
      if (s.pending?.kind !== 'declareAttackers') throw new Error(`no attack declaration reached: ${s.turn.step} ${s.pending?.kind}`);
      s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: elf, defender: 'p2' }] });
      s = settle(s, { answers: [yes] }).s;
      s = settle(pass(pass(s)), { answers: [yes] }).s;
      if (other) {
        expect(battlefieldNames(s, 'p1')).not.toContain('Test Rock');
        expect(handSize(s)).toBe(1);
      } else {
        expect(battlefieldNames(s, 'p1')).toEqual(expect.arrayContaining(['Test Elf', 'Test Saw']));
        expect(handSize(s)).toBe(0);
      }
    }
  });
});
