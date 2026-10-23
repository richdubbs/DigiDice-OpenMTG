/**
 * Standard round 4, slice r4-mech (set mechanics and words the lexicon lacks, both halves): the mechanisms of parser/templates/zz-cloud/r4-mech.json and the
 * engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10).
 * Each test is named after the rule it checks.
 *
 *   CR 705.1-705.2, 614.1a  "The first time you flip one or more coins each turn, those coins come up heads and you win those flips."; "Flip three coins."
 *   CR 608.2c               "Then if C, repeat this process once."
 *   CR 514.2                "Damage isn't removed from this creature during cleanup steps."
 *   CR 704.5i               "Planeswalkers you control aren't put into their owners' graveyards for having 0 loyalty."
 *   CR 606.3                "Until end of turn, you may activate loyalty abilities of ... on any player's turn any time you could cast an instant."
 *   CR 500.8, 505.1a        "After this main phase, there is an additional combat phase followed by an additional main phase."
 *   CR 701.47a              "Its controller amasses Orcs 2."
 *   CR 701.57c, 608.2h      "If the discovered card's mana value is less than N, create a number of ... equal to the difference."
 *   CR 111.4                a token's given name with "of the"; CR 207.2d an exclaimed flavor word; CR 122.1 "for each <kind> counter on ~"
 *   CR 108.3, 109.4, 205.1b "Creatures you control but don't own are Pirates in addition to their other types."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, cast, drive, find, lands, next, onField, pass, put, resolveTop, scenario, until } from '../../m6/dfc/support';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string; loyalty?: string; colors?: string[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: o.colors ?? [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}), ...(o.loyalty ? { loyalty: o.loyalty } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const full = (d: CardDef): boolean => d.automation.level === 'full' && noManual(d);
const nameOf = (s: GameState, id: string): string => s.defs[s.objects[id]!.defId]!.name;
const handNames = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => s.zones.hand[p]!.map((id) => nameOf(s, id));
const onBattlefield = (s: GameState, name: string): string[] => s.zones.battlefield.filter((id) => nameOf(s, id) === name || s.defs[s.objects[id]!.defId]!.faces[0]!.name === name);
/** Answer the decisions of a resolution: yes to every "may", the first options of every choice, automatic payments. */
function auto(s0: GameState, max = 40): GameState {
  let s = s0;
  for (let i = 0; i < max && s.pending && s.pending.kind !== 'priority'; i++) {
    const p = s.pending as unknown as { kind: string; options?: unknown[]; min?: number; items?: { id: string }[] };
    let a: DecisionAnswer;
    if (p.kind === 'yesNo') a = { kind: 'yesNo', yes: true };
    else if (p.kind === 'chooseObjects') a = { kind: 'chooseObjects', ids: (p.options as string[]).slice(0, Math.max(1, p.min ?? 1)) };
    else if (p.kind === 'chooseOption') a = { kind: 'chooseOption', ids: [(p.options as { id: string }[])[0]!.id] };
    else if (p.kind === 'payCost') a = { kind: 'payCost', auto: true };
    else if (p.kind === 'order') a = { kind: 'order', ids: p.items!.map((x) => x.id) };
    else throw new Error(`auto: ${p.kind}`);
    s = answer(s, a);
  }
  return s;
}
const activateOf = (s: GameState, id: string, label?: RegExp) => legalActions(s, s.pending!.player).find((a) => a.kind === 'activate' && a.object === id && (!label || label.test(a.label)));

// ---- CR 705: coin flips -------------------------------------------------------------------------------------------------------------------------------------

describe('CR 705.1-705.2, 614.1a: "The first time you flip one or more coins each turn, those coins come up heads and you win those flips."', () => {
  const PENNY = card('Test Two-Faced Penny', 'Artifact', 'The first time you flip one or more coins each turn, those coins come up heads and you win those flips.');
  const COIN = card('Test Lucky Coin', 'Artifact', '{T}: Flip a coin. If you win the flip, draw a card. If you lose the flip, you lose 1 life.');
  it('is automated as a rule modification of its controller', () => {
    expect(full(PENNY)).toBe(true);
    expect(JSON.stringify(PENNY.faces[0]!.abilities[0])).toContain('"rule":"firstCoinFlipsWon"');
  });
  it('the first flip of the turn is won with no call (heads); a later flip that turn is called as usual (CR 705.2)', () => {
    const s0 = scenario([], { defs: [PENNY, COIN], p1: { battlefield: ['Test Two-Faced Penny', 'Test Lucky Coin', 'Test Lucky Coin'] } });
    const [c1, c2] = onBattlefield(s0, 'Test Lucky Coin');
    let s = resolveTop(drive(act(s0, activateOf(s0, c1!)!.action)));
    expect(s.pending?.kind).toBe('priority'); // no call was asked
    expect(s.zones.hand['p1']!.length).toBe(s0.zones.hand['p1']!.length + 1);
    expect(s.log.some((l) => /flips a coin: heads, and wins the flip/.test(l.text))).toBe(true);
    s = resolveTop(drive(act(s, activateOf(s, c2!)!.action)));
    expect(s.pending?.kind).toBe('chooseOption'); // the second instruction this turn: the flip is called again
  });
  it('without it the first flip is called (the rule modification is the only thing that changed)', () => {
    const s0 = scenario([], { defs: [COIN], p1: { battlefield: ['Test Lucky Coin'] } });
    const s = resolveTop(drive(act(s0, activateOf(s0, onBattlefield(s0, 'Test Lucky Coin')[0]!)!.action)));
    expect(s.pending?.kind).toBe('chooseOption');
  });
});

describe('CR 705.1: "Flip three coins." flips that many coins, one at a time', () => {
  const TOSS = card('Test Triple Toss', 'Sorcery', 'Flip three coins.');
  it('is automated and flips three coins', () => {
    expect(noManual(TOSS)).toBe(true); // experimental template (design 6.9 cap): automated, level partial until a real card is full
    const s0 = scenario([], { defs: [TOSS], p1: { hand: ['Test Triple Toss'] } });
    const s = resolveTop(cast(s0, 'Test Triple Toss'));
    expect(s.log.filter((l) => /flips a coin/.test(l.text)).length).toBe(3);
  });
  it('fail closed: "Flip X coins" is not read', () => {
    expect(full(card('Test Many Toss', 'Sorcery', 'Flip X coins.', { cost: '{X}' }))).toBe(false);
  });
});

// ---- CR 608.2c: repeat this process -------------------------------------------------------------------------------------------------------------------------

describe('CR 608.2c: "Then if C, repeat this process once." runs the instructions before it again', () => {
  const RABBIT = card('Test Prospector Hare', 'Creature — Rabbit', 'When this creature enters, if an opponent controls more lands than you, you may search your library for a Plains card and put it onto the battlefield tapped. Then if an opponent controls more lands than you, repeat this process once. If you search your library this way, shuffle.', { pt: ['2', '2'] });
  it('is automated: the repeat holds a copy of the earlier instructions', () => {
    expect(full(RABBIT)).toBe(true);
    const steps = (RABBIT.faces[0]!.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[] } }).effect.steps;
    const rep = (steps[1]!['then'] as Record<string, unknown>[])[0]!;
    expect(rep['op']).toBe('repeat');
    expect(rep['process']).toBe(true);
    expect(JSON.stringify(rep['do'])).toBe(JSON.stringify([steps[0]]));
  });
  const board = (theirLands: number): GameState => scenario(['Plains'], { defs: [RABBIT], p1: { hand: ['Test Prospector Hare'] }, p2: { battlefield: lands('Plains', theirLands) } });
  const play = (s0: GameState): GameState => auto(resolveTop(auto(resolveTop(cast(s0, 'Test Prospector Hare')))));
  it('two searches while the opponent still controls more lands; one when the first search evens them', () => {
    expect(onBattlefield(play(board(3)), 'Plains').filter((id) => play(board(3)).objects[id]!.controller === 'p1').length).toBe(2);
    const s = play(board(1));
    expect(s.zones.battlefield.filter((id) => nameOf(s, id) === 'Plains' && s.objects[id]!.controller === 'p1').length).toBe(1);
  });
  it('fail closed: "repeat this process" with nothing understood before it stays manual', () => {
    expect(full(card('Test Echo', 'Sorcery', 'Repeat this process once.'))).toBe(false);
  });
});

// ---- CR 514.2: damage kept in cleanup -----------------------------------------------------------------------------------------------------------------------

describe('CR 514.2: "Damage isn\'t removed from this creature during cleanup steps."', () => {
  const SHELL = card('Test Stone Tortoise', 'Creature — Turtle', "Damage isn't removed from this creature during cleanup steps.", { pt: ['1', '6'] });
  const PLAIN = card('Test Soft Tortoise', 'Creature — Turtle', '', { pt: ['1', '6'] });
  it('the damage stays through the cleanup step; another creature\'s damage is removed', () => {
    expect(noManual(SHELL)).toBe(true); // experimental template (design 6.9 cap)
    const s0 = scenario([], { defs: [SHELL, PLAIN], p1: { battlefield: ['Test Stone Tortoise', 'Test Soft Tortoise'] } });
    const kept = onField(s0, 'Test Stone Tortoise');
    const other = onField(s0, 'Test Soft Tortoise');
    s0.objects[kept]!.damage = 2;
    s0.objects[other]!.damage = 2;
    const s = until(s0, (t) => t.turn.activePlayer === 'p2' && t.turn.step === 'upkeep');
    expect(s.objects[kept]!.damage).toBe(2);
    expect(s.objects[other]!.damage).toBe(0);
    expect(s.log.some((l) => /Damage isn't removed from Test Stone Tortoise/.test(l.text) && (l.rules ?? []).includes('CR 514.2'))).toBe(true);
  });
  it('a group form ("from creatures during cleanup steps") reads too (experimental template)', () => {
    const d = card('Test Long Memory', 'Enchantment', "Damage isn't removed from creatures during cleanup steps.");
    expect(JSON.stringify(d.faces[0]!.abilities[0])).toContain('"rule":"damageNotRemovedInCleanup"');
  });
});

// ---- CR 704.5i: 0 loyalty -----------------------------------------------------------------------------------------------------------------------------------

describe('CR 704.5i: "Planeswalkers you control aren\'t put into their owners\' graveyards for having 0 loyalty."', () => {
  const WARDEN = card('Test Vault Warden', 'Creature — Horror', "Planeswalkers you control aren't put into their owners' graveyards for having 0 loyalty.", { pt: ['2', '2'] });
  const WALKER = card('Test Kaya Echo', 'Legendary Planeswalker — Kaya', '+1: You gain 1 life.', { loyalty: '3' });
  it('a planeswalker you control with 0 loyalty stays; without the static it is put into its owner\'s graveyard', () => {
    expect(full(WARDEN)).toBe(true);
    const with0 = scenario([], { defs: [WARDEN, WALKER], p1: { battlefield: ['Test Vault Warden', { name: 'Test Kaya Echo', counters: { loyalty: 0 } }] } });
    expect(onBattlefield(pass(with0), 'Test Kaya Echo').length).toBe(1);
    const alone = scenario([], { defs: [WALKER], p1: { battlefield: [{ name: 'Test Kaya Echo', counters: { loyalty: 0 } }] } });
    const after = pass(alone);
    expect(onBattlefield(after, 'Test Kaya Echo').length).toBe(0);
  });
  it('only planeswalkers its controller controls', () => {
    const s = scenario([], { defs: [WARDEN, WALKER], p1: { battlefield: ['Test Vault Warden'] }, p2: { battlefield: [{ name: 'Test Kaya Echo', counters: { loyalty: 0 } }] } });
    expect(onBattlefield(pass(s), 'Test Kaya Echo').length).toBe(0);
  });
});

// ---- CR 606.3: loyalty abilities at instant speed -----------------------------------------------------------------------------------------------------------

describe('CR 606.3: "Until end of turn, you may activate loyalty abilities of Kaya planeswalkers you control on any player\'s turn any time you could cast an instant."', () => {
  const RITE = card('Test Quick Oath', 'Instant', "Until end of turn, you may activate loyalty abilities of Kaya planeswalkers you control on any player's turn any time you could cast an instant.");
  const WALKER = card('Test Kaya Echo', 'Legendary Planeswalker — Kaya', '+1: You gain 1 life.', { loyalty: '3' });
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 1 damage to any target.');
  const loyaltyNow = (s: GameState): boolean => activateOf(s, onField(s, 'Test Kaya Echo')) !== undefined;
  it('with the effect, the loyalty ability can be activated while a spell is on the stack, once each turn still', () => {
    expect(full(RITE)).toBe(true);
    let s = scenario([], { defs: [RITE, WALKER, BOLT], p1: { hand: ['Test Quick Oath', 'Test Spark'], battlefield: [{ name: 'Test Kaya Echo', counters: { loyalty: 3 } }] } });
    s = resolveTop(cast(s, 'Test Quick Oath'));
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect(s.zones.stack.length).toBe(1);
    expect(loyaltyNow(s)).toBe(true);
    s = drive(act(s, activateOf(s, onField(s, 'Test Kaya Echo'))!.action));
    expect(s.zones.stack.length).toBe(2);
    expect(loyaltyNow(s)).toBe(false); // one loyalty ability of each permanent each turn (CR 606.3)
  });
  it('without it, not while the stack is not empty (CR 606.3: sorcery timing)', () => {
    let s = scenario([], { defs: [WALKER, BOLT], p1: { hand: ['Test Spark'], battlefield: [{ name: 'Test Kaya Echo', counters: { loyalty: 3 } }] } });
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect(s.zones.stack.length).toBe(1);
    expect(loyaltyNow(s)).toBe(false);
  });
});

// ---- CR 500.8: an additional combat phase followed by an additional main phase -------------------------------------------------------------------------------

describe('CR 500.8, 505.1a: "After this main phase, there is an additional combat phase followed by an additional main phase."', () => {
  const RUSH = card('Test Second Charge', 'Sorcery', 'After this main phase, there is an additional combat phase followed by an additional main phase.');
  it('main 1, the added combat phase, the added main phase, then the turn\'s own combat and main 2', () => {
    expect(full(RUSH)).toBe(true);
    let s = resolveTop(cast(scenario([], { defs: [RUSH], p1: { hand: ['Test Second Charge'] } }), 'Test Second Charge'));
    const steps: string[] = [];
    for (let i = 0; i < 200 && s.turn.activePlayer === 'p1'; i++) {
      if (steps[steps.length - 1] !== s.turn.step) steps.push(s.turn.step);
      s = next(s);
    }
    const phases = steps.map((x) => (x.startsWith('main') ? 'main' : ['beginCombat', 'declareAttackers', 'declareBlockers', 'combatDamage', 'endCombat'].includes(x) ? 'combat' : x))
      .filter((x, i, a) => i === 0 || a[i - 1] !== x);
    expect(phases.slice(0, 5)).toEqual(['main', 'combat', 'main', 'combat', 'main']);
  });
});

// ---- CR 701.47a: another player amasses ---------------------------------------------------------------------------------------------------------------------

describe('CR 701.47a: "Destroy target creature. Its controller amasses Orcs 2."', () => {
  const RAZE = card('Test Warband Call', 'Sorcery', 'Destroy target creature. Its controller amasses Orcs 2.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('the destroyed creature\'s controller creates the Army and gets the counters', () => {
    expect(noManual(RAZE)).toBe(true); // experimental template (design 6.9 cap)
    let s = scenario([], { defs: [RAZE, BEAR], p1: { hand: ['Test Warband Call'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = onField(s, 'Test Bear', 'p2');
    s = auto(resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Warband Call', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] }])));
    const army = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token');
    expect(army).toBeDefined();
    expect(s.objects[army!]!.controller).toBe('p2');
    expect(s.objects[army!]!.counters['+1/+1']).toBe(2);
    expect(getChars(s, army!).subtypes).toEqual(expect.arrayContaining(['Orc', 'Army']));
  });
});

// ---- CR 701.57c: the discovered card ------------------------------------------------------------------------------------------------------------------------

describe('CR 701.57c, 608.2h: "Discover 4. If the discovered card\'s mana value is less than 4, create a number of Food tokens equal to the difference."', () => {
  const DIG = card('Test Lucky Strike', 'Sorcery', "Discover 4. If the discovered card's mana value is less than 4, create a number of Food tokens equal to the difference.");
  const PEBBLE = card('Test Pebble', 'Sorcery', 'Draw a card.', { cost: '{1}' });
  it('the difference between 4 and the mana value of the card discover stopped at', () => {
    expect(full(DIG)).toBe(true);
    const s0 = scenario([], { defs: [DIG, PEBBLE], p1: { hand: ['Test Lucky Strike'] } });
    s0.zones.library['p1']!.unshift(put(s0, 'p1', 'library', 'Test Pebble'));
    s0.zones.library['p1']!.pop();
    // whichever end is the top, the pebble is the only nonland card: discover stops at it
    let s = resolveTop(cast(s0, 'Test Lucky Strike'));
    for (let i = 0; i < 10 && s.pending && s.pending.kind !== 'priority'; i++) {
      const p = s.pending as unknown as { kind: string; options?: { id: string; label?: string }[] };
      // put the card into the hand rather than cast it (CR 701.57a)
      s = p.kind === 'yesNo' ? answer(s, { kind: 'yesNo', yes: false }) : p.kind === 'chooseOption' ? answer(s, { kind: 'chooseOption', ids: [p.options![p.options!.length - 1]!.id] }) : auto(s, 1);
    }
    expect(handNames(s)).toContain('Test Pebble');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(3);
  });
});

// ---- names, labels and counters -----------------------------------------------------------------------------------------------------------------------------

describe('CR 111.4, 207.2d, 122.1: a token named "X of the Y", an exclaimed flavor word, "for each <kind> counter on ~"', () => {
  it('"create Herald of the Tides, a legendary 2/2 blue Merfolk creature token" names the token', () => {
    const CALL = card('Test Tide Call', 'Sorcery', 'Create Herald of the Tides, a legendary 2/2 blue Merfolk creature token.');
    expect(full(CALL)).toBe(true);
    const s = resolveTop(cast(scenario([], { defs: [CALL], p1: { hand: ['Test Tide Call'] } }), 'Test Tide Call'));
    const tok = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(getChars(s, tok).name).toBe('Herald of the Tides');
    expect(getChars(s, tok).supertypes).toContain('Legendary');
  });
  it('"Are You Ready? -- Whenever ~ attacks, ..." is a label: the ability is the trigger', () => {
    const d = card('Test Herald', 'Creature — Human', 'Are You Ready? — Whenever this creature attacks, you gain 1 life.', { pt: ['1', '1'] });
    expect(full(d)).toBe(true);
    expect(d.faces[0]!.abilities[0]!.kind).toBe('triggered');
    expect(full(card('Test Shout', 'Creature — Human', 'Bring it Home! — Whenever this creature attacks, you gain 1 life.', { pt: ['1', '1'] }))).toBe(false); // "it" in lower case: text
  });
  it('the count of counters is read before the counter of the same instruction is put (CR 608.2c)', () => {
    const NEST = card('Test Hive Nest', 'Enchantment', 'At the beginning of combat on your turn, create a 1/1 red Insect creature token. Put a +1/+1 counter on it for each brood counter on this enchantment, then put a brood counter on this enchantment.');
    expect(full(NEST)).toBe(true);
    const s0 = scenario([], { defs: [NEST], p1: { battlefield: [{ name: 'Test Hive Nest', counters: { brood: 2 } }] } });
    const s = auto(resolveTop(until(s0, (t) => t.zones.stack.length > 0)));
    const tok = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(s.objects[tok]!.counters['+1/+1']).toBe(2);
    expect(s.objects[onField(s, 'Test Hive Nest')]!.counters['brood']).toBe(3);
  });
});

describe('CR 108.3, 109.4, 205.1b: "Creatures you control but don\'t own are Pirates in addition to their other types."', () => {
  const FLAG = card('Test Black Flag', 'Enchantment', "Creatures you control but don't own are Pirates in addition to their other types.");
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  it('a creature its controller does not own is a Pirate; one it owns is not', () => {
    expect(full(FLAG)).toBe(true);
    const s = scenario([], { defs: [FLAG, BEAR], p1: { battlefield: ['Test Black Flag', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const stolen = onField(s, 'Test Bear', 'p2');
    s.objects[stolen]!.controller = 'p1';
    expect(getChars(s, stolen).subtypes).toContain('Pirate');
    expect(getChars(s, onField(s, 'Test Bear', 'p1')).subtypes).not.toContain('Pirate');
  });
});

describe('CR 608.2h, 603.10a: "When ~ dies, put a -1/-1 counter on target creature for each -1/-1 counter on ~" counts the counters it had as it died', () => {
  const STINGER = card('Test Venom Drone', 'Creature — Insect', 'When this creature dies, put a -1/-1 counter on target creature for each -1/-1 counter on this creature.', { pt: ['4', '5'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['5', '5'] });
  const KILL = card('Test Doom Word', 'Instant', 'Destroy target creature.');
  it('last known information: two counters on it as it died, two on the target', () => {
    expect(full(STINGER)).toBe(true);
    let s = scenario([], { defs: [STINGER, BEAR, KILL], p1: { hand: ['Test Doom Word'], battlefield: [{ name: 'Test Venom Drone', counters: { '-1/-1': 2 } }] }, p2: { battlefield: ['Test Bear'] } });
    const drone = onField(s, 'Test Venom Drone');
    const bear = onField(s, 'Test Bear', 'p2');
    s = resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Doom Word', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: drone }] }]));
    s = drive(s, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] }]);
    s = auto(resolveTop(s));
    expect(s.objects[bear]!.counters['-1/-1']).toBe(2);
  });
});

describe('CR 205.1b, 305.6: "Lands you control are Swamps in addition to their other types." gives each land the Swamp\'s mana ability', () => {
  const BOG = card('Test Bog Spread', 'Enchantment', 'Lands you control are Swamps in addition to their other types.');
  it('a Plains is also a Swamp and can tap for {B}', () => {
    expect(full(BOG)).toBe(true);
    const s = scenario(['Plains'], { defs: [BOG], p1: { battlefield: ['Test Bog Spread', 'Plains'] } });
    const plains = s.zones.battlefield.find((id) => nameOf(s, id) === 'Plains')!;
    expect(getChars(s, plains).subtypes).toEqual(expect.arrayContaining(['Plains', 'Swamp']));
    const labels = legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object === plains).map((a) => a.label).join(' | ');
    expect(labels).toMatch(/\{B\}/);
  });
});

describe('CR 608.2h, 701.47a: "Destroy up to one other target creature. Its controller amasses Goblins X, where X is that creature\'s power. If you controlled that creature, draw a card."', () => {
  const OGRE = card('Test Ruin Chief', 'Legendary Creature — Goblin', "When this creature enters, destroy up to one other target creature. Its controller amasses Goblins X, where X is that creature's power. If you controlled that creature, draw a card.", { pt: ['3', '3'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['3', '2'] });
  const run = (owner: 'p1' | 'p2'): GameState => {
    let s = scenario([], { defs: [OGRE, BEAR], p1: { hand: ['Test Ruin Chief'], ...(owner === 'p1' ? { battlefield: ['Test Bear'] } : {}) }, p2: owner === 'p2' ? { battlefield: ['Test Bear'] } : {} });
    const bear = onField(s, 'Test Bear', owner);
    s = resolveTop(cast(s, 'Test Ruin Chief'));
    s = drive(s, [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: bear }] }]);
    return auto(resolveTop(s));
  };
  const army = (s: GameState) => s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token');
  it('an opponent\'s creature: that opponent amasses 3 (its power as it last existed); you draw nothing', () => {
    expect(full(OGRE)).toBe(true);
    const s = run('p2');
    const a = army(s)!;
    expect(s.objects[a]!.controller).toBe('p2');
    expect(s.objects[a]!.counters['+1/+1']).toBe(3);
    expect(s.zones.hand['p1']!.length).toBe(0);
  });
  it('your own creature: you amass 3 and draw a card', () => {
    const s = run('p1');
    expect(s.objects[army(s)!]!.controller).toBe('p1');
    expect(s.zones.hand['p1']!.length).toBe(1);
  });
});

describe('CR 105.2a, 107.3: "~ deals X damage to any target, target player draws X cards, and you gain X life, where X is the number of different color pairs among permanents you control that are exactly two colors"', () => {
  const PAIRS = card('Test Guild Census', 'Sorcery', 'This spell deals X damage to any target, target player draws X cards, and you gain X life, where X is the number of different color pairs among permanents you control that are exactly two colors.');
  const AZ = card('Test Azure Knight', 'Creature — Human', '', { pt: ['1', '1'], cost: '{W}{U}', colors: ['W', 'U'] });
  const DI = card('Test Dimir Spy', 'Creature — Human', '', { pt: ['1', '1'], cost: '{U}{B}', colors: ['U', 'B'] });
  const TRI = card('Test Shard Mage', 'Creature — Human', '', { pt: ['1', '1'], cost: '{W}{U}{B}', colors: ['W', 'U', 'B'] });
  it('two Azorius permanents and one Dimir make two pairs; a three-color permanent adds none', () => {
    expect(full(PAIRS)).toBe(true);
    let s = scenario([], { defs: [PAIRS, AZ, DI, TRI], p1: { hand: ['Test Guild Census'], battlefield: ['Test Azure Knight', 'Test Azure Knight', 'Test Dimir Spy', 'Test Shard Mage'] } });
    s = auto(resolveTop(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Guild Census', 'hand', 'p1') }), [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p1' }] }])));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(22);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(18);
    expect(s.zones.hand['p1']!.length).toBe(2);
  });
});
