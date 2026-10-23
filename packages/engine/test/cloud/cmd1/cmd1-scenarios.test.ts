/**
 * Commander batch, slice cmd1 (partner variants and Backgrounds, CR 702.124): the keyword data, templates, quoted-ability lowering and renderer support of
 * parser/templates/zz-cloud/cmd1.json, played through the engine in two-player Commander games (CR 903.2) with synthetic cards compiled by the game's default
 * compiler (invented names, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 702.124a, 702.124i       "Partner--[text]": a keyword with no game effect; two commanders with the same text start in the command zone
 *   CR 702.124k, 702.124m       "Choose a Background", "Doctor's companion": keywords with no game effect
 *   CR 903.3d, 613.1f, 702.21a  a Background: "Commander creatures you own get +N/+N and have ..., "Ward--Pay N life," and "At the beginning of your upkeep, ...""
 *   CR 603.2h, 603.4            a granted quoted trigger with a limit ("This ability triggers only once each turn") and an intervening "if"
 *   CR 701.21a, 118.3           "Sacrifice another creature or an artifact" as a cost
 *   CR 614.1c, 614.12           a granted "This creature enters with an additional +1/+1 counter on it" and "Other creatures you control enter with ..."
 *   CR 613.4c, 107.3            "This creature gets +X/+0, where X is ..."
 */
import { describe, expect, it } from 'vitest';
import { commanderTax, type CardDef, type GameState, type ObjectId } from '../../../src/index';
import { getChars, hasKeyword as charsHave } from '../../../src/rules/characteristics';
import {
  act, answerUntilPriority, card, commanderOnBattlefield, commanderScenario, find, findAll, inCommand, legend, pass,
} from '../../m11/rules/helpers';
import { legal } from '../../m3/scenario';

const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const hasKeyword = (s: GameState, id: ObjectId, k: string): boolean => charsHave(getChars(s, id)!, k);

/** Pass (no attacks, no blocks) until the given turn's step has begun with priority. */
function toTurnStep(s0: GameState, turn: number, step: GameState['turn']['step']): GameState {
  let s = s0;
  for (let i = 0; i < 200; i++) {
    if (s.turn.number === turn && s.turn.step === step && s.pending?.kind === 'priority') return s;
    const d = s.pending!;
    if (d.kind === 'declareAttackers') s = answerUntilPriority(s, [{ kind: 'declareAttackers', attacks: [] }]);
    else if (d.kind === 'declareBlockers') s = answerUntilPriority(s, [{ kind: 'declareBlockers', blocks: [] }]);
    else if (d.kind === 'priority') s = pass(s);
    else s = drive(s);
  }
  throw new Error(`never reached turn ${turn} ${step}`);
}

/** Answer what is asked (payment automatic; yes to "may"; the first legal target or object) until priority. */
function drive(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 40 && s.pending && s.pending.kind !== 'priority'; i++) {
    const d = s.pending;
    if (d.kind === 'payCost') s = answerUntilPriority(s, []);
    else if (d.kind === 'yesNo') s = answerUntilPriority(s, [{ kind: 'yesNo', yes: true }]);
    else if (d.kind === 'chooseTargets') s = answerUntilPriority(s, [{ kind: 'chooseTargets', targets: d.players.length > 0 ? [{ kind: 'player', id: d.players[d.players.length - 1]! }] : [{ kind: 'object', id: d.objects[0]! }] }]);
    else if (d.kind === 'chooseObjects') s = answerUntilPriority(s, [{ kind: 'chooseObjects', ids: d.options.slice(0, Math.max(d.min, 1)) }]);
    else if (d.kind === 'commanderZone') s = answerUntilPriority(s, [{ kind: 'commanderZone', command: true }]);
    else throw new Error(`unexpected decision ${d.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState): GameState => {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)));
  return s;
};
const castFromHand = (s: GameState, name: string): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') })));
const castCommander = (s: GameState, name: string): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: inCommand(s, name) })));

const FOREVER_A = legend('Test Ardent Friend', '{0}', ['2', '2'], ['R'], 'Partner—Friends forever (You can have two commanders if both have this ability.)', 'Legendary Creature — Human');
const FOREVER_B = legend('Test Loyal Friend', '{0}', ['1', '3'], ['U'], 'Haste\nPartner—Friends forever (You can have two commanders if both have this ability.)', 'Legendary Creature — Human');
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);

describe('CR 702.124a, 702.124i: "Partner--Friends forever" is a partner ability with no game effect', () => {
  it('compiles to the partner keyword with its text as a label, fully automated', () => {
    expect(FOREVER_A.automation.level).toBe('full');
    expect(FOREVER_A.faces[0]!.abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'partner', quality: 'friends forever' });
    expect(FOREVER_B.faces[0]!.abilities[1]).toMatchObject({ kind: 'keyword', keyword: 'partner', quality: 'friends forever' });
  });
  it('CR 903.6, 702.124d: both commanders start in the command zone; each has its own tax', () => {
    let s = commanderScenario({ p1Commanders: [FOREVER_A, FOREVER_B], p2Commanders: [BOB] });
    const a = inCommand(s, 'Test Ardent Friend');
    inCommand(s, 'Test Loyal Friend');
    expect(commanderTax(s, s.objects[a]!.cardId)).toBe(0);
    s = castCommander(s, 'Test Ardent Friend');
    const onBf = find(s, 'Test Ardent Friend', 'battlefield');
    expect(pt(s, onBf)).toBe('2/2');
    expect(commanderTax(s, s.objects[onBf]!.cardId)).toBe(2); // CR 903.8: one cast from the command zone
    expect(commanderTax(s, s.objects[inCommand(s, 'Test Loyal Friend')]!.cardId)).toBe(0); // CR 702.124d: the other commander counts its own casts
  });
});

describe('CR 702.124k, 702.124m: "Choose a Background" and "Doctor\'s companion" are keywords with no game effect', () => {
  it('compile to keywords and leave nothing manual', () => {
    const chooser = legend('Test Chooser', '{1}{R}', ['3', '2'], ['R'], 'Trample\nChoose a Background (You can have a Background as a second commander.)');
    const companion = legend('Test Companion', '{W}', ['1', '2'], ['W'], "Vigilance\nDoctor's companion (You can have two commanders if the other is the Doctor.)", 'Legendary Creature — Human');
    expect(chooser.automation.level).toBe('full');
    expect(companion.automation.level).toBe('full');
    expect(chooser.faces[0]!.abilities[1]).toMatchObject({ kind: 'keyword', keyword: 'choose a background' });
    expect(companion.faces[0]!.abilities[1]).toMatchObject({ kind: 'keyword', keyword: "doctor's companion" });
  });
});

const CHOOSER = legend('Test Background Chooser', '{0}', ['2', '2'], ['B'], 'Choose a Background (You can have a Background as a second commander.)');
const CULT = card('Test Shadow Upbringing', '{0}', 'Legendary Enchantment — Background',
  'Commander creatures you own get +2/+2 and have menace, deathtouch, "Ward—Pay 2 life," and "At the beginning of your upkeep, sacrifice a creature."');

describe('CR 903.3d, 613.1f, 613.4c: a Background grants its abilities to the commander creatures its owner owns', () => {
  it('is understood (the quoted ward keyword with its dash cost is one of the granted abilities, CR 702.21a)', () => expect(noManual(CULT)).toBe(true));
  it('CR 702.124k, 903.3d: the Background is the second commander; the commander creature gets +2/+2, menace, deathtouch and ward; another creature does not', () => {
    let s = commanderScenario({ p1Commanders: [CHOOSER, CULT], p2Commanders: [BOB], cards: ['Grizzly Bears'], p1: { battlefield: ['Grizzly Bears'] } });
    s = castCommander(s, 'Test Shadow Upbringing');
    s = castCommander(s, 'Test Background Chooser');
    const cmd = find(s, 'Test Background Chooser', 'battlefield');
    expect(pt(s, cmd)).toBe('4/4');
    for (const k of ['menace', 'deathtouch', 'ward']) expect(hasKeyword(s, cmd, k), k).toBe(true);
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    expect(pt(s, bears)).toBe('2/2');
    expect(hasKeyword(s, bears, 'menace')).toBe(false);
  });
  it('CR 903.3d: an opponent\'s commander is not a commander creature you own', () => {
    let s = commanderScenario({ p1Commanders: [CHOOSER, CULT], p2Commanders: [BOB], p2: { battlefield: ['Test Bob Commander'] } });
    s = commanderOnBattlefield(s, 'Test Bob Commander');
    s = castCommander(s, 'Test Shadow Upbringing');
    expect(pt(s, find(s, 'Test Bob Commander', 'battlefield'))).toBe('1/1');
  });
  it('CR 603.2, 701.21a: the granted upkeep trigger makes the commander\'s controller sacrifice a creature', () => {
    let s = commanderScenario({ p1Commanders: [CHOOSER, CULT], p2Commanders: [BOB], cards: ['Grizzly Bears'], p1: { battlefield: ['Grizzly Bears'] } });
    s = castCommander(s, 'Test Shadow Upbringing');
    s = castCommander(s, 'Test Background Chooser');
    s = toTurnStep(s, 3, 'upkeep');
    s = resolveAll(drive(s));
    const left = findAll(s, 'Grizzly Bears', 'battlefield').length + findAll(s, 'Test Background Chooser', 'battlefield').length;
    expect(left).toBe(1);
  });
});

const KIN = card('Test Kinship Tale', '{0}', 'Legendary Enchantment — Background',
  'Commander creatures you own have "Whenever you cast a spell that shares a creature type with this creature, draw a card. This ability triggers only once each turn."');
const ELF_CHOOSER = legend('Test Elf Chooser', '{0}', ['2', '2'], ['G'], 'Choose a Background (You can have a Background as a second commander.)', 'Legendary Creature — Elf Druid');

describe('CR 603.2h: a granted quoted trigger keeps "This ability triggers only once each turn"', () => {
  it('is understood: the limit is the granted ability\'s, not an effect sentence', () => {
    expect(noManual(KIN)).toBe(true);
    expect(JSON.stringify(KIN.faces[0]!.abilities[0])).toContain('"limit":{"per":"turn","max":1}');
  });
  it('CR 603.2h: two Elf spells in one turn draw one card', () => {
    let s = commanderScenario({ p1Commanders: [ELF_CHOOSER, KIN], p2Commanders: [BOB], cards: ['Llanowar Elves', 'Elvish Visionary'], p1: { hand: ['Llanowar Elves', 'Elvish Visionary'], battlefield: [{ name: 'Forest' }, { name: 'Forest' }, { name: 'Forest' }] } });
    s = castCommander(s, 'Test Kinship Tale');
    s = castCommander(s, 'Test Elf Chooser');
    const h0 = handSize(s, 'p1');
    s = castFromHand(s, 'Llanowar Elves');
    expect(handSize(s, 'p1')).toBe(h0 - 1 + 1);
    s = castFromHand(s, 'Elvish Visionary');
    expect(handSize(s, 'p1')).toBe(h0 - 2 + 1 + 1); // Elvish Visionary's own enters trigger draws a card; the granted trigger does not trigger again
  });
});

describe('CR 603.4: a quoted trigger with an intervening "if" is read like a printed one', () => {
  const T = card('Test Watchful Grant', '{0}', 'Enchantment', 'Creatures you control have "At the beginning of your upkeep, if you control three or more artifacts, draw a card."');
  it('the condition is the granted ability\'s intervening "if" (checked as it triggers and as it resolves), not an effect-level "if"', () => {
    expect(noManual(T)).toBe(true);
    const granted = JSON.stringify(T.faces[0]!.abilities[0]);
    expect(granted).toContain('"interveningIf":');
    expect(granted).not.toContain('"op":"if"');
  });
});

const URCHIN = card('Test Alley Upbringing', '{0}', 'Legendary Enchantment — Background',
  'Commander creatures you own have "{1}, Sacrifice another creature or an artifact: This creature deals 2 damage to any target."');

describe('CR 701.21a, 118.3: "Sacrifice another creature or an artifact" is one permanent of either description', () => {
  it('is understood', () => expect(noManual(URCHIN)).toBe(true));
  it('CR 118.3: an artifact pays it; the commander deals the damage', () => {
    let s = commanderScenario({ p1Commanders: [CHOOSER, URCHIN], p2Commanders: [BOB], cards: ['Ornithopter'], p1: { battlefield: ['Ornithopter', { name: 'Forest' }] } });
    s = castCommander(s, 'Test Alley Upbringing');
    s = castCommander(s, 'Test Background Chooser');
    const cmd = find(s, 'Test Background Chooser', 'battlefield');
    const a = legal(s, 'p1', 'activate').find((x) => x.object === cmd);
    expect(a).toBeDefined();
    const life0 = s.players.find((p) => p.id === 'p2')!.life;
    s = resolveAll(drive(act(s, a!.action)));
    expect(findAll(s, 'Ornithopter', 'battlefield')).toHaveLength(0);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(life0 - 2);
  });
});

const CHEF = card('Test Feast Upbringing', '{0}', 'Legendary Enchantment — Background',
  'Commander creatures you own have "This creature enters with an additional +1/+1 counter on it" and "Other creatures you control enter with an additional +1/+1 counter on them."');

describe('CR 614.1c, 614.12: granted "enters with an additional +1/+1 counter" abilities', () => {
  it('is understood', () => expect(noManual(CHEF)).toBe(true));
  it('CR 614.12: the commander enters with the counter (the Background\'s effect already applies to it as it would exist on the battlefield); another creature too', () => {
    let s = commanderScenario({ p1Commanders: [CHOOSER, CHEF], p2Commanders: [BOB], cards: ['Grizzly Bears'], p1: { hand: ['Grizzly Bears'], battlefield: [{ name: 'Forest' }, { name: 'Forest' }] } });
    s = castCommander(s, 'Test Feast Upbringing');
    s = castCommander(s, 'Test Background Chooser');
    const cmd = find(s, 'Test Background Chooser', 'battlefield');
    expect(s.objects[cmd]!.counters['+1/+1']).toBe(1);
    s = castFromHand(s, 'Grizzly Bears');
    expect(s.objects[find(s, 'Grizzly Bears', 'battlefield')]!.counters['+1/+1']).toBe(1);
  });
});

const PAST = card('Test Grim Upbringing', '{0}', 'Legendary Enchantment — Background',
  'Commander creatures you own have menace and "This creature gets +X/+0, where X is the number of creature cards in your graveyard."');

describe('CR 613.4c, 107.3: "This creature gets +X/+0, where X is the number of creature cards in your graveyard" (granted)', () => {
  it('CR 611.3a: the bonus follows the graveyard', () => {
    let s = commanderScenario({ p1Commanders: [CHOOSER, PAST], p2Commanders: [BOB], cards: ['Grizzly Bears', 'Forest'], p1: { graveyard: ['Grizzly Bears', 'Grizzly Bears', 'Forest'] } });
    s = castCommander(s, 'Test Grim Upbringing');
    s = castCommander(s, 'Test Background Chooser');
    const cmd = find(s, 'Test Background Chooser', 'battlefield');
    expect(pt(s, cmd)).toBe('4/2');
    expect(hasKeyword(s, cmd, 'menace')).toBe(true);
  });
});

const JO = legend('Test Cycle Teacher', '{0}', ['2', '2'], ['W'], 'Each historic card in your hand has cycling {1}.\nWhenever you cycle a card, put a +1/+1 counter on Test Cycle Teacher.', 'Legendary Creature — Human Soldier');

describe('CR 700.6, 702.29a, 613.1f: "Each historic card in your hand has cycling {1}."', () => {
  it('is understood: the historic filter is said by its one word', () => expect(noManual(JO)).toBe(true));
  it('CR 702.29a: an artifact card in hand can be cycled with the granted ability (a land card cannot); the cycle trigger puts a counter', () => {
    let s = commanderScenario({ p1Commanders: [JO], p2Commanders: [BOB], cards: ['Ornithopter', 'Grizzly Bears'], p1: { battlefield: ['Test Cycle Teacher', { name: 'Forest' }], hand: ['Ornithopter', 'Grizzly Bears'] } });
    const ornithopter = find(s, 'Ornithopter', 'hand', 'p1');
    const bears = find(s, 'Grizzly Bears', 'hand', 'p1');
    const acts = legal(s, 'p1', 'activate');
    expect(acts.some((x) => x.object === bears)).toBe(false); // not historic
    const cyc = acts.find((x) => x.object === ornithopter);
    expect(cyc).toBeDefined();
    const h0 = handSize(s, 'p1');
    s = resolveAll(drive(act(s, cyc!.action)));
    expect(s.objects[ornithopter]?.zone ?? 'graveyard').not.toBe('hand');
    expect(handSize(s, 'p1')).toBe(h0); // discarded one, drew one
    expect(s.objects[find(s, 'Test Cycle Teacher', 'battlefield')]!.counters['+1/+1']).toBe(1);
  });
});
