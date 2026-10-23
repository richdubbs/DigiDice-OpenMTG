/**
 * std-copy-6 (lane std-copy): the round's engine changes played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 707.10, 400.7, 122.1      "copy it, then exile the spell you cast with two time counters on it": the copy resolves; the original never does, it is a card in
 *                                exile with the counters
 *   CR 702.62a-b, 113.6, 611.2c  "If it doesn't have suspend, it gains suspend.": the card gains suspend in exile for as long as it stays there; it is suspended, its
 *                                two triggered abilities work there (a time counter removed each upkeep, a free cast when the last is removed)
 *   CR 603.2, 603.3b, 508.1m     "Whenever a creature you control attacking causes a triggered ability of that creature to trigger": it triggers as that ability
 *                                triggers, both are put on the stack at once; not for an ability another event caused, nor for an opponent's creature
 *   CR 707.10, 707.10c           "copy that ability": a copy of the triggered ability on the stack, which resolves too; nothing once that ability has left the stack
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { answer, cast, drive, find, lands, next, scenario } from '../../m6/dfc/support';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const inExile = (s: GameState, name: string): string | undefined => s.zones.exile.find((x) => s.defs[s.objects[x]!.defId]!.name === name);

/** Step forward (passing priority, declaring nothing) until `done` holds or a yes/no question is asked. */
function upTo(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t) && t.pending?.kind !== 'yesNo'; i++) {
    t = t.pending && t.pending.kind !== 'priority' && t.pending.kind !== 'declareAttackers' && t.pending.kind !== 'declareBlockers' ? drive(t) : next(t);
  }
  return t;
}
const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => upTo(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
const yes = (s: GameState, y: boolean): GameState => drive(answer(s, { kind: 'yesNo', yes: y } as DecisionAnswer));
const settle = (s: GameState): GameState => upTo(s, (t) => t.zones.stack.length === 0 && t.pending?.kind === 'priority');

const MONK = card('Test Opportunist Monk', 'Legendary Creature — Human Monk', "Whenever you cast your second spell each turn, copy it, then exile the spell you cast with two time counters on it. If it doesn't have suspend, it gains suspend.", { pt: ['2', '2'] });
const SIP = card('Test Sip', 'Instant', 'You gain 1 life.');
const GULP = card('Test Gulp', 'Sorcery', 'You gain 3 life.');
const SLOW = card('Test Slow Gulp', 'Sorcery', 'You gain 3 life.\nSuspend 5—{R}', { cost: '{3}{R}' });
const DEFS: CardDef[] = [MONK, SIP, GULP, SLOW];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const board = (second = 'Test Gulp'): GameState => scenario(['Mountain'], { defs: DEFS, p1: { hand: ['Test Sip', second], battlefield: ['Test Opportunist Monk', ...lands('Mountain', 4)] } });
/** Cast the first spell, let it resolve, cast the second: the trigger resolves (the copy is put on the stack, the original exiled), everything resolves. */
const both = (second = 'Test Gulp'): GameState => settle(cast(settle(cast(board(second), 'Test Sip')), second));

describe('CR 707.10, 400.7, 122.1: "copy it, then exile the spell you cast with two time counters on it"', () => {
  it('CR 707.10: the copy resolves (3 life), the original does not: it is in exile with two time counters', () => {
    const s0 = board();
    const s = both();
    expect(lifeOf(s, 'p1')).toBe(lifeOf(s0, 'p1') + 1 + 3);
    const id = inExile(s, 'Test Gulp');
    expect(id).toBeDefined();
    expect(s.objects[id!]!.counters['time']).toBe(2);
  });
  it('CR 601.2i: the first spell of the turn does not trigger it', () => {
    const s = cast(board(), 'Test Sip');
    expect(s.zones.stack.length).toBe(1);
  });
});

describe('CR 702.62a-b, 113.6, 611.2c: "If it doesn\'t have suspend, it gains suspend."', () => {
  it('CR 702.62b: the exiled card has suspend in exile and is suspended', () => {
    const s = both();
    const id = inExile(s, 'Test Gulp')!;
    expect(charsOfObject(s, s.objects[id]!).keywords.some((k) => k.keyword === 'suspend')).toBe(true);
  });
  it('CR 702.62a, 113.6: at the beginning of its owner\'s upkeep a time counter is removed (not in the opponent\'s upkeep)', () => {
    let s = mainOf(both(), 'p2');
    expect(s.objects[inExile(s, 'Test Gulp')!]!.counters['time']).toBe(2);
    s = mainOf(s, 'p1');
    expect(s.objects[inExile(s, 'Test Gulp')!]!.counters['time']).toBe(1);
  });
  it('CR 702.62a, 118.9: when the last is removed, its owner may cast it without paying its mana cost; it resolves and leaves exile', () => {
    let s = mainOf(mainOf(both(), 'p2'), 'p1');
    const life = lifeOf(s, 'p1');
    s = upTo(mainOf(s, 'p2'), () => false);
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.turn.activePlayer).toBe('p1');
    s = settle(yes(s, true));
    expect(lifeOf(s, 'p1')).toBe(life + 3);
    expect(inExile(s, 'Test Gulp')).toBeUndefined();
  });
  it('CR 702.62a: a card with a suspend of its own keeps it (no second suspend is granted): five time counters would not change, the exile puts two', () => {
    const s = both('Test Slow Gulp');
    const id = inExile(s, 'Test Slow Gulp')!;
    expect(s.objects[id]!.counters['time']).toBe(2);
    expect(charsOfObject(s, s.objects[id]!).keywords.filter((k) => k.keyword === 'suspend')).toHaveLength(1);
  });
});

const ASCENSION = card('Test Ember Ascension', 'Enchantment', 'Whenever a creature you control attacking causes a triggered ability of that creature to trigger, put a quest counter on this enchantment. Then if it has four or more quest counters on it, you may copy that ability. You may choose new targets for the copy.');
const RAIDER = card('Test Raider', 'Creature — Human Soldier', 'Whenever this creature attacks, you gain 1 life.', { pt: ['2', '2'] });
const MEDIC = card('Test Medic', 'Creature — Human Cleric', 'Whenever you attack, you gain 2 life.', { pt: ['1', '1'] });
const ADEFS: CardDef[] = [ASCENSION, RAIDER, MEDIC];
const quests = (s: GameState): number => s.objects[find(s, 'Test Ember Ascension', 'battlefield', 'p1')]!.counters['quest'] ?? 0;

/** p1 attacks with `attackers`; the triggers are ordered with the Ascension's on top (it resolves first) unless `ascensionFirst` is false. */
function attackWith(s0: GameState, attackers: string[], ascensionFirst = true): GameState {
  let s = declareAttackers(toDeclareAttackers(s0), attackers.map((n) => [find(s0, n, 'battlefield', 'p1')] as [string]));
  for (let i = 0; i < 20 && s.pending?.kind === 'order'; i++) {
    const items = (s.pending as unknown as { items: { id: string; label?: string; sourceName?: string }[] }).items;
    const isAsc = (x: { id: string }): boolean => JSON.stringify(x).includes('Test Ember Ascension');
    const ordered = ascensionFirst ? [...items.filter((x) => !isAsc(x)), ...items.filter(isAsc)] : [...items.filter(isAsc), ...items.filter((x) => !isAsc(x))];
    s = answer(s, { kind: 'order', ids: ordered.map((x) => x.id) } as DecisionAnswer);
  }
  return s;
}
const ascBoard = (counters = 0, extra: string[] = []): GameState => scenario(['Plains'], { defs: ADEFS, p1: { battlefield: [{ name: 'Test Ember Ascension', counters: { quest: counters } }, 'Test Raider', ...extra] } });

describe('the synthetic Ascension cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of ADEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 603.2, 603.3b, 508.1m: "a creature you control attacking causes a triggered ability of that creature to trigger"', () => {
  it('CR 603.3b: the attack trigger and this trigger are put on the stack together; a quest counter is put on it', () => {
    let s = attackWith(ascBoard(), ['Test Raider']);
    expect(s.zones.stack.length).toBe(2);
    const life = lifeOf(s, 'p1');
    s = settle(s);
    expect(quests(s)).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(life + 1); // fewer than four counters: no copy
  });
  it('CR 603.2: an ability another event caused ("whenever you attack" is the player attacking, not the creature) does not trigger it', () => {
    let s = scenario(['Plains'], { defs: ADEFS, p1: { battlefield: ['Test Ember Ascension', 'Test Medic', 'Test Raider'] } });
    s = settle(attackWith(s, ['Test Raider']));
    expect(quests(s)).toBe(1); // only the Raider's own attack trigger (the Medic does not attack; its ability is no creature attacking causing it)
  });
  it('CR 508.1m, 603.2: a creature\'s "whenever you attack" that its own attack caused counts (one counter); the creature that stayed home causes nothing', () => {
    let s = scenario(['Plains'], { defs: ADEFS, p1: { battlefield: ['Test Ember Ascension', 'Test Medic', 'Test Raider'] } });
    s = settle(attackWith(s, ['Test Medic']));
    expect(quests(s)).toBe(1); // the Medic attacking caused its own "whenever you attack" (CR 508.1m); the Raider stayed home
  });
});

describe('CR 707.10, 707.10c: "Then if it has four or more quest counters on it, you may copy that ability."', () => {
  it('CR 707.10: with the fourth counter the attack trigger is copied: it resolves twice', () => {
    let s = attackWith(ascBoard(3), ['Test Raider']);
    const life = lifeOf(s, 'p1');
    s = upTo(s, () => false);
    expect(s.pending?.kind).toBe('yesNo');
    s = settle(yes(s, true));
    expect(quests(s)).toBe(4);
    expect(lifeOf(s, 'p1')).toBe(life + 2);
  });
  it('CR 608.2d: declined, there is no copy', () => {
    let s = attackWith(ascBoard(3), ['Test Raider']);
    const life = lifeOf(s, 'p1');
    s = settle(yes(upTo(s, () => false), false));
    expect(lifeOf(s, 'p1')).toBe(life + 1);
  });
  it('CR 707.10, 400.7: when the attack trigger resolved first it is gone from the stack: nothing is copied', () => {
    let s = attackWith(ascBoard(3), ['Test Raider'], false);
    const life = lifeOf(s, 'p1');
    s = settle(s.pending?.kind === 'yesNo' ? yes(s, true) : s);
    s = s.pending?.kind === 'yesNo' ? settle(yes(s, true)) : s;
    expect(lifeOf(s, 'p1')).toBe(life + 1);
  });
});
