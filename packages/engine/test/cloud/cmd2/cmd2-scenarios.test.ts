/**
 * Commander batch, agent CMD2 (references to commanders in card text): the templates of parser/templates/zz-cloud/cmd2.json and the parser, renderer and engine
 * support they needed, played through the engine in two-player Commander games (CR 903.2) with synthetic cards compiled by the game's default compiler. Each
 * test is named after the rule it checks.
 *
 *   CR 113.6k, 601.2i, 603.2   "When you cast this spell, ..." functions on the stack (parser/lower/cast-self.ts)
 *   CR 903.8, 707.10           "copy it for each time you've cast your commander from the command zone this game" (the storm cycle, Thunderclap Drake)
 *   CR 903.3d, 903.3e          "whenever your commander enters / attacks / deals combat damage", "whenever you attack with your commander"
 *   CR 903.3d                  "the greatest mana value of a commander you own on the battlefield or in the command zone" (Cloudkill)
 *   CR 702.173a                freerunning (the turn's combat damage history, the `commander` fact)
 *   CR 700.2, 601.2b, 603.3c   "Choose one. If you control a commander (as you cast this spell), you may choose both instead."
 *   CR 702.6c                  "Equip commander {N}"
 *   CR 903.3d, 613.4c          lieutenant: "As long as you control your commander, ~ gets +2/+2 and other creatures you control get +2/+2 and have trample."
 *   CR 701.8a, 903.3           "Destroy all creatures and planeswalkers except for commanders."
 */
import { describe, expect, it } from 'vitest';
import { applyAction, getChars, legalActions, type CardDef, type GameState, type ObjectId } from '../../../src/index';
import { hasKeyword } from '../../../src/rules/characteristics';
import { announceReadable } from '../../../src/actions/announce-cond';
import { announceCondForms } from '../../../src/model/forms';
import type { Condition } from '../../../src/types/ability';
import {
  act, answer, answerUntilPriority, card, commanderOnBattlefield, commanderRec, commanderScenario, drive, find, findAll, forests, inCommand, legend, pass, tweak,
  declareAttackers, toDeclareAttackers, passUntil,
} from '../../m11/rules/helpers';

const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
const BEAR = card('Test Bear', '{1}{G}', 'Creature — Bear', '', ['2', '2']);
const OX = card('Test Ox', '{2}{G}', 'Creature — Ox', '', ['3', '3']);

const manualFree = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const tokens = (s: GameState, p = 'p1'): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);
const castFromHand = (s: GameState, name: string, answers = [] as Parameters<typeof drive>[1]): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), answers);
const castFromCommand = (s: GameState, name: string): GameState => answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: inCommand(s, name) }));
const casts = (s: GameState, name: string, n: number): GameState => tweak(s, (t) => { commanderRec(t, 'p1', name).casts = n; });
/** Pass priority until the stack is empty (both players pass; automatic payments and orders; the first legal answer to a yes/no). */
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 30 && s.zones.stack.length > 0; i++) {
    s = drive(pass(pass(s)));
    if (s.pending?.kind === 'yesNo') s = drive(answer(s, { kind: 'yesNo', yes: true }));
  }
  return s;
}
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

describe('CR 113.6k, 601.2i, 603.2: "When you cast this spell, ..." triggers on the stack', () => {
  const SEER = card('Test Cast Seer', '{2}{G}', 'Creature — Eldrazi', 'When you cast this spell, draw two cards.', ['3', '3']);
  it('is automated, with the ability functioning on the stack', () => {
    expect(manualFree(SEER)).toBe(true);
    const a = SEER.faces[0]!.abilities[0]!;
    expect(a.kind === 'triggered' && a.zone).toEqual(['stack']);
  });
  it('CR 601.2i: casting the spell puts the trigger on the stack above it; it resolves first and the creature still resolves', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [SEER], p1: { battlefield: forests(3), hand: ['Test Cast Seer'] } });
    const hand0 = s.zones.hand['p1']!.length;
    s = castFromHand(s, 'Test Cast Seer');
    expect(s.zones.stack).toHaveLength(2);
    expect(s.objects[s.zones.stack[s.zones.stack.length - 1]!]!.kind).toBe('ability');
    s = drive(pass(pass(s)));
    expect(s.zones.hand['p1']!.length).toBe(hand0 - 1 + 2);
    s = resolveAll(s);
    expect(findAll(s, 'Test Cast Seer', 'battlefield')).toHaveLength(1);
    expect(s.zones.hand['p1']!.length).toBe(hand0 + 1); // nothing triggers from the battlefield (CR 113.6)
  });
  it('CR 113.6, 603.2: a card put onto the battlefield without being cast does not trigger it', () => {
    const s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [SEER], p1: { battlefield: ['Test Cast Seer'] } });
    expect(s.zones.stack).toHaveLength(0);
  });
  it('a pronoun that may name the spell after it resolved keeps the ability manual (CR 400.7)', () => {
    const odd = card('Test Odd Seer', '{2}{G}', 'Creature — Eldrazi', 'When you cast this spell, it gains flying until end of turn.', ['3', '3']);
    expect(manualFree(odd)).toBe(false);
  });
});

describe('CR 903.8, 707.10, 707.10c: "When you cast this spell, copy it for each time you\'ve cast your commander from the command zone this game."', () => {
  const STORM = card('Test Angel Storm', '{3}{G}{G}', 'Sorcery', 'When you cast this spell, copy it for each time you\'ve cast your commander from the command zone this game.\nCreate a 4/4 white Angel creature token with flying.');
  it('is understood', () => expect(manualFree(STORM)).toBe(true));
  it('CR 903.8: two casts of the commander from the command zone make two copies: three Angels in all; the copies are not cast (CR 707.10c)', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [STORM], p1: { battlefield: forests(5), hand: ['Test Angel Storm'] } });
    s = casts(s, 'Test Titania', 2);
    s = castFromHand(s, 'Test Angel Storm');
    s = resolveAll(s);
    expect(tokens(s)).toHaveLength(3);
    expect(s.players.find((p) => p.id === 'p1')!.turnStats.spellsCast).toBe(1);
  });
  it('CR 903.8: no cast of the commander yet: no copy, one Angel', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [STORM], p1: { battlefield: forests(5), hand: ['Test Angel Storm'] } });
    s = castFromHand(s, 'Test Angel Storm');
    s = resolveAll(s);
    expect(tokens(s)).toHaveLength(1);
  });
  it('CR 702.124d: with partners, the casts of both commanders count ("your commander" is either one, CR 702.124e)', () => {
    const KRAUM = legend('Test Kraum', '{R}', ['1', '1'], ['R']);
    let s = commanderScenario({ p1Commanders: [TITANIA, KRAUM], p2Commanders: [BOB], defs: [STORM], p1: { battlefield: forests(5), hand: ['Test Angel Storm'] } });
    s = tweak(s, (t) => { commanderRec(t, 'p1', 'Test Titania').casts = 1; commanderRec(t, 'p1', 'Test Kraum').casts = 1; });
    s = castFromHand(s, 'Test Angel Storm');
    s = resolveAll(s);
    expect(tokens(s)).toHaveLength(3);
  });
});

describe('CR 603.7, 707.10, 903.8: "When you next cast an instant or sorcery spell this turn, copy it for each time you\'ve cast your commander ..."', () => {
  const DRAKE = card('Test Thunder Drake', '{3}{G}', 'Creature — Drake', '{2}{G}, Sacrifice this creature: When you next cast an instant or sorcery spell this turn, copy it for each time you\'ve cast your commander from the command zone this game. You may choose new targets for the copies.', ['2', '3']);
  const GROWTH = card('Test Growth', '{G}', 'Instant', 'You gain 1 life.');
  it('is understood, and the copies are made when the next instant is cast', () => {
    expect(manualFree(DRAKE)).toBe(true);
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [DRAKE, GROWTH], p1: { battlefield: [...forests(4), 'Test Thunder Drake'], hand: ['Test Growth'] } });
    s = casts(s, 'Test Titania', 2);
    const src = find(s, 'Test Thunder Drake', 'battlefield', 'p1');
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === src)!;
    s = resolveAll(drive(act(s, a.action)));
    const life0 = s.players.find((p) => p.id === 'p1')!.life;
    s = resolveAll(castFromHand(s, 'Test Growth'));
    expect(s.players.find((p) => p.id === 'p1')!.life).toBe(life0 + 3);
  });
});

describe('CR 903.3d, 903.3e: "your commander" as the subject of a trigger event', () => {
  const HERALD = card('Test Crowning Herald', '{2}{G}', 'Enchantment', 'Whenever your commander enters, you become the monarch.');
  const WATCH = card('Test Commander Watch', '{2}{G}', 'Enchantment', 'Whenever you attack with your commander, create a 1/1 green Elf creature token.');
  const SCAR = card('Test Scar Counter', '{2}', 'Artifact Creature — Construct', 'Whenever your commander deals combat damage to a player, put a +1/+1 counter on this creature.', ['1', '1']);
  it('the cards are understood', () => { for (const d of [HERALD, WATCH, SCAR]) expect(manualFree(d), d.name).toBe(true); });
  it('CR 903.3e: your commander entering the battlefield makes you the monarch; a noncommander creature does not', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [HERALD, BEAR], p1: { battlefield: [...forests(4), 'Test Crowning Herald'], hand: ['Test Bear'] } });
    s = resolveAll(castFromHand(s, 'Test Bear'));
    expect(s.designations?.monarch).toBeUndefined();
    s = resolveAll(castFromCommand(s, 'Test Titania'));
    expect(s.designations?.monarch).toBe('p1');
  });
  it('CR 508.1, 903.3d: attacking with your commander triggers once; attacking without it does not', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [WATCH, BEAR], p1: { battlefield: ['Test Commander Watch', { name: 'Test Titania' }, { name: 'Test Bear' }] } });
    s = commanderOnBattlefield(s, 'Test Titania');
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[find(s, 'Test Titania', 'battlefield', 'p1'), 'p2'], [find(s, 'Test Bear', 'battlefield', 'p1'), 'p2']]);
    s = resolveAll(drive(s));
    expect(tokens(s)).toHaveLength(1);
    let t = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [WATCH, BEAR], p1: { battlefield: ['Test Commander Watch', { name: 'Test Bear' }] } });
    t = toDeclareAttackers(t);
    t = declareAttackers(t, [[find(t, 'Test Bear', 'battlefield', 'p1'), 'p2']]);
    t = resolveAll(drive(t));
    expect(tokens(t)).toHaveLength(0);
  });
  it('CR 510.2, 903.3e: combat damage your commander deals to a player puts a counter on the creature', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [SCAR], p1: { battlefield: ['Test Scar Counter', { name: 'Test Titania' }] } });
    s = commanderOnBattlefield(s, 'Test Titania');
    s = toDeclareAttackers(s);
    s = declareAttackers(s, [[find(s, 'Test Titania', 'battlefield', 'p1'), 'p2']]);
    s = passUntil(drive(s), (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'the end of combat', 80);
    s = resolveAll(s);
    expect(s.objects[find(s, 'Test Scar Counter', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 903.3d, 613.4c: "where X is the greatest mana value of a commander you own on the battlefield or in the command zone"', () => {
  const KILL = card('Test Cloud Kill', '{4}{G}{G}', 'Sorcery', 'All creatures get -X/-X until end of turn, where X is the greatest mana value of a commander you own on the battlefield or in the command zone.');
  it('is understood', () => expect(manualFree(KILL)).toBe(true));
  it('CR 903.3d: the commander in the command zone (mana value 2): a 2/2 dies, a 3/3 is 1/1', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [KILL, BEAR, OX], p1: { battlefield: forests(6), hand: ['Test Cloud Kill'] }, p2: { battlefield: ['Test Bear', 'Test Ox'] } });
    s = resolveAll(castFromHand(s, 'Test Cloud Kill'));
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(0);
    expect(ptOf(s, find(s, 'Test Ox', 'battlefield', 'p2'))).toBe('1/1');
  });
  it('CR 903.3d: a commander in the graveyard does not count (X is 0); an opponent\'s commander never does', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [KILL, BEAR], p1: { battlefield: forests(6), hand: ['Test Cloud Kill'] }, p2: { battlefield: ['Test Bear'] } });
    s = tweak(s, (t) => {
      const id = t.zones.command.find((x) => t.objects[x]!.defId === TITANIA.id)!;
      t.zones.command = t.zones.command.filter((x) => x !== id);
      t.objects[id]!.zone = 'graveyard';
      t.zones.graveyard['p1']!.push(id);
    });
    s = resolveAll(castFromHand(s, 'Test Cloud Kill'));
    expect(ptOf(s, find(s, 'Test Bear', 'battlefield', 'p2'))).toBe('2/2');
  });
});

describe('CR 702.173a: freerunning (you dealt combat damage to a player this turn with an Assassin or commander)', () => {
  const GUARDS = card('Test Guard Distraction', '{5}{G}', 'Sorcery', 'Freerunning {G} (You may cast this spell for its freerunning cost if you dealt combat damage to a player this turn with an Assassin or commander.)\nCreate three 1/1 white Human Rogue creature tokens.');
  const ASSASSIN = card('Test Assassin', '{1}{B}', 'Creature — Human Assassin', '', ['1', '1']);
  const tryFree = (s: GameState) => applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Guard Distraction', 'hand', 'p1'), method: 'freerunning' });
  const combat = (s0: GameState, attacker: string): GameState => {
    let s = toDeclareAttackers(s0);
    s = declareAttackers(s, [[find(s, attacker, 'battlefield', 'p1'), 'p2']]);
    return passUntil(drive(s), (x) => x.turn.step === 'main2' && x.pending?.kind === 'priority', 'the second main phase', 80);
  };
  it('is understood', () => expect(manualFree(GUARDS)).toBe(true));
  it('CR 702.173a: before any combat damage the freerunning cost is refused', () => {
    const s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [GUARDS], p1: { battlefield: forests(1), hand: ['Test Guard Distraction'] } });
    expect(tryFree(s).error).toBeDefined();
  });
  it('CR 702.173a, 903.3: after your commander dealt combat damage to a player, it can be cast for its freerunning cost', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [GUARDS], p1: { battlefield: [...forests(1), { name: 'Test Titania' }], hand: ['Test Guard Distraction'] } });
    s = commanderOnBattlefield(s, 'Test Titania');
    s = combat(s, 'Test Titania');
    const r = tryFree(s);
    expect(r.error).toBeUndefined();
    s = resolveAll(drive(r.state));
    expect(tokens(s)).toHaveLength(3);
  });
  it('CR 702.173a: an Assassin that dealt combat damage enables it too; a creature that is neither does not', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [GUARDS, ASSASSIN], p1: { battlefield: [...forests(1), { name: 'Test Assassin' }], hand: ['Test Guard Distraction'] } });
    s = combat(s, 'Test Assassin');
    expect(tryFree(s).error).toBeUndefined();
    let t = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [GUARDS, BEAR], p1: { battlefield: [...forests(1), { name: 'Test Bear' }], hand: ['Test Guard Distraction'] } });
    t = combat(t, 'Test Bear');
    expect(tryFree(t).error).toBeDefined();
  });
});

describe('CR 700.2, 601.2b: "Choose one. If you control a commander as you cast this spell, you may choose both instead."', () => {
  const WILL = card('Test Twin Will', '{2}{G}', 'Instant', 'Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• You gain 2 life.\n• Draw a card.');
  const modeDecision = (s: GameState) => { const t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Twin Will', 'hand', 'p1') }); return t.pending; };
  it('is understood', () => expect(manualFree(WILL)).toBe(true));
  it('CR 601.2b: controlling your commander as it is cast: one or both modes', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [WILL], p1: { battlefield: [...forests(3), { name: 'Test Titania' }], hand: ['Test Twin Will'] } });
    s = commanderOnBattlefield(s, 'Test Titania');
    expect(modeDecision(s)).toMatchObject({ kind: 'chooseOption', min: 1, max: 2 });
  });
  it('CR 903.3d: not controlling a commander (yours is in the command zone): one mode only', () => {
    const s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [WILL], p1: { battlefield: forests(3), hand: ['Test Twin Will'] } });
    expect(modeDecision(s)).toMatchObject({ kind: 'chooseOption', min: 1, max: 1 });
  });
});

describe('CR 702.6c, 903.3d: "Equip commander {N}"', () => {
  const SUIT = card('Test Molecule Suit', '{2}', 'Artifact — Equipment', 'Equipped creature gets +2/+2 and has indestructible.\nEquip commander {1}\nEquip {4}');
  it('is understood', () => expect(manualFree(SUIT)).toBe(true));
  it('CR 702.6c: equip commander {1} can target only a commander creature you control; equip {4} any creature you control', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [SUIT, BEAR], p1: { battlefield: [...forests(4), 'Test Molecule Suit', { name: 'Test Titania' }, { name: 'Test Bear' }] } });
    s = commanderOnBattlefield(s, 'Test Titania');
    const suit = find(s, 'Test Molecule Suit', 'battlefield', 'p1');
    const equips = legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object === suit);
    expect(equips).toHaveLength(2);
    const cheap = equips.find((a) => /\{1\}/.test(a.label))!;
    const t = act(s, cheap.action);
    expect(t.pending?.kind).toBe('chooseTargets');
    const legalTargets = JSON.stringify(t.pending);
    expect(legalTargets).toContain(find(s, 'Test Titania', 'battlefield', 'p1'));
    expect(legalTargets).not.toContain(`"${find(s, 'Test Bear', 'battlefield', 'p1')}"`);
  });
});

describe('CR 903.3d, 613.4c, 613.1f: lieutenant "As long as you control your commander, ~ gets +2/+2 and other creatures you control get +2/+2 and have trample."', () => {
  const BALOTH = card('Test Thunder Baloth', '{4}{G}{G}', 'Creature — Beast', 'Trample\nLieutenant — As long as you control your commander, this creature gets +2/+2 and other creatures you control get +2/+2 and have trample.', ['5', '5']);
  it('is understood', () => expect(manualFree(BALOTH)).toBe(true));
  it('CR 903.3d: controlling the commander: the Baloth is 7/7, the other creatures +2/+2 with trample; without it, nothing', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [BALOTH, BEAR], p1: { battlefield: ['Test Thunder Baloth', 'Test Bear', { name: 'Test Titania' }] } });
    s = commanderOnBattlefield(s, 'Test Titania');
    expect(ptOf(s, find(s, 'Test Thunder Baloth', 'battlefield', 'p1'))).toBe('7/7');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(ptOf(s, bear)).toBe('4/4');
    expect(hasKeyword(getChars(s, bear)!, 'trample')).toBe(true);
    expect(ptOf(s, find(s, 'Test Titania', 'battlefield', 'p1'))).toBe('4/4');
    const t = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [BALOTH, BEAR], p1: { battlefield: ['Test Thunder Baloth', 'Test Bear'] } });
    expect(ptOf(t, find(t, 'Test Thunder Baloth', 'battlefield', 'p1'))).toBe('5/5');
    expect(ptOf(t, find(t, 'Test Bear', 'battlefield', 'p1'))).toBe('2/2');
  });
});

describe('CR 701.8a, 903.3: "Destroy all creatures and planeswalkers except for commanders."', () => {
  const SLASH = card('Test Rank Slash', '{3}{G}{G}', 'Sorcery', 'Destroy all creatures and planeswalkers except for commanders.');
  it('is understood', () => expect(manualFree(SLASH)).toBe(true));
  it('CR 903.3: the commanders survive (yours and an opponent\'s), the other creatures are destroyed', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [SLASH, BEAR], p1: { battlefield: [...forests(5), { name: 'Test Titania' }, 'Test Bear'], hand: ['Test Rank Slash'] }, p2: { battlefield: [{ name: 'Test Bob Commander' }, 'Test Bear'] } });
    s = commanderOnBattlefield(commanderOnBattlefield(s, 'Test Titania'), 'Test Bob Commander');
    s = resolveAll(castFromHand(s, 'Test Rank Slash'));
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Titania', 'battlefield')).toHaveLength(1);
    expect(findAll(s, 'Test Bob Commander', 'battlefield')).toHaveLength(1);
  });
});

describe('CR 702.152a: blitz', () => {
  const RAIDER = card('Test Blitz Raider', '{3}{G}', 'Creature — Devil', 'Blitz {1}{G} (If you cast this spell for its blitz cost, it gains haste and "When this creature dies, draw a card." Sacrifice it at the beginning of the next end step.)', ['3', '2']);
  const castBlitz = (s: GameState, from: 'hand' | 'command' = 'hand'): GameState => {
    const id = from === 'hand' ? find(s, 'Test Blitz Raider', 'hand', 'p1') : inCommand(s, 'Test Blitz Raider');
    const r = applyAction(s, { type: 'cast', player: 'p1', card: id, method: 'blitz' });
    if (r.error) throw new Error(r.error.message);
    return answerUntilPriority(r.state);
  };
  const toEndStep = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 80 && !(s.turn.step === 'end' && s.pending?.kind === 'priority'); i++) {
      s = s.pending?.kind === 'declareAttackers' ? answer(s, { kind: 'declareAttackers', attacks: [] }) : s.pending?.kind === 'priority' ? pass(s) : drive(s);
    }
    return s;
  };
  it('is understood', () => expect(manualFree(RAIDER)).toBe(true));
  it('CR 702.152a: cast for its blitz cost it has haste; at the beginning of the next end step it is sacrificed, and its dies trigger draws a card', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [RAIDER], p1: { battlefield: forests(2), hand: ['Test Blitz Raider'] } });
    s = resolveAll(castBlitz(s));
    const raider = find(s, 'Test Blitz Raider', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, raider)!, 'haste')).toBe(true);
    const hand0 = s.zones.hand['p1']!.length;
    s = resolveAll(toEndStep(s));
    expect(findAll(s, 'Test Blitz Raider', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Blitz Raider', 'graveyard', 'p1')).toHaveLength(1);
    expect(s.zones.hand['p1']!.length).toBe(hand0 + 1);
  });
  it('CR 702.152a: cast for its mana cost it has no haste, stays, and dying draws nothing', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [RAIDER], p1: { battlefield: forests(4), hand: ['Test Blitz Raider'] } });
    s = resolveAll(castFromHand(s, 'Test Blitz Raider'));
    const raider = find(s, 'Test Blitz Raider', 'battlefield', 'p1');
    expect(hasKeyword(getChars(s, raider)!, 'haste')).toBe(false);
    s = resolveAll(toEndStep(s));
    expect(findAll(s, 'Test Blitz Raider', 'battlefield')).toHaveLength(1);
  });
  it('CR 903.8, 118.9d: a blitz commander cast from the command zone pays its blitz cost plus the commander tax', () => {
    const BLITZ_CMDR = { ...RAIDER, colorIdentity: ['G'] } as CardDef;
    let s = commanderScenario({ p1Commanders: [BLITZ_CMDR], p2Commanders: [BOB], p1: { battlefield: forests(4) } });
    s = casts(s, 'Test Blitz Raider', 1);
    s = castBlitz(s, 'command');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(4); // {1}{G} + {2} tax
    expect(commanderRec(s, 'p1', 'Test Blitz Raider').casts).toBe(2);
  });
});

describe('CR 903.8, 119.4: "Rather than pay {2} for each previous time you\'ve cast this spell from the command zone this game, pay 2 life that many times."', () => {
  const SHROUD = legend('Test Shroud Angel', '{1}{G}', ['2', '2'], ['G'], 'Flying\nRather than pay {2} for each previous time you\'ve cast this spell from the command zone this game, pay 2 life that many times.', 'Legendary Creature — Angel');
  const life = (s: GameState): number => s.players.find((p) => p.id === 'p1')!.life;
  it('is understood', () => expect(manualFree(SHROUD)).toBe(true));
  it('CR 903.8: the third cast from the command zone costs its mana cost and 4 life, no extra mana', () => {
    let s = commanderScenario({ p1Commanders: [SHROUD], p2Commanders: [BOB], p1: { battlefield: forests(3) } });
    s = casts(s, 'Test Shroud Angel', 2);
    s = castFromCommand(s, 'Test Shroud Angel');
    expect(life(s)).toBe(36);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(2);
    expect(commanderRec(s, 'p1', 'Test Shroud Angel').casts).toBe(3);
  });
  it('CR 903.8: the first cast pays no tax, in mana or life', () => {
    let s = commanderScenario({ p1Commanders: [SHROUD], p2Commanders: [BOB], p1: { battlefield: forests(2) } });
    s = castFromCommand(s, 'Test Shroud Angel');
    expect(life(s)).toBe(40);
  });
  it('CR 903.8: a commander without the ability still pays its tax in mana', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], p1: { battlefield: forests(4) } });
    s = casts(s, 'Test Titania', 1);
    s = castFromCommand(s, 'Test Titania');
    expect(life(s)).toBe(40);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(4);
  });
});

describe('CR 115.4, 903.3: "any target that isn\'t a commander"', () => {
  const LEGACY = card('Test Dragon Legacy', '{3}{G}', 'Creature — Dragon', '{T}: This creature deals 1 damage to any target that isn\'t a commander.', ['3', '3']);
  it('is understood', () => expect(manualFree(LEGACY)).toBe(true));
  it('CR 115.4: a commander creature is not a legal target; a noncommander creature and a player are', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [LEGACY, BEAR], p1: { battlefield: ['Test Dragon Legacy'] }, p2: { battlefield: [{ name: 'Test Bob Commander' }, 'Test Bear'] } });
    s = commanderOnBattlefield(s, 'Test Bob Commander');
    const src = find(s, 'Test Dragon Legacy', 'battlefield', 'p1');
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === src)!;
    const t = act(s, a.action);
    expect(t.pending?.kind).toBe('chooseTargets');
    const offered = JSON.stringify(t.pending);
    expect(offered).toContain(`"${find(s, 'Test Bear', 'battlefield', 'p2')}"`);
    expect(offered).not.toContain(`"${find(s, 'Test Bob Commander', 'battlefield', 'p2')}"`);
    expect(offered).toContain('"p2"');
  });
});

describe('CR 903.3d, 613.4c: "~ gets +2/+0 as long as you control a commander that\'s a creature or planeswalker."', () => {
  const MERFOLK = card('Test Harbor Merfolk', '{1}{G}', 'Creature — Merfolk Rogue', 'This creature can\'t be blocked.\nThis creature gets +2/+0 as long as you control a commander that\'s a creature or planeswalker.', ['1', '2']);
  it('is understood', () => expect(manualFree(MERFOLK)).toBe(true));
  it('CR 903.3d: with your commander creature on the battlefield it is 3/2; with the commander in the command zone 1/2', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [MERFOLK], p1: { battlefield: ['Test Harbor Merfolk', { name: 'Test Titania' }] } });
    s = commanderOnBattlefield(s, 'Test Titania');
    expect(ptOf(s, find(s, 'Test Harbor Merfolk', 'battlefield', 'p1'))).toBe('3/2');
    const t = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [MERFOLK], p1: { battlefield: ['Test Harbor Merfolk'] } });
    expect(ptOf(t, find(t, 'Test Harbor Merfolk', 'battlefield', 'p1'))).toBe('1/2');
  });
  it('CR 903.3d: an opponent\'s commander does not count (you control it only when it is yours to control)', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [MERFOLK], p1: { battlefield: ['Test Harbor Merfolk'] }, p2: { battlefield: [{ name: 'Test Bob Commander' }] } });
    s = commanderOnBattlefield(s, 'Test Bob Commander');
    expect(ptOf(s, find(s, 'Test Harbor Merfolk', 'battlefield', 'p1'))).toBe('1/2');
  });
});

describe('wave-4 merge: freerunning\'s condition is read by the one reader of this turn\'s history at announcement (model/forms.ts#turnHistoryAtAnnouncement)', () => {
  const FREE: Condition = {
    cond: 'happened', scope: 'turn',
    event: { ev: 'damage', combat: true, source: { anyOf: [{ subtypes: ['Assassin'] }, { commander: true }], controller: 'you' }, recipient: { player: 'any' } },
  };
  const withEvent = (e: Record<string, unknown>): Condition => ({ ...FREE, event: { ...(FREE as { event: object }).event, ...e } } as Condition);
  it('CR 702.173a, 510.2: combat damage to a player this turn is readable in an alternative cost\'s "if" (the mode position), under announce.happened.turn', () => {
    expect(announceReadable(FREE, 'mode')).toBe(true);
    expect(announceCondForms(FREE, 'mode')).toContain('feature:announce.happened.turn');
  });
  it('outside an activation restriction, damage that is not combat damage stays unread (it can be dealt while a spell resolves, before the history is written)', () => {
    expect(announceReadable(withEvent({ combat: undefined }), 'mode')).toBe(false);
    expect(announceReadable(withEvent({ combat: false }), 'mode')).toBe(false);
  });
  it('a source filter field the history facts do not answer stays unread (rules/history.ts#factsMatchFilter would throw)', () => {
    expect(announceReadable(withEvent({ source: { tapped: true } }), 'mode')).toBe(false);
  });
});
