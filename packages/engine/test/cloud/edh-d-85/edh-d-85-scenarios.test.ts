/**
 * Commander coordinator D, round edh-d-85 (EDHREC ranks 5,001-10,000, group combat): the round's readings played through the engine with synthetic cards (invented names, design
 * 6.10), compiled by the game's default compiler. Alice (p1) is the active player of turn 1, Bob (p2) the opponent. Each test is named after the rule it checks, with its negative
 * case. CR cites from the Comprehensive Rules of 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), checked against that text.
 *
 *   CR 608.2c, 611.2a, 613.1f, 508.4   "... put it onto the battlefield tapped and attacking. Until your next turn, it gains trample if you control a Dwarf and hexproof if you
 *                                      control an Elf." (Doors of Durin)
 *   CR 614.1a, 614.6, 122.1, 700.4     "If a creature an opponent controls would die, instead exile it and put a hit counter on it." (Ravenloft Adventurer)
 *   CR 611.2a, 613.1f, 509.1b, 122.1   "Until end of turn, target creature gains "Whenever this creature deals combat damage to a player, draw a card for each kind of counter on
 *                                      it" and it can't be blocked this turn." (Blitzball Stadium)
 *   CR 613.1f, 701.14a, 701.14b        'Other creatures have "Whenever this creature attacks, you may have it fight ~."' (Grothama, All-Devouring)
 *   CR 120.1, 603.10a, 608.2h          "When ~ leaves the battlefield, each player draws cards equal to the amount of damage dealt to ~ this turn by sources they controlled."
 *   CR 404.1, 122.6, 701.15a-b, 611.2b "Return target creature card from an opponent's graveyard to the battlefield under their control with a duty counter on it. For as long
 *        508.1c, 509.1b              as that creature has a duty counter on it, it is goaded, can't attack you or a permanent you control, and can't block creatures you
 *                                      control." (Immortal Obligation)
 *   CR 611.2c, 608.2c, 613.4c, 603.10  "Whenever ~ attacks, attacking creatures get +1/+1 until end of turn. If a Food entered the battlefield under your control this turn, untap
 *                                      those creatures and they get an additional +2/+2 until end of turn." (Motivated Pony)
 *   CR 603.4, 506.1, 508.1, 510.1      "Whenever ~ deals combat damage to a player, if that player attacked you during their last turn, exile target nonland permanent that
 *                                      player controls." (O-Kagachi, Vengeful Kami)
 *   CR 508.1d, 119.1, 604.1, 201.2     "~ attacks an opponent with the most life among your opponents each combat if able unless you control a creature named <name>." (Galactus,
 *                                      Devourer of Worlds)
 *   CR 205.2a, 608.2d, 122.1h, 614.1a  "At the beginning of your end step, you may exile any number of cards from your graveyard with four or more card types among them. If you
 *                                      do, put a permanent card from among them onto the battlefield with a finality counter on it." (Winter, Cynical Opportunist)
 *   CR 608.2c, 118.12, 406.1, 110.2    "Whenever equipped creature deals combat damage to a player, exile the top card of that player's library. If it's a permanent card, you
 *                                      may put it onto the battlefield under your control. If you don't, create a 1/1 blue Fish creature token." (Fishing Gear)
 *   CR 701.9a, 400.7, 115.1, 404.1     "choose up to one target card in a graveyard that was discarded or put there from a library this turn. Put that card into its owner's
 *                                      hand." (Ghost of Ramirez DePietro)
 *   CR 603.4, 309.7, 108.3, 406.1      "Whenever ~ attacks, if you've completed a dungeon, defending player loses 1 life for each card they own in exile with a hit counter on it."
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, pass, put, reject } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { activations, card, cast, drive, find, full, lifeOf, obj, resolveAll, scenario, type Script } from '../r5-cost/support';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const kws = (s: GameState, id: ObjectId): string[] => getChars(s, id)!.keywords.map((k) => (typeof k === 'string' ? k : (k as { keyword: string }).keyword));
const onBf = (s: GameState, name: string): ObjectId | undefined => s.zones.battlefield.find((id) => nameOf(s, id) === name);

/** Pass until p1's declare-attackers decision of the current turn, attack p2 with `attackers`, then answer the attack trigger with `script` until a priority decision. */
function attack(s0: GameState, attackers: string[], script: Script): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
  const used = new Set<ObjectId>();
  const pick = (n: string): ObjectId => { const id = s.zones.battlefield.find((x) => nameOf(s, x) === n && s.objects[x]!.controller === 'p1' && !used.has(x))!; used.add(id); return id; };
  s = answer(s, { kind: 'declareAttackers', attacks: attackers.map((n) => ({ attacker: pick(n), defender: 'p2' as const })) });
  s = drive(s, script);
  for (let i = 0; i < 8 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), script);
  return s;
}

// ---- Doors of Durin ------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 611.2a, 613.1f: "Until your next turn, it gains trample if you control a Dwarf and hexproof if you control an Elf." (Doors of Durin)', () => {
  const DOORS = card('Test Threshold', 'Legendary Artifact', 'Whenever you attack, scry 2, then you may reveal the top card of your library. If a creature card is revealed this way, put it onto the battlefield tapped and attacking. Until your next turn, it gains trample if you control a Dwarf and hexproof if you control an Elf.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const DWARF = card('Test Smith', 'Creature — Dwarf', '', '{0}', ['1', '1']);
  const ELF = card('Test Archer', 'Creature — Elf', '', '{0}', ['1', '1']);
  const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['3', '3']);
  const ROCK = card('Test Rock', 'Artifact', '', '{0}');
  const defs = [DOORS, BEAR, DWARF, ELF, OX, ROCK];
  const game = (bf: string[], top: string): GameState => scenario([], { defs, p1: { battlefield: ['Test Threshold', ...bf], library: [top] } });
  it('is fully automated', () => expect(full(DOORS)).toBe(true));
  it('a revealed creature card enters tapped and attacking (CR 508.4); with a Dwarf it gains trample, and an Elf counts itself for its hexproof (ruling 2023-06-16)', () => {
    const s = attack(game(['Test Bear', 'Test Smith'], 'Test Archer'), ['Test Bear'], { yes: [true] });
    const elf = onBf(s, 'Test Archer')!;
    expect(elf).toBeDefined();
    expect(s.objects[elf]!.tapped).toBe(true);
    expect(s.combat?.attackers.find((a) => a.id === elf)?.defendingPlayer).toBe('p2'); // the only opponent: the controller's choice of defender (CR 508.4)
    expect(kws(s, elf)).toEqual(expect.arrayContaining(['trample', 'hexproof']));
  });
  it('negative: without a Dwarf or an Elf the creature gains neither (each grant is made only if its condition holds, CR 608.2c)', () => {
    const s = attack(game(['Test Bear'], 'Test Ox'), ['Test Bear'], { yes: [true] });
    const ox = onBf(s, 'Test Ox')!;
    expect(ox).toBeDefined();
    expect(kws(s, ox)).not.toContain('trample');
    expect(kws(s, ox)).not.toContain('hexproof');
  });
  it('negative: a Dwarf but no Elf: trample only', () => {
    const s = attack(game(['Test Bear', 'Test Smith'], 'Test Ox'), ['Test Bear'], { yes: [true] });
    const ox = onBf(s, 'Test Ox')!;
    expect(kws(s, ox)).toContain('trample');
    expect(kws(s, ox)).not.toContain('hexproof');
  });
  it('negative: a noncreature card revealed stays on top of the library, and nothing gains an ability', () => {
    const s = attack(game(['Test Bear', 'Test Smith', 'Test Archer'], 'Test Rock'), ['Test Bear'], { yes: [true] });
    expect(onBf(s, 'Test Rock')).toBeUndefined();
    expect(nameOf(s, s.zones.library.p1![0]!)).toBe('Test Rock');
    for (const id of s.zones.battlefield) expect(kws(s, id)).not.toContain('hexproof');
  });
  it('negative: declining to reveal leaves the creature card on top (the reveal is a "may")', () => {
    const s = attack(game(['Test Bear', 'Test Smith'], 'Test Ox'), ['Test Bear'], { yes: [false] });
    expect(onBf(s, 'Test Ox')).toBeUndefined();
    expect(nameOf(s, s.zones.library.p1![0]!)).toBe('Test Ox');
  });
  it('CR 611.2a: the abilities last until your next turn (still there in the opponent\'s turn, gone in yours)', () => {
    let s = attack(game(['Test Bear', 'Test Smith', 'Test Archer'], 'Test Ox'), ['Test Bear'], { yes: [true] });
    const ox = onBf(s, 'Test Ox')!;
    for (let i = 0; i < 400 && s.turn.number < 2; i++) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(s.turn.number).toBe(2);
    expect(kws(s, ox)).toEqual(expect.arrayContaining(['trample', 'hexproof']));
    for (let i = 0; i < 600 && s.turn.number < 3; i++) s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : s.pending?.kind === 'priority' ? pass(s) : drive(s);
    expect(s.turn.number).toBe(3);
    expect(kws(s, ox)).not.toContain('trample');
    expect(kws(s, ox)).not.toContain('hexproof');
  });
});

// ---- Ravenloft Adventurer ------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 614.1a, 122.1: "If a creature an opponent controls would die, instead exile it and put a hit counter on it." and the attack trigger that counts them (Ravenloft Adventurer)', () => {
  const ADV = card('Test Stalker', 'Creature — Human Rogue', "If a creature an opponent controls would die, instead exile it and put a hit counter on it.\nWhenever this creature attacks, if you've completed a dungeon, defending player loses 1 life for each card they own in exile with a hit counter on it.", '{0}', ['3', '4']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const WIPE = card('Test Bear Hunt', 'Sorcery', 'Destroy all Bears.', '{0}');
  const defs = [ADV, BEAR, WIPE];
  const base = (): GameState => scenario([], { defs, p1: { battlefield: ['Test Stalker', 'Test Bear'], hand: ['Test Bear Hunt'] }, p2: { battlefield: ['Test Bear', 'Test Bear'] } });
  const hits = (s: GameState, owner: 'p1' | 'p2'): number => s.zones.exile.filter((id) => s.objects[id]!.owner === owner && (s.objects[id]!.counters['hit'] ?? 0) > 0).length;
  it('is fully automated', () => expect(full(ADV)).toBe(true));
  it('an opponent\'s dying creature is exiled with a hit counter instead; your own creature still goes to the graveyard (negative)', () => {
    const s = resolveAll(cast(base(), 'Test Bear Hunt'));
    expect(hits(s, 'p2')).toBe(2);
    expect(s.zones.graveyard.p2!.filter((id) => s.objects[id]!.defId === 'Test Bear')).toHaveLength(0);
    expect(s.zones.graveyard.p1!.filter((id) => s.objects[id]!.defId === 'Test Bear')).toHaveLength(1);
    expect(hits(s, 'p1')).toBe(0);
  });
  it('CR 603.4: having completed a dungeon, the attack makes the defending player lose 1 life per card THEY own in exile with a hit counter (not yours, not one without a counter)', () => {
    let s = resolveAll(cast(base(), 'Test Bear Hunt'));
    put(s, 'p1', 'exile', { name: 'Test Bear', counters: { hit: 1 } }); // yours: not counted
    put(s, 'p2', 'exile', 'Test Bear'); // theirs without a hit counter: not counted
    s.designations.completedDungeons = { p1: ['Test Dungeon'] };
    const before = lifeOf(s, 'p2');
    s = attack(s, ['Test Stalker'], {});
    expect(lifeOf(s, 'p2')).toBe(before - 2);
  });
  it('negative (CR 603.4): without a completed dungeon the attack trigger does nothing', () => {
    let s = resolveAll(cast(base(), 'Test Bear Hunt'));
    const before = lifeOf(s, 'p2');
    s = attack(s, ['Test Stalker'], {});
    expect(lifeOf(s, 'p2')).toBe(before);
  });
});

// ---- Blitzball Stadium -----------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 611.2a, 122.1, 509.1b: a granted "draw a card for each kind of counter on it" and "it can\'t be blocked this turn" (Blitzball Stadium)', () => {
  const STADIUM = card('Test Arena', 'Artifact', '{3}, {T}: Until end of turn, target creature gains "Whenever this creature deals combat damage to a player, draw a card for each kind of counter on it" and it can\'t be blocked this turn.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const WALL = card('Test Wall', 'Creature — Wall', '', '{0}', ['0', '6']);
  const defs = [STADIUM, BEAR, WALL];
  const game = (counters: Record<string, number>): GameState => scenario(['Plains'], { defs, p1: { battlefield: ['Test Arena', 'Plains', 'Plains', 'Plains', { name: 'Test Bear', counters }] }, p2: { battlefield: ['Test Wall'] } });
  const grant = (s0: GameState): GameState => {
    const a = activations(s0, 'Test Arena')[0]!;
    return resolveAll(drive(act(s0, a.action), { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]] }));
  };
  const hand = (s: GameState): number => s.zones.hand.p1!.length;
  it('is fully automated', () => expect(full(STADIUM)).toBe(true));
  it('CR 122.1: two kinds of counters (three +1/+1 and one time) draw two cards, not four; the creature cannot be blocked (CR 509.1b)', () => {
    let s = grant(game({ '+1/+1': 3, time: 1 }));
    const h = hand(s);
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p2' }] });
    let asked = 0;
    for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) {
      if (s.pending?.kind === 'declareBlockers') {
        const wall = find(s, 'Test Wall', 'battlefield', 'p2');
        expect(() => answer(s, { kind: 'declareBlockers', blocks: [{ blocker: wall, attacker: bear }] })).toThrow();
        asked++;
        s = answer(s, { kind: 'declareBlockers', blocks: [] });
      } else s = s.zones.stack.length > 0 ? resolveAll(s) : pass(s);
    }
    expect(s.turn.number).toBe(1);
    expect(lifeOf(s, 'p2')).toBe(20 - 5); // unblocked: a 2/2 with three +1/+1 counters
    expect(hand(s)).toBe(h + 2);
    void asked;
  });
  it('negative: no counters on it, no card drawn (zero kinds)', () => {
    let s = grant(game({}));
    const h = hand(s);
    s = attack(s, ['Test Bear'], {});
    for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : s.zones.stack.length > 0 ? resolveAll(s) : pass(s);
    expect(hand(s)).toBe(h);
  });
});

// ---- Grothama, All-Devouring ---------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.14, 603.10a: granted "you may have it fight ~" and "each player draws cards equal to the amount of damage dealt to ~ this turn by sources they controlled" (Grothama)', () => {
  const WURM = card('Test Devourer', 'Legendary Creature — Wurm', 'Other creatures have "Whenever this creature attacks, you may have it fight Test Devourer."\nWhen Test Devourer leaves the battlefield, each player draws cards equal to the amount of damage dealt to Test Devourer this turn by sources they controlled.', '{0}', ['10', '8']);
  const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['2', '2']);
  const GIANT = card('Test Giant', 'Creature — Giant', '', '{0}', ['9', '9']);
  const BOLT = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to target creature.', '{0}');
  const defs = [WURM, OX, GIANT, BOLT];
  const hand = (s: GameState, p: 'p1' | 'p2'): number => s.zones.hand[p]!.length;
  it('is fully automated', () => expect(full(WURM)).toBe(true));
  it('each player draws the damage THEIR sources dealt to it this turn (3 by the opponent\'s spell; 3 by yours plus 2 by your fighting creature)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Devourer', 'Test Ox'], hand: ['Test Spark'] }, p2: { hand: ['Test Spark'] } });
    const wurm = find(s, 'Test Devourer', 'battlefield', 'p1');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Spark', 'hand', 'p1') }), { targets: [[obj(wurm)]] });
    s = pass(s); // p2 gets priority with the spell on the stack
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Spark', 'hand', 'p2') }), { targets: [[obj(wurm)]] });
    s = resolveAll(s);
    expect(s.objects[wurm]!.damage).toBe(6);
    const h1 = hand(s, 'p1');
    const h2 = hand(s, 'p2');
    s = attack(s, ['Test Ox'], { yes: [true] });
    expect(onBf(s, 'Test Devourer')).toBeUndefined(); // 8 damage: dies (CR 704.5g)
    expect(hand(s, 'p1') - h1).toBe(5);
    expect(hand(s, 'p2') - h2).toBe(3);
  });
  it('negative: declining the fight deals no damage (the controller of the attacking creature chooses, ruling 2018-06-08)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Devourer', 'Test Ox'] } });
    s = attack(s, ['Test Ox'], { yes: [false] });
    expect(s.objects[find(s, 'Test Devourer', 'battlefield', 'p1')]!.damage).toBe(0);
  });
  it('ruling 2018-06-08: once it has left, a remaining attacker cannot fight it (CR 701.14b: no damage); only the damage dealt counts (9, not 18)', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Devourer', 'Test Giant', 'Test Giant'] } });
    const h = hand(s, 'p1');
    s = attack(s, ['Test Giant', 'Test Giant'], { yes: [true, true] });
    expect(onBf(s, 'Test Devourer')).toBeUndefined();
    const giants = s.zones.battlefield.filter((id) => nameOf(s, id) === 'Test Giant');
    expect(giants).toHaveLength(1); // the first fought (and took 10); the second found nothing to fight
    expect(s.objects[giants[0]!]!.damage).toBe(0);
    expect(hand(s, 'p1') - h).toBe(9);
  });
});

// ---- Immortal Obligation ----------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 404.1, 701.15, 611.2b: "... under their control with a duty counter on it. For as long as that creature has a duty counter on it, it is goaded, can\'t attack you or a permanent you control, and can\'t block creatures you control." (Immortal Obligation)', () => {
  const OBLIGATION = card('Test Oath', 'Instant', "Return target creature card from an opponent's graveyard to the battlefield under their control with a duty counter on it. For as long as that creature has a duty counter on it, it is goaded, can't attack you or a permanent you control, and can't block creatures you control.", '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['3', '3']);
  const WALKER = card('Test Sage', 'Legendary Planeswalker — Test', '', '{0}');
  const defs = [OBLIGATION, BEAR, OX, WALKER];
  /** Three players (Carol, p3, after Bob); p1 returns Bob's Bear with the spell. */
  const game = (p1bf: (string | { name: string; counters: Record<string, number> })[] = []): GameState => {
    const base = scenario([], { defs, p1: { hand: ['Test Oath'], battlefield: p1bf }, p2: { graveyard: ['Test Bear'] } });
    const g = tweak(base, (x) => { x.players.push({ ...structuredClone(x.players[1]!), id: 'p3', name: 'Carol' }); x.zones.library['p3'] = [...x.zones.library['p2']!]; x.zones.hand['p3'] = []; x.zones.graveyard['p3'] = []; });
    const bearCard = find(g, 'Test Bear', 'graveyard', 'p2');
    return resolveAll(drive(act(g, { type: 'cast', player: 'p1', card: find(g, 'Test Oath', 'hand', 'p1') }), { targets: [[obj(bearCard)]] }));
  };
  const toP2Attack = (g0: GameState): GameState => {
    let g = g0;
    for (let i = 0; i < 400 && !(g.turn.activePlayer === 'p2' && g.pending?.kind === 'declareAttackers'); i++) {
      if (g.pending?.kind === 'declareAttackers') g = answer(g, { kind: 'declareAttackers', attacks: [] });
      else if (g.pending?.kind === 'declareBlockers') g = answer(g, { kind: 'declareBlockers', blocks: [] });
      else g = g.pending?.kind === 'priority' ? pass(g) : drive(g);
    }
    return g;
  };
  it('is fully automated', () => expect(full(OBLIGATION)).toBe(true));
  it('CR 404.1, 122.6: the card enters under its owner\'s (the opponent\'s) control with one duty counter', () => {
    const g = game();
    const bear = find(g, 'Test Bear', 'battlefield', 'p2');
    expect(g.objects[bear]!.controller).toBe('p2');
    expect(g.objects[bear]!.counters['duty']).toBe(1);
  });
  it('negative: a creature card in your own graveyard is not a legal target', () => {
    const base = scenario([], { defs, p1: { hand: ['Test Oath'], graveyard: ['Test Bear'] } });
    expect(reject(base, { type: 'cast', player: 'p1', card: find(base, 'Test Oath', 'hand', 'p1') }).message).toMatch(/no legal/);
  });
  it('CR 701.15b: goaded by you, it must attack a player other than you (Carol); it may not attack you, and staying home is refused', () => {
    const g = toP2Attack(game());
    const bear = find(g, 'Test Bear', 'battlefield', 'p2');
    const d = g.pending!;
    expect(d.kind).toBe('declareAttackers');
    expect(reject(g, { type: 'answer', player: 'p2', decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p1' }] } }).message).toBeTruthy();
    expect(reject(g, { type: 'answer', player: 'p2', decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [] } }).message).toBeTruthy();
    const t = answer(g, { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p3' }] });
    expect(t.combat?.attackers.map((a) => a.defender)).toEqual(['p3']);
  });
  it('CR 508.1c: it cannot attack a permanent you control either (your planeswalker)', () => {
    const g = toP2Attack(game([{ name: 'Test Sage', counters: { loyalty: 3 } }]));
    const bear = find(g, 'Test Bear', 'battlefield', 'p2');
    const walker = find(g, 'Test Sage', 'battlefield', 'p1');
    expect(reject(g, { type: 'answer', player: 'p2', decisionId: g.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: walker }] } }).message).toBeTruthy();
  });
  it('CR 509.1b: it cannot block a creature you control', () => {
    let g = game(['Test Ox']);
    for (let i = 0; i < 40 && g.pending?.kind !== 'declareAttackers'; i++) g = pass(g);
    const ox = find(g, 'Test Ox', 'battlefield', 'p1');
    g = answer(g, { kind: 'declareAttackers', attacks: [{ attacker: ox, defender: 'p2' }] });
    let asked = false;
    for (let i = 0; i < 60 && g.turn.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declareBlockers') {
        asked = true;
        const bear = find(g, 'Test Bear', 'battlefield', 'p2');
        expect(reject(g, { type: 'answer', player: 'p2', decisionId: g.pending.id, answer: { kind: 'declareBlockers', blocks: [{ blocker: bear, attacker: ox }] } }).message).toBeTruthy();
        g = answer(g, { kind: 'declareBlockers', blocks: [] });
      } else g = pass(g);
    }
    void asked; // with no legal block the engine may skip the declaration (CR 509.1)
    expect(lifeOf(g, 'p2')).toBe(17); // unblocked
  });
  it('CR 611.2b: once the duty counter is gone, the effect ends: it may block your creature and attack you', () => {
    let g = tweak(game(['Test Ox']), (x) => { const b = Object.values(x.objects).find((o) => o.defId === 'Test Bear' && o.zone === 'battlefield')!; b.counters['duty'] = 0; });
    for (let i = 0; i < 40 && g.pending?.kind !== 'declareAttackers'; i++) g = pass(g);
    const ox = find(g, 'Test Ox', 'battlefield', 'p1');
    g = answer(g, { kind: 'declareAttackers', attacks: [{ attacker: ox, defender: 'p2' }] });
    for (let i = 0; i < 40 && g.pending?.kind !== 'declareBlockers'; i++) g = pass(g);
    const bear = find(g, 'Test Bear', 'battlefield', 'p2');
    const t = answer(g, { kind: 'declareBlockers', blocks: [{ blocker: bear, attacker: ox }] });
    expect(t.combat?.blockers.length ?? 0).toBeGreaterThan(0);
    const u = toP2Attack(tweak(game(), (x) => { const b = Object.values(x.objects).find((o) => o.defId === 'Test Bear' && o.zone === 'battlefield')!; b.counters['duty'] = 0; }));
    const bear2 = find(u, 'Test Bear', 'battlefield', 'p2');
    expect(answer(u, { kind: 'declareAttackers', attacks: [{ attacker: bear2, defender: 'p1' }] }).combat?.attackers).toHaveLength(1);
  });
});

// ---- Motivated Pony ---------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 611.2c, 608.2c: "attacking creatures get +1/+1 ... If a Food entered the battlefield under your control this turn, untap those creatures and they get an additional +2/+2" (Motivated Pony)', () => {
  const PONY = card('Test Pony', 'Creature — Horse', 'Trample, haste\nWhenever this creature attacks, attacking creatures get +1/+1 until end of turn. If a Food entered the battlefield under your control this turn, untap those creatures and they get an additional +2/+2 until end of turn.', '{0}', ['3', '3']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const SNACK = card('Test Snack', 'Artifact — Food', '', '{0}');
  const defs = [PONY, BEAR, SNACK];
  const pt = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id)!; return [Number(c.power), Number(c.toughness)]; };
  const QUICK = card('Test Quick Snack', 'Artifact — Food', 'Flash', '{0}');
  defs.push(QUICK);
  const run = (snack: boolean): GameState => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Pony', 'Test Bear'], hand: snack ? ['Test Snack'] : [] }, p2: { battlefield: ['Test Bear'] } });
    if (snack) s = resolveAll(cast(s, 'Test Snack'));
    return s;
  };
  it('is fully automated', () => expect(full(PONY)).toBe(true));
  it('with a Food that entered under your control this turn, the attacking creatures untap and get +3/+3 in all', () => {
    const s = attack(run(true), ['Test Pony', 'Test Bear'], {});
    const pony = find(s, 'Test Pony', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(pt(s, pony)).toEqual([6, 6]);
    expect(pt(s, bear)).toEqual([5, 5]);
    expect(s.objects[pony]!.tapped).toBe(false);
    expect(s.objects[bear]!.tapped).toBe(false);
    const theirs = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(pt(s, theirs)).toEqual([2, 2]); // not attacking: not one of "those creatures"
  });
  it('negative: no Food entered this turn: only +1/+1, and the attackers stay tapped', () => {
    const s = attack(run(false), ['Test Pony', 'Test Bear'], {});
    const pony = find(s, 'Test Pony', 'battlefield', 'p1');
    expect(pt(s, pony)).toEqual([4, 4]);
    expect(s.objects[pony]!.tapped).toBe(true);
  });
  it('negative: a Food that entered under an opponent\'s control this turn does not count', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Pony'] }, p2: { hand: ['Test Quick Snack'] } });
    s = pass(s); // p1 passes in its main phase: Bob has priority
    expect(s.pending?.player).toBe('p2');
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Quick Snack', 'hand', 'p2') })));
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Test Quick Snack' && s.objects[id]!.controller === 'p2')).toBe(true);
    expect(s.turn.step).toBe('main1');
    s = attack(s, ['Test Pony'], {});
    const pony = find(s, 'Test Pony', 'battlefield', 'p1');
    expect(pt(s, pony)).toEqual([4, 4]);
    expect(s.objects[pony]!.tapped).toBe(true);
  });
});

// ---- O-Kagachi, Vengeful Kami -----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 603.4, 508.1: "if that player attacked you during their last turn, exile target nonland permanent that player controls" (O-Kagachi, Vengeful Kami)', () => {
  const KAMI = card('Test Vengeful Spirit', 'Legendary Creature — Dragon Spirit', 'Flying, trample\nWhenever this creature deals combat damage to a player, if that player attacked you during their last turn, exile target nonland permanent that player controls.', '{0}', ['6', '6']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const ROCK = card('Test Rock', 'Artifact', '', '{0}');
  const WALKER = card('Test Sage', 'Legendary Planeswalker — Test', '', '{0}');
  const defs = [KAMI, BEAR, ROCK, WALKER];
  /** Turn 2 (Bob's): Bob attacks with his Bear (`target`: whom) or not at all; then turn 3 (Alice's): the Spirit attacks Bob, unblocked, and the trigger (if any) is answered. */
  const play = (bobAttacks: 'p1' | 'walker' | null): GameState => {
    let g = scenario([], { defs, p1: { battlefield: ['Test Vengeful Spirit', { name: 'Test Sage', counters: { loyalty: 5 } }] }, p2: { battlefield: ['Test Bear', 'Test Rock'] } });
    for (let i = 0; i < 400 && !(g.turn.activePlayer === 'p2' && g.pending?.kind === 'declareAttackers'); i++) {
      if (g.pending?.kind === 'declareAttackers') g = answer(g, { kind: 'declareAttackers', attacks: [] });
      else g = g.pending?.kind === 'priority' ? pass(g) : drive(g);
    }
    const bear = find(g, 'Test Bear', 'battlefield', 'p2');
    const defender = bobAttacks === 'p1' ? 'p1' : bobAttacks === 'walker' ? find(g, 'Test Sage', 'battlefield', 'p1') : null;
    g = answer(g, { kind: 'declareAttackers', attacks: defender === null ? [] : [{ attacker: bear, defender }] });
    for (let i = 0; i < 400 && !(g.turn.activePlayer === 'p1' && g.turn.number === 3 && g.pending?.kind === 'declareAttackers'); i++) {
      if (g.pending?.kind === 'declareBlockers') g = answer(g, { kind: 'declareBlockers', blocks: [] });
      else if (g.pending?.kind === 'declareAttackers') g = answer(g, { kind: 'declareAttackers', attacks: [] });
      else g = g.pending?.kind === 'priority' ? pass(g) : drive(g);
    }
    g = answer(g, { kind: 'declareAttackers', attacks: [{ attacker: find(g, 'Test Vengeful Spirit', 'battlefield', 'p1'), defender: 'p2' }] });
    const rock = find(g, 'Test Rock', 'battlefield', 'p2');
    for (let i = 0; i < 80 && !(g.turn.step === 'main2' && g.zones.stack.length === 0); i++) {
      if (g.pending?.kind === 'declareBlockers') g = answer(g, { kind: 'declareBlockers', blocks: [] });
      else if (g.pending?.kind === 'chooseTargets') g = answer(g, { kind: 'chooseTargets', targets: [obj(rock)] });
      else g = g.pending?.kind === 'priority' ? pass(g) : drive(g);
    }
    return g;
  };
  it('is fully automated', () => expect(full(KAMI)).toBe(true));
  it('the player it hits attacked you during their last turn: one target nonland permanent of theirs is exiled', () => {
    const g = play('p1');
    expect(g.turn.number).toBe(3);
    expect(onBf(g, 'Test Rock')).toBeUndefined();
    expect(g.zones.exile.some((id) => nameOf(g, id) === 'Test Rock')).toBe(true);
  });
  it('negative: they did not attack during their last turn: no trigger', () => {
    const g = play(null);
    expect(g.turn.number).toBe(3);
    expect(lifeOf(g, 'p2')).toBe(14); // it did hit Bob
    expect(onBf(g, 'Test Rock')).toBeDefined();
  });
  it('negative (ruling 2017-08-25): attacking only your planeswalker is not attacking you', () => {
    const g = play('walker');
    expect(g.turn.number).toBe(3);
    expect(lifeOf(g, 'p2')).toBe(14);
    expect(onBf(g, 'Test Rock')).toBeDefined();
  });
});

// ---- Galactus, Devourer of Worlds --------------------------------------------------------------------------------------------------------------------------------------
describe('CR 508.1d, 119.1: "~ attacks an opponent with the most life among your opponents each combat if able unless you control a creature named ..." (Galactus, Devourer of Worlds)', () => {
  const EATER = card('Test Eater', 'Legendary Creature — Elder Alien', 'Flying\nThis creature attacks an opponent with the most life among your opponents each combat if able unless you control a creature named Grizzly Bears.', '{0}', ['12', '12']);
  const HERALD = card('Grizzly Bears', 'Creature — Bear', '', '{0}', ['2', '2']);
  const defs = [EATER, HERALD];
  const game = (lives: [number, number], herald = false): GameState => {
    const base = scenario([], { defs, p1: { battlefield: ['Test Eater', ...(herald ? ['Grizzly Bears'] : [])] } });
    const g = tweak(base, (x) => { x.players.push({ ...structuredClone(x.players[1]!), id: 'p3', name: 'Carol' }); x.zones.library['p3'] = [...x.zones.library['p2']!]; x.zones.hand['p3'] = []; x.zones.graveyard['p3'] = []; x.players[1]!.life = lives[0]; x.players[2]!.life = lives[1]; });
    let s = g;
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    return s;
  };
  const declare = (s: GameState, to: string[]) => ({ type: 'answer' as const, player: 'p1' as const, decisionId: s.pending!.id, answer: { kind: 'declareAttackers' as const, attacks: to.map((d) => ({ attacker: find(s, 'Test Eater', 'battlefield', 'p1'), defender: d })) } });
  it('is fully automated', () => expect(full(EATER)).toBe(true));
  it('it must attack the opponent with the most life: Carol (25) and not Bob (20); staying home is refused', () => {
    const s = game([20, 25]);
    expect(reject(s, declare(s, [])).message).toBeTruthy();
    expect(reject(s, declare(s, ['p2'])).message).toBeTruthy();
    expect(act(s, declare(s, ['p3'])).combat?.attackers[0]?.defender).toBe('p3');
  });
  it('CR 119.1: tied for the most life, either opponent obeys it', () => {
    const s = game([22, 22]);
    expect(act(s, declare(s, ['p2'])).combat?.attackers[0]?.defender).toBe('p2');
    expect(act(s, declare(s, ['p3'])).combat?.attackers[0]?.defender).toBe('p3');
    expect(reject(s, declare(s, [])).message).toBeTruthy();
  });
  it('negative (CR 604.1, 611.3a): while you control a creature with that name it need not attack, and may attack anyone', () => {
    const s = game([20, 25], true);
    expect(act(s, declare(s, [])).combat?.attackers ?? []).toHaveLength(0);
    expect(act(s, declare(s, ['p2'])).combat?.attackers[0]?.defender).toBe('p2');
  });
});

// ---- Winter, Cynical Opportunist --------------------------------------------------------------------------------------------------------------------------------------
describe('CR 205.2a, 608.2d: "you may exile any number of cards from your graveyard with four or more card types among them. If you do, put a permanent card from among them onto the battlefield with a finality counter on it." (Winter)', () => {
  const WINTER = card('Test Opportunist', 'Legendary Creature — Human Warlock', 'Deathtouch\nAt the beginning of your end step, you may exile any number of cards from your graveyard with four or more card types among them. If you do, put a permanent card from among them onto the battlefield with a finality counter on it.', '{0}', ['2', '5']);
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const ROCK = card('Test Rock', 'Artifact', '', '{0}');
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to target creature.', '{0}');
  const AURA = card('Test Glow', 'Enchantment', '', '{0}');
  const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', '{0}', ['3', '3']);
  const WIPE = card('Test Bear Hunt', 'Sorcery', 'Destroy all Bears.', '{0}');
  const defs = [WINTER, BEAR, ROCK, SPARK, AURA, GOLEM, WIPE];
  const toChoice = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 300 && !(s.pending?.kind === 'chooseObjects' && s.turn.step === 'end'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    }
    return s;
  };
  const gy = (names: string[]): GameState => scenario([], { defs, p1: { battlefield: ['Test Opportunist'], graveyard: names, hand: ['Test Bear Hunt'] } });
  const ids = (s: GameState, names: string[]): ObjectId[] => names.map((n) => s.zones.graveyard.p1!.find((id) => nameOf(s, id) === n)!);
  it('is fully automated', () => expect(full(WINTER)).toBe(true));
  it('four card types among the exiled cards: a permanent card from among them enters with a finality counter; the rest stay exiled', () => {
    let s = toChoice(gy(['Plains', 'Test Bear', 'Test Rock', 'Test Spark']));
    expect(s.pending?.kind).toBe('chooseObjects');
    s = answer(s, { kind: 'chooseObjects', ids: ids(s, ['Plains', 'Test Bear', 'Test Rock', 'Test Spark']) });
    for (let i = 0; i < 6 && s.pending?.kind === 'chooseObjects'; i++) s = answer(s, { kind: 'chooseObjects', ids: [(s.pending as { options: ObjectId[] }).options.find((id) => nameOf(s, id) === 'Test Bear')!] });
    const bear = onBf(s, 'Test Bear')!;
    expect(bear).toBeDefined();
    expect(s.objects[bear]!.counters['finality']).toBe(1);
    expect(s.zones.exile.map((id) => nameOf(s, id)).sort()).toEqual(['Plains', 'Test Rock', 'Test Spark']);
  });
  it('negative (CR 205.2a): three card types are refused as an answer; none chosen exiles nothing', () => {
    const s = toChoice(gy(['Plains', 'Test Bear', 'Test Rock', 'Test Spark']));
    expect(reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseObjects', ids: ids(s, ['Plains', 'Test Bear', 'Test Rock']) } }).message).toMatch(/card types/);
    const t = answer(s, { kind: 'chooseObjects', ids: [] });
    expect(t.zones.exile).toHaveLength(0);
    expect(t.zones.graveyard.p1!.length).toBe(4);
  });
  it('CR 205.2a: an artifact creature card gives two card types: a land, an artifact creature and an instant are four card types among three cards', () => {
    let s = toChoice(gy(['Plains', 'Test Golem', 'Test Spark']));
    s = answer(s, { kind: 'chooseObjects', ids: ids(s, ['Plains', 'Test Golem', 'Test Spark']) }); // Land, Artifact, Creature, Instant
    for (let i = 0; i < 6 && s.pending?.kind === 'chooseObjects'; i++) s = answer(s, { kind: 'chooseObjects', ids: [(s.pending as { options: ObjectId[] }).options.find((id) => nameOf(s, id) === 'Test Golem')!] });
    expect(onBf(s, 'Test Golem')).toBeDefined();
  });
  it('CR 122.1h, 614.1a: the permanent with a finality counter is exiled instead of going to the graveyard', () => {
    let s = toChoice(gy(['Plains', 'Test Bear', 'Test Rock', 'Test Spark']));
    s = answer(s, { kind: 'chooseObjects', ids: ids(s, ['Plains', 'Test Bear', 'Test Rock', 'Test Spark']) });
    for (let i = 0; i < 6 && s.pending?.kind === 'chooseObjects'; i++) s = answer(s, { kind: 'chooseObjects', ids: [(s.pending as { options: ObjectId[] }).options.find((id) => nameOf(s, id) === 'Test Bear')!] });
    for (let i = 0; i < 400 && !(s.turn.number === 3 && s.turn.step === 'main1' && s.pending?.kind === 'priority'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [] });
      else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    }
    s = resolveAll(cast(s, 'Test Bear Hunt'));
    expect(onBf(s, 'Test Bear')).toBeUndefined();
    expect(s.zones.graveyard.p1!.some((id) => nameOf(s, id) === 'Test Bear')).toBe(false);
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Bear')).toBe(true);
  });
});

// ---- Fishing Gear -------------------------------------------------------------------------------------------------------------------------------------------------------
describe('CR 608.2c, 118.12: "If it\'s a permanent card, you may put it onto the battlefield under your control. If you don\'t, create a 1/1 blue Fish creature token." (Fishing Gear)', () => {
  const GEAR = card('Test Tackle', 'Artifact — Equipment', "Whenever equipped creature deals combat damage to a player, exile the top card of that player's library. If it's a permanent card, you may put it onto the battlefield under your control. If you don't, create a 1/1 blue Fish creature token.\nEquip {2}", '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const ROCK = card('Test Rock', 'Artifact', '', '{0}');
  const SPARK = card('Test Spark', 'Instant', 'Test Spark deals 3 damage to target creature.', '{0}');
  const defs = [GEAR, BEAR, ROCK, SPARK];
  const fish = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
  const run = (top: string, yes: boolean): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Tackle', 'Test Bear'] }, p2: { library: [top] } });
    const g = tweak(s0, (x) => { const gear = Object.values(x.objects).find((o) => o.defId === 'Test Tackle')!; const bear = Object.values(x.objects).find((o) => o.defId === 'Test Bear')!; gear.attachedTo = bear.id; });
    let s = attack(g, ['Test Bear'], {});
    for (let i = 0; i < 80 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) {
      if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else s = s.pending?.kind === 'priority' ? pass(s) : drive(s);
    }
    expect(s.turn.step).toBe('main2');
    return s;
  };
  it('is fully automated', () => expect(full(GEAR)).toBe(true));
  it('a permanent card put onto the battlefield under your control: no Fish', () => {
    const s = run('Test Rock', true);
    const rock = onBf(s, 'Test Rock')!;
    expect(rock).toBeDefined();
    expect(s.objects[rock]!.controller).toBe('p1');
    expect(s.objects[rock]!.owner).toBe('p2');
    expect(fish(s)).toHaveLength(0);
  });
  it('ruling 2025-10-02: declining leaves it in exile and makes a 1/1 blue Fish', () => {
    const s = run('Test Rock', false);
    expect(onBf(s, 'Test Rock')).toBeUndefined();
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Rock')).toBe(true);
    const f = fish(s);
    expect(f).toHaveLength(1);
    const c = getChars(s, f[0]!)!;
    expect([Number(c.power), Number(c.toughness), c.colors, c.subtypes]).toEqual([1, 1, ['U'], ['Fish']]);
  });
  it('a nonpermanent card is not put anywhere: it stays exiled and you get the Fish (nothing was put onto the battlefield)', () => {
    const s = run('Test Spark', true);
    expect(s.zones.exile.some((id) => nameOf(s, id) === 'Test Spark')).toBe(true);
    expect(fish(s)).toHaveLength(1);
  });
});

// ---- Ghost of Ramirez DePietro -----------------------------------------------------------------------------------------------------------------------------------------
describe('CR 701.9a, 400.7: "choose up to one target card in a graveyard that was discarded or put there from a library this turn. Put that card into its owner\'s hand." (Ghost of Ramirez DePietro)', () => {
  const GHOST = card('Test Ghost', 'Legendary Creature — Spirit Pirate', "This creature can't be blocked by creatures with toughness 3 or greater.\nWhenever this creature deals combat damage to a player, choose up to one target card in a graveyard that was discarded or put there from a library this turn. Put that card into its owner's hand.", '{0}', ['2', '3']);
  const PICK = card('Test Pick', 'Sorcery', 'Target player discards a card.', '{0}');
  const DIG = card('Test Dig', 'Sorcery', 'Target player mills a card.', '{0}');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
  const OX = card('Test Ox', 'Creature — Ox', '', '{0}', ['3', '3']);
  const ROCK = card('Test Rock', 'Artifact', '', '{0}');
  const defs = [GHOST, PICK, DIG, BEAR, OX, ROCK];
  /** Alice makes Bob discard his Bear and mill his top card (the Rock); his Ox was in his graveyard before this turn. Then the Ghost hits Bob and the trigger's target choice is returned. */
  const run = (): GameState => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Ghost'], hand: ['Test Pick', 'Test Dig'] }, p2: { hand: ['Test Bear'], library: ['Test Rock'], graveyard: ['Test Ox'] } });
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Pick', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Dig', 'hand', 'p1') }), { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(s.zones.graveyard.p2!.map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear', 'Test Ox', 'Test Rock']);
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Ghost', 'battlefield', 'p1'), defender: 'p2' }] });
    for (let i = 0; i < 60 && s.pending?.kind !== 'chooseTargets'; i++) s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : s.pending?.kind === 'priority' ? pass(s) : drive(s);
    return s;
  };
  it('is fully automated', () => expect(full(GHOST)).toBe(true));
  it('the cards discarded or milled this turn are legal targets; one put into a graveyard on an earlier turn is not (ruling 2020-11-10)', () => {
    const s = run();
    const d = s.pending as { kind: string; objects: ObjectId[]; min: number; max: number };
    expect(d.kind).toBe('chooseTargets');
    expect(d.objects.map((id) => nameOf(s, id)).sort()).toEqual(['Test Bear', 'Test Rock']);
    expect([d.min, d.max]).toEqual([0, 1]);
  });
  it('negative: a creature card that died this turn (put there from the battlefield) is not a legal target', () => {
    const WIPE = card('Test Bear Hunt', 'Sorcery', 'Destroy all Bears.', '{0}');
    let s = scenario([], { defs: [...defs, WIPE], p1: { battlefield: ['Test Ghost'], hand: ['Test Bear Hunt'] }, p2: { battlefield: ['Test Bear'] } });
    s = resolveAll(cast(s, 'Test Bear Hunt'));
    expect(s.zones.graveyard.p2!.map((id) => nameOf(s, id))).toEqual(['Test Bear']);
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    s = answer(s, { kind: 'declareAttackers', attacks: [{ attacker: find(s, 'Test Ghost', 'battlefield', 'p1'), defender: 'p2' }] });
    for (let i = 0; i < 60 && !(s.turn.step === 'main2' && s.zones.stack.length === 0); i++) {
      if (s.pending?.kind === 'chooseTargets') expect((s.pending as { objects: ObjectId[] }).objects).toEqual([]);
      s = s.pending?.kind === 'declareBlockers' ? answer(s, { kind: 'declareBlockers', blocks: [] }) : s.pending?.kind === 'chooseTargets' ? answer(s, { kind: 'chooseTargets', targets: [] }) : s.pending?.kind === 'priority' ? pass(s) : drive(s);
    }
    expect(s.zones.graveyard.p2!.map((id) => nameOf(s, id))).toEqual(['Test Bear']);
  });
  it('the chosen card goes to its owner\'s hand (Bob\'s), not yours', () => {
    let s = run();
    const bear = (s.pending as { objects: ObjectId[] }).objects.find((id) => nameOf(s, id) === 'Test Bear')!;
    s = answer(s, { kind: 'chooseTargets', targets: [obj(bear)] });
    s = resolveAll(s);
    expect(s.zones.hand.p2!.map((id) => nameOf(s, id))).toContain('Test Bear');
    expect(s.zones.hand.p1!.map((id) => nameOf(s, id))).not.toContain('Test Bear');
  });
});
