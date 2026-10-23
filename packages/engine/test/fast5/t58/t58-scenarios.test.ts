/**
 * FAST5 T58: short names that are also subtypes, and what finishes the same cards. Fixture cards on the game path (fast5-t58-cards.txt) and synthetic cards
 * compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 201.5c, 205.3j   a legendary card without a comma in its name is known by the planeswalker type that starts it ("Kiora of Fire and Ashes" -> "Kiora",
 *                       "Gideon the Oathless" -> "Gideon"); a creature type does not start a short name that way ("Sliver Queen"); type positions stay types
 *   CR 601.2i, 603.4    "Whenever Rhino attacks, if you've cast a spell with mana value 4 or greater this turn, draw a card." (render gate: "a spell" = one or more)
 *   CR 105.1, 105.2     "When Karn enters, draw a card for each color among other artifacts you control." (zz-fast5/t58.json)
 *   CR 608.2c, 122.1,   "When Teyo enters, target permanent you control gains hexproof until end of turn. Put a +1/+1 counter on it if it's a creature. Put a
 *   306.5b, 115.1       loyalty counter on it if it's a planeswalker." ("it" after a target of the object's own enters trigger is the target, design 6.4)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { compiledDef } from '../../fixtures';
import { declareAttackers, lifeOf, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const json = (d: CardDef): string => JSON.stringify(d.faces);
const noManual = (d: CardDef): boolean => !json(d).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const lands = (name: string, n: number): string[] => Array(n).fill(name) as string[];
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;

/** Answer the decisions that come up (payments automatic, `targets` in order when asked, yes); stop at priority. */
function drive(s0: GameState, targets: TargetChoice[][] = []): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else break;
  }
  return s;
}
const cast = (s: GameState, name: string, player = 'p1', targets: TargetChoice[][] = []): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), targets);
function resolveAll(s0: GameState, targets: TargetChoice[][] = []): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(pass(s), targets);
  return s;
}

describe('CR 201.5c, 205.3j: a legendary card is known by the planeswalker type that starts its name', () => {
  it('Kiora of Fire and Ashes: "When Kiora enters, create a 5/5 red Dragon creature token with flying." is the card itself', () => {
    const d = compiledDef('Kiora of Fire and Ashes');
    expect(d.automation.level).toBe('full');
    expect(json(d)).toContain('"subject":{"self":true}');
  });

  it('Kiora of Fire and Ashes, cast: one 5/5 red flying Dragon token', () => {
    let s = scenario(['Kiora of Fire and Ashes', 'Mountain'], { p1: { hand: ['Kiora of Fire and Ashes'], battlefield: lands('Mountain', 6) } });
    s = resolveAll(cast(s, 'Kiora of Fire and Ashes'));
    const dragons = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(dragons.length).toBe(1);
    const c = getChars(s, dragons[0]!)!;
    expect([c.power, c.toughness, c.colors, c.subtypes]).toEqual(['5', '5', ['R'], ['Dragon']]);
  });

  it('Gideon the Oathless: both damage triggers are the card itself dealing damage to the event\'s player (CR 603.2, 120.3)', () => {
    const d = compiledDef('Gideon the Oathless');
    expect(d.automation.level).toBe('full');
    const steps = d.faces[0]!.abilities.filter((a) => a.kind === 'triggered').map((a) => JSON.stringify((a as { effect: unknown }).effect));
    expect(steps).toHaveLength(2);
    for (const e of steps) expect(e).toContain('"op":"damage","source":{"ref":"self"},"to":{"ref":"event","role":"player"},"amount":1');
  });

  it('Gideon the Oathless: a creature an opponent casts with flash enters, and Gideon deals 1 damage to that player', () => {
    let s = scenario(['Gideon the Oathless', 'Teyo, Lightshield Expert', 'Plains'], { p1: { battlefield: ['Gideon the Oathless'] }, p2: { hand: ['Teyo, Lightshield Expert'], battlefield: lands('Plains', 2) } });
    s = pass(s); // p2 gets priority in p1's main phase
    s = cast(s, 'Teyo, Lightshield Expert', 'p2');
    const teyo = (): ObjectId => find(s, 'Teyo, Lightshield Expert', 'battlefield', 'p2');
    for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) {
      s = pass(s);
      if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(teyo())] });
      s = drive(s);
    }
    expect(lifeOf(s, 'p2')).toBe(19);
    expect(lifeOf(s, 'p1')).toBe(20);
  });

  it('a legendary creature named after a planeswalker type reads it as itself; a nonlegendary one does not (CR 201.5c)', () => {
    const legendary = card('Ajani of the Test Grove', 'Legendary Creature — Cat Warrior', 'When Ajani enters, you gain 3 life.', ['2', '2']);
    expect(legendary.automation.level).toBe('full');
    const plain = card('Ajani of the Test Grove', 'Creature — Cat Warrior', 'When Ajani enters, you gain 3 life.', ['2', '2']);
    expect(plain.automation.level).not.toBe('full');
  });

  it('CR 205.3m: a creature type at the start of a name without a comma is the type, not a short name ("Sliver" of a legendary "Sliver ...")', () => {
    const d = card('Sliver Test Overseer', 'Legendary Creature — Sliver', 'When Sliver enters, you gain 3 life.', ['3', '3']);
    expect(noManual(d)).toBe(false);
  });

  it('CR 205.3j: the planeswalker type in a type position stays a type ("Ajani planeswalker")', () => {
    const d = card('Ajani of the Test Grove', 'Legendary Creature — Cat Warrior', 'Whenever you cast an Ajani planeswalker spell, you gain 1 life.', ['2', '2']);
    expect(json(d)).not.toContain('"self":true');
  });
});

describe('CR 601.2i, 603.4: "Whenever Rhino attacks, if you\'ve cast a spell with mana value 4 or greater this turn, draw a card."', () => {
  const start = (spell: string, n: number): GameState =>
    scenario(['Rhino, Barreling Brute', spell, 'Plains'], { p1: { hand: [spell], battlefield: ['Rhino, Barreling Brute', ...lands('Plains', n)] } });
  const attack = (s0: GameState): GameState => {
    let s = toDeclareAttackers(s0);
    s = declareAttackers(s, [[find(s, 'Rhino, Barreling Brute', 'battlefield', 'p1')]]);
    return resolveAll(drive(s));
  };

  it('is full', () => {
    expect(compiledDef('Rhino, Barreling Brute').automation.level).toBe('full');
  });

  it('after a mana value 5 spell this turn, the attack draws a card', () => {
    let s = resolveAll(cast(start('Serra Angel', 5), 'Serra Angel'));
    const hand = handSize(s, 'p1');
    s = attack(s);
    expect(handSize(s, 'p1')).toBe(hand + 1);
  });

  it('after only a mana value 0 spell, the attack draws nothing (the intervening if is false, CR 603.4)', () => {
    let s = resolveAll(cast(start('Ornithopter', 0), 'Ornithopter'));
    const hand = handSize(s, 'p1');
    s = attack(s);
    expect(handSize(s, 'p1')).toBe(hand);
  });
});

describe('CR 105.1, 105.2: "When Karn enters, draw a card for each color among other artifacts you control."', () => {
  it('is understood (the template is experimental until promoted; nothing is manual)', () => {
    const d = compiledDef('Karn, Gilded Guardian');
    expect(noManual(d)).toBe(true);
    expect(json(d)).toContain('"count":{"q":"distinct","what":"colors","among":{"ref":"each","filter":{"other":true,"types":["Artifact"],"controller":"you"}}}');
  });

  it('three colors among the other artifacts (blue, red, white, colorless): three cards; Karn\'s own five colors do not count', () => {
    let s = scenario(['Karn, Gilded Guardian', 'Cryptic Coat', 'Gastal Thrillroller', 'Porcelain Legionnaire', 'Ornithopter', 'Phoenix Down', 'Plains'], {
      p1: { hand: ['Karn, Gilded Guardian'], battlefield: ['Cryptic Coat', 'Gastal Thrillroller', 'Porcelain Legionnaire', 'Ornithopter', ...lands('Plains', 10)] },
      p2: { battlefield: ['Phoenix Down'] }, // an opponent's white artifact is not one you control
    });
    const hand = handSize(s, 'p1') - 1;
    s = resolveAll(cast(s, 'Karn, Gilded Guardian'));
    expect(handSize(s, 'p1')).toBe(hand + 3);
  });

  it('no other artifacts: no card', () => {
    let s = scenario(['Karn, Gilded Guardian', 'Plains'], { p1: { hand: ['Karn, Gilded Guardian'], battlefield: lands('Plains', 10) } });
    const hand = handSize(s, 'p1') - 1;
    s = resolveAll(cast(s, 'Karn, Gilded Guardian'));
    expect(handSize(s, 'p1')).toBe(hand);
  });
});

describe('CR 608.2c, 122.1, 306.5b: "Put a +1/+1 counter on it if it\'s a creature. Put a loyalty counter on it if it\'s a planeswalker." (Teyo)', () => {
  it('both Teyos are full; every "it" is the target (design 6.4: the object itself is "Teyo", CR 201.5)', () => {
    for (const name of ['Teyo, Lightshield Expert', 'Teyo, Diamondblade Mage']) {
      const d = compiledDef(name);
      expect(d.automation.level).toBe('full');
      const e = json(d);
      expect(e).not.toContain('"ref":"self"');
      expect(e.match(/"ref":"target","id":"t0"/g)!.length).toBe(5);
    }
  });

  it('a creature target gets hexproof and a +1/+1 counter, no loyalty counter', () => {
    let s = scenario(['Teyo, Lightshield Expert', 'Grizzly Bears', 'Plains'], { p1: { hand: ['Teyo, Lightshield Expert'], battlefield: ['Grizzly Bears', ...lands('Plains', 2)] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Teyo, Lightshield Expert'), [[obj(bears)]]);
    expect(s.objects[bears]!.counters['+1/+1'] ?? 0).toBe(1);
    expect(s.objects[bears]!.counters['loyalty'] ?? 0).toBe(0);
    expect(String(getChars(s, bears)!.power)).toBe('3');
    const teyo = find(s, 'Teyo, Lightshield Expert', 'battlefield', 'p1');
    expect(s.objects[teyo]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('a planeswalker target gets a loyalty counter, no +1/+1 counter', () => {
    let s = scenario(['Teyo, Diamondblade Mage', 'Jace Beleren', 'Swamp'], {
      p1: { hand: ['Teyo, Diamondblade Mage'], battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 3 } }, ...lands('Swamp', 4)] },
    });
    const jace = find(s, 'Jace Beleren', 'battlefield', 'p1');
    s = resolveAll(cast(s, 'Teyo, Diamondblade Mage'), [[obj(jace)]]);
    expect(s.objects[jace]!.counters['loyalty']).toBe(4);
    expect(s.objects[jace]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('design 6.4: without a target, "it" in the object\'s own enters trigger is still the object itself', () => {
    const d = card('Test Grower', 'Creature — Elf', 'When this creature enters, target player draws a card. Put a +1/+1 counter on it.', ['1', '1']);
    expect(noManual(d)).toBe(true);
    expect(json(d)).toContain('"op":"putCounters","on":{"ref":"self"}');
  });

  it('design 6.4: after a creature target of the enters trigger, "it" is the target', () => {
    const d = card('Test Jailer', 'Creature — Human', 'When this creature enters, tap target creature an opponent controls. Put a stun counter on it.', ['2', '2']);
    expect(noManual(d)).toBe(true);
    expect(json(d)).toContain('"op":"putCounters","on":{"ref":"target","id":"t0"},"kind":"stun"');
  });
});
