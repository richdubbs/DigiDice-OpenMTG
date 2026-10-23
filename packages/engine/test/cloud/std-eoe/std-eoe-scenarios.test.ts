/**
 * Cloud batch 2, slice std-eoe (the Standard backlog of Edge of Eternities, tuning half): the templates of parser/templates/zz-cloud/std-eoe.json and the parser,
 * renderer and engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and wordings,
 * design 6.10). Each test is named after the rule it checks.
 *
 *   CR 118.12a, 608.2c          "Counter target spell unless its controller pays {2}. If they do, you gain 3 life."
 *   CR 406.1, 608.2c, 601.2     "Exile cards from the top of your library until you exile a creature card. You may cast that card this turn." (op exileUntil)
 *   CR 115.1, 601.2c, 608.2c    "Whenever ~ attacks, choose up to one target creature. That creature can't be blocked this turn and has base power and toughness 1/1 ..."
 *   CR 608.2c, 608.2d           "If it's tapped, destroy it. Otherwise, tap it." (the "otherwise" sentence never sees what the other branch did)
 *   CR 608.2c, 701.20e          "... Put the rest on the bottom ... If you didn't put a card into your hand this way, put a +1/+1 counter on ~."
 *   CR 115.1, 601.2c            "Return up to two target creature cards with total mana value 3 or less from your graveyard to the battlefield."
 *   CR 700.4, 603.10a           "Whenever another creature you control dies or is put into exile, ..." / "When ~ dies or is put into exile while its power is 4 or greater"
 *   CR 115.1, 608.2e, 701.17a   "Destroy all artifacts, then any number of target players each mill half their library, rounded down." (one player at a time)
 *   CR 202.3, 608.2d, 613.1b    "Choose odd or even. Destroy each creature with mana value of the chosen quality. Then gain control of all creatures ... Untap them."
 *   CR 110.2, 508.4             "Whenever ~ attacks, put target creature card from defending player's graveyard onto the battlefield under your control tapped and attacking."
 *   CR 707.2, 111.4, 603.7      "Create X tokens that are copies of target creature you control. Sacrifice them at the beginning of the next end step."
 *   CR 608.2c, 400.7, 107.3a    "Destroy all creatures with toughness X or less. ... If X is 2 or more, return a creature card put into a graveyard this way to the battlefield ..."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { act, answer, battlefieldNames, find, findAll, legal, life, pass, scenario, zoneNames } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual (the level itself is checked by the template tests: an experimental template caps it, design 6.9). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
const yes: DecisionAnswer = { kind: 'yesNo', yes: true };
const no: DecisionAnswer = { kind: 'yesNo', yes: false };
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

/** Answer the decisions that come up: targets from `targets`, object choices from `picks`, then `answers`; pay costs automatically; stop at priority. */
function settle(s0: GameState, opts: { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] } = {}): GameState {
  let s = s0;
  const groups = [...(opts.targets ?? [])];
  const picks = [...(opts.picks ?? [])];
  const queue = [...(opts.answers ?? [])];
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && groups.length > 0) s = answer(s, { kind: 'chooseTargets', targets: groups.shift()! });
    else if (p.kind === 'chooseObjects' && picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: picks.shift()! });
    else if (queue.length > 0) s = answer(s, queue.shift()!);
    else break;
  }
  return s;
}
const cast = (s0: GameState, name: string, opts: Parameters<typeof settle>[1] = {}, who: PlayerId = 'p1'): GameState => settle(act(s0, { type: 'cast', player: who, card: find(s0, name, 'hand', who) }), opts);
/** Both players pass until the stack is empty, answering what comes up. */
function resolveAll(s0: GameState, opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = settle(pass(pass(s)), opts);
  return s;
}
const graveNames = (s: GameState, p: PlayerId = 'p1'): string[] => zoneNames(s, 'graveyard', p);
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId);
/** Go to the declare attackers step of the current turn and attack with the named creatures of p1 (each attacks p2). */
function attackWith(s0: GameState, names: string[], opts: Parameters<typeof settle>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 60 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s, opts);
  s = answer(s, { kind: 'declareAttackers', attacks: names.map((n) => ({ attacker: find(s, n, 'battlefield', 'p1'), defender: 'p2' })) } as DecisionAnswer);
  return settle(s, opts);
}
const keyword = (s: GameState, id: ObjectId, k: string): boolean => hasKeyword(getChars(s, id)!, k);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'], cost: '{2}{R}' });
const ROCK = card('Test Rock', 'Artifact', '', { cost: '{1}' });
const GAIN = card('Test Gain', 'Instant', 'You gain 2 life.');

describe('CR 118.12a, 608.2c: "Counter target spell unless its controller pays {2}. If they do, you gain 3 life."', () => {
  const TAX = card('Test Tax', 'Instant', 'Counter target spell unless its controller pays {2}. If they do, you gain 3 life.');
  it('is understood: the payer decides first, then the ability\'s controller gets the "if they do" instruction', () => {
    expect(noManual(TAX)).toBe(true);
    const step = (TAX.faces[0]!.abilities[0] as { effect: { steps: { op: string; then?: unknown; else?: unknown }[] } }).effect.steps[0]!;
    expect(step.op).toBe('pay');
    expect(JSON.stringify(step.then)).toContain('"gainLife"');
    expect(JSON.stringify(step.else)).toContain('"counter"');
  });
  /** p2 casts Test Gain, p1 answers with Test Tax; both pass so that the counterspell resolves (p2 is asked to pay). */
  const setup = (lands: number): GameState => {
    let s = scenario([], { p1: { hand: ['Test Tax'] }, p2: { hand: ['Test Gain'], battlefield: Array(lands).fill('Plains') as string[] }, defs: [TAX, GAIN] });
    s = pass(s); // p1 passes priority in its main phase: p2 may cast an instant
    s = cast(s, 'Test Gain', {}, 'p2');
    s = pass(s); // p2 passes with Test Gain on the stack: p1 may respond
    const gain = find(s, 'Test Gain', 'stack');
    return cast(s, 'Test Tax', { targets: [[obj(gain)]] });
  };
  it('CR 118.12a: not paid (p2 cannot): the spell is countered and nobody gains life', () => {
    const s = resolveAll(setup(0));
    expect(graveNames(s, 'p2')).toContain('Test Gain');
    expect(life(s, 'p1')).toBe(20);
    expect(life(s, 'p2')).toBe(20);
  });
  it('CR 118.12a, 608.2c: paid: the spell is not countered, and "they do" gives the controller of Test Tax 3 life', () => {
    let s = pass(pass(setup(2)));
    expect(s.pending?.kind).toBe('yesNo');
    expect(s.pending?.player).toBe('p2');
    s = resolveAll(settle(answer(s, yes)));
    expect(life(s, 'p1')).toBe(23);
    expect(life(s, 'p2')).toBe(22);
  });
  it('CR 118.12a: declined although able: countered, no life', () => {
    const s = resolveAll(settle(pass(pass(setup(2))), { answers: [no] }));
    expect(graveNames(s, 'p2')).toContain('Test Gain');
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 406.1, 608.2c: "Exile cards from the top of your library until you exile a creature card. You may cast that card this turn." (op exileUntil)', () => {
  const DIG = card('Test Dig', 'Sorcery', 'Exile cards from the top of your library until you exile a creature card. You may cast that card this turn.');
  it('is understood', () => expect(noManual(DIG)).toBe(true));
  it('CR 406.1: every card down to the first creature card is exiled, one at a time; the creature card can be cast this turn, from exile', () => {
    const s0 = scenario([], { p1: { hand: ['Test Dig'], library: ['Test Rock', 'Test Rock', 'Test Bear', 'Test Rock'] }, defs: [DIG, ROCK, BEAR] });
    const s = resolveAll(cast(s0, 'Test Dig'));
    expect(exileNames(s).filter((n) => n === 'Test Rock')).toHaveLength(2);
    expect(exileNames(s)).toContain('Test Bear');
    expect(zoneNames(s, 'library', 'p1')[0]).toBe('Test Rock'); // the card after the creature card stays on top
    const bear = find(s, 'Test Bear', 'exile');
    expect(legal(s, 'p1', 'cast').some((a) => (a.action as { card?: ObjectId }).card === bear)).toBe(true);
    const rock = findAll(s, 'Test Rock', 'exile')[0]!;
    expect(legal(s, 'p1', 'cast').some((a) => (a.action as { card?: ObjectId }).card === rock)).toBe(false); // only "that card"
  });
  it('CR 608.2b: with no creature card the whole library is exiled and nothing may be cast', () => {
    const s0 = scenario([], { p1: { hand: ['Test Dig'], library: ['Test Rock'] }, defs: [DIG, ROCK] });
    const s = resolveAll(cast(s0, 'Test Dig'));
    expect(s.zones.library.p1).toHaveLength(0); // the scenario's Plains are lands, so they are exiled too
    expect(legal(s, 'p1', 'cast').filter((a) => s.objects[(a.action as { card?: ObjectId }).card ?? '']?.zone === 'exile')).toEqual([]);
  });
});

describe('CR 115.1, 601.2c, 608.2c: "Whenever ~ attacks, choose up to one target creature. That creature can\'t be blocked this turn and has base power and toughness 1/1 until end of turn."', () => {
  const SHRINK = card('Test Shrinker', 'Creature — Elf', "Whenever this creature attacks, choose up to one target creature. That creature can't be blocked this turn and has base power and toughness 1/1 until end of turn.", { pt: ['2', '2'] });
  it('is understood: the "choose" sentence is the target of the next one, and no step of its own', () => {
    expect(noManual(SHRINK)).toBe(true);
    const a = SHRINK.faces[0]!.abilities[0] as { effect: { targets: { min: number; max: number }[]; steps: unknown[] } };
    expect(a.effect.targets).toHaveLength(1);
    expect(a.effect.targets[0]).toMatchObject({ min: 0, max: 1 });
    expect(a.effect.steps).toHaveLength(1);
  });
  it('CR 115.1, 613.4b: the chosen creature is 1/1 and unblockable this turn; the attacker itself is unchanged', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Shrinker', 'Test Ogre'] }, defs: [SHRINK, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p1');
    const s = resolveAll(attackWith(s0, ['Test Shrinker', 'Test Ogre'], { targets: [[obj(ogre)]] }), { targets: [[obj(ogre)]] });
    expect(ptOf(s, ogre)).toBe('1/1');
    expect(ptOf(s, find(s, 'Test Shrinker', 'battlefield', 'p1'))).toBe('2/2');
  });
});

describe('CR 608.2c, 608.2d: "If it\'s tapped, destroy it. Otherwise, tap it." after "choose target creature" (the "otherwise" sentence never sees the branch it replaces)', () => {
  const SNAP = card('Test Snapper', 'Creature — Elf', "When this creature enters, choose up to one target creature. If it's tapped, destroy it. Otherwise, tap it.", { pt: ['1', '1'] });
  it('is understood, and "otherwise" acts on the target itself (no name of the destroyed card)', () => {
    expect(noManual(SNAP)).toBe(true);
    const step = (SNAP.faces[0]!.abilities[0] as { effect: { steps: { else?: unknown }[] } }).effect.steps[0]!;
    expect(JSON.stringify(step.else)).toContain('{"ref":"target","id":"t0"}');
  });
  it('CR 608.2d: an untapped target is tapped, not destroyed; a tapped one is destroyed', () => {
    const s0 = scenario([], { p1: { hand: ['Test Snapper'] }, p2: { battlefield: ['Test Bear', { name: 'Test Ogre', tapped: true }] }, defs: [SNAP, BEAR, OGRE] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p2');
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const s1 = resolveAll(cast(s0, 'Test Snapper'), { targets: [[obj(bear)]] });
    expect(s1.objects[bear]?.tapped).toBe(true);
    expect(battlefieldNames(s1, 'p2')).toContain('Test Bear');
    const s2 = resolveAll(cast(s0, 'Test Snapper'), { targets: [[obj(ogre)]] });
    expect(graveNames(s2, 'p2')).toContain('Test Ogre');
  });
});

describe('CR 608.2c, 701.20e: "If you didn\'t put a card into your hand this way" after the rest of the cards looked at go to the bottom', () => {
  const SEEK = card('Test Seeker', 'Creature — Human', 'When this creature enters, look at the top three cards of your library. You may reveal an artifact card from among them and put it into your hand. Put the rest on the bottom of your library in a random order. If you didn\'t put a card into your hand this way, put a +1/+1 counter on this creature.', { pt: ['1', '1'] });
  it('is understood: the condition reads the move to the hand, not the move of the rest', () => {
    expect(noManual(SEEK)).toBe(true);
    expect(JSON.stringify(SEEK.faces[0]!.abilities)).toContain('"not":true');
  });
  it('CR 608.2c: an artifact card taken: no counter', () => {
    const s0 = scenario([], { p1: { hand: ['Test Seeker'], library: ['Test Rock', 'Test Bear', 'Test Bear'] }, defs: [SEEK, ROCK, BEAR] });
    const rock = find(s0, 'Test Rock', 'library', 'p1');
    const s = resolveAll(cast(s0, 'Test Seeker'), { picks: [[rock]], answers: [yes] });
    expect(zoneNames(s, 'hand', 'p1')).toContain('Test Rock');
    expect(s.objects[find(s, 'Test Seeker', 'battlefield', 'p1')]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('CR 608.2c: nothing taken (none to take): the counter', () => {
    const s0 = scenario([], { p1: { hand: ['Test Seeker'], library: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs: [SEEK, BEAR] });
    const s = resolveAll(cast(s0, 'Test Seeker'), { picks: [[]], answers: [no] });
    expect(s.objects[find(s, 'Test Seeker', 'battlefield', 'p1')]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 115.1, 601.2c: "Return up to two target creature cards with total mana value 3 or less from your graveyard to the battlefield"', () => {
  const RAISE = card('Test Raise', 'Sorcery', 'Return up to two target creature cards with total mana value 3 or less from your graveyard to the battlefield. Put a +1/+1 counter on each of them.');
  const PUP = card('Test Pup', 'Creature — Dog', '', { pt: ['1', '1'], cost: '{1}' });
  it('is understood: one target spec of cards in your graveyard with a group limit', () => {
    expect(noManual(RAISE)).toBe(true);
    expect(JSON.stringify(RAISE.faces[0]!.abilities)).toContain('"groupLimit":{"stat":"manaValue","cmp":{"op":"<=","value":3}}');
  });
  it('CR 115.1: two cards of total mana value 2 come back with a counter each', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise'], graveyard: ['Test Pup', 'Test Pup'] }, defs: [RAISE, PUP] });
    const [a, b] = findAll(s0, 'Test Pup', 'graveyard', 'p1');
    const s = resolveAll(cast(s0, 'Test Raise', { targets: [[obj(a!), obj(b!)]] }));
    expect(battlefieldNames(s, 'p1').filter((n) => n === 'Test Pup')).toHaveLength(2);
  });
  it('CR 601.2c: a set over the total is refused when the targets are announced', () => {
    const s0 = scenario([], { p1: { hand: ['Test Raise'], graveyard: ['Test Pup', 'Test Ogre'] }, defs: [RAISE, PUP, OGRE] });
    const pup = find(s0, 'Test Pup', 'graveyard', 'p1');
    const ogre = find(s0, 'Test Ogre', 'graveyard', 'p1');
    const s1 = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Raise', 'hand', 'p1') });
    expect(s1.pending?.kind).toBe('chooseTargets');
    expect(() => answer(s1, { kind: 'chooseTargets', targets: [obj(pup), obj(ogre)] })).toThrow();
  });
});

describe('CR 700.4, 603.10a: "dies or is put into exile"', () => {
  const KNIGHT = card('Test Knight', 'Legendary Creature — Human Knight', 'Whenever another creature you control dies or is put into exile, you gain 1 life.\nWhen this creature dies or is put into exile while its power is 4 or greater, draw two cards.', { pt: ['2', '2'] });
  const KILL = card('Test Kill', 'Instant', 'Destroy target creature.');
  const BANISH = card('Test Banish', 'Instant', 'Exile target creature.');
  const GROW = card('Test Grow', 'Instant', 'Target creature gets +2/+2 until end of turn.');
  it('is understood', () => expect(noManual(KNIGHT)).toBe(true));
  it('CR 700.4: another creature dying triggers it, and so does another creature exiled from the battlefield', () => {
    const s0 = scenario([], { p1: { hand: ['Test Kill', 'Test Banish'], battlefield: ['Test Knight', 'Test Bear', 'Test Bear'] }, defs: [KNIGHT, KILL, BANISH, BEAR] });
    const [b1, b2] = findAll(s0, 'Test Bear', 'battlefield', 'p1');
    let s = resolveAll(cast(s0, 'Test Kill', { targets: [[obj(b1!)]] }));
    expect(life(s, 'p1')).toBe(21);
    s = resolveAll(cast(s, 'Test Banish', { targets: [[obj(b2!)]] }));
    expect(life(s, 'p1')).toBe(22);
  });
  it('CR 603.10a: its own power is read as it last existed on the battlefield: 4 or greater draws, less does not', () => {
    const s0 = scenario([], { p1: { hand: ['Test Grow', 'Test Banish'], battlefield: ['Test Knight'] }, defs: [KNIGHT, GROW, BANISH] });
    const knight = find(s0, 'Test Knight', 'battlefield', 'p1');
    const hand0 = s0.zones.hand.p1!.length;
    let s = resolveAll(cast(s0, 'Test Grow', { targets: [[obj(knight)]] }));
    s = resolveAll(cast(s, 'Test Banish', { targets: [[obj(knight)]] }));
    expect(s.zones.hand.p1!.length).toBe(hand0 - 2 + 2); // two spells cast, two cards drawn
    const t = resolveAll(cast(s0, 'Test Banish', { targets: [[obj(knight)]] }));
    expect(t.zones.hand.p1!.length).toBe(hand0 - 1); // a 2/2: no draw
  });
});

describe('CR 115.1, 608.2e, 701.17a: "Destroy all artifacts, then any number of target players each mill half their library, rounded down."', () => {
  const RIFT = card('Test Rift', 'Sorcery', 'Destroy all artifacts, then any number of target players each mill half their library, rounded down.');
  it('is understood: one player at a time, each reading their own library', () => {
    expect(noManual(RIFT)).toBe(true);
    expect(JSON.stringify(RIFT.faces[0]!.abilities)).toContain('"op":"forEach"');
  });
  it('CR 107.1a: each chosen player mills half of their own library, rounded down', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rift'], battlefield: ['Test Rock'], library: ['Test Bear'] }, p2: { library: ['Test Bear', 'Test Bear', 'Test Bear'] }, defs: [RIFT, ROCK, BEAR] });
    const l1 = s0.zones.library.p1!.length; // 21
    const l2 = s0.zones.library.p2!.length; // 23
    const s = resolveAll(cast(s0, 'Test Rift', { targets: [[player('p1'), player('p2')]] }));
    expect(graveNames(s)).toContain('Test Rock');
    expect(s.zones.library.p1!.length).toBe(l1 - Math.floor(l1 / 2));
    expect(s.zones.library.p2!.length).toBe(l2 - Math.floor(l2 / 2));
  });
  it('CR 101.4, 101.4a (wave 3 merge review): "each discard" with an amount of their own is not done one player at a time (the choices are simultaneous), so it stays refused', () => {
    const PURGE = card('Test Purge', 'Sorcery', 'Any number of target players each discard a number of cards equal to the number of cards in their graveyard.');
    expect(JSON.stringify(PURGE.faces[0]!.abilities)).not.toContain('"op":"forEach"');
    expect(noManual(PURGE)).toBe(false);
  });
  it('CR 115.1: a player not chosen mills nothing', () => {
    const s0 = scenario([], { p1: { hand: ['Test Rift'] }, defs: [RIFT] });
    const l1 = s0.zones.library.p1!.length;
    const l2 = s0.zones.library.p2!.length;
    const s = resolveAll(cast(s0, 'Test Rift', { targets: [[player('p2')]] }));
    expect(s.zones.library.p1!.length).toBe(l1);
    expect(s.zones.library.p2!.length).toBe(l2 - Math.floor(l2 / 2));
  });
});

describe('CR 202.3, 608.2d, 613.1b: "Choose odd or even. Destroy each creature with mana value of the chosen quality. Then gain control of all creatures until end of turn. Untap them. They gain haste until end of turn."', () => {
  const MUTINY = card('Test Mutiny', 'Sorcery', 'Choose odd or even. Destroy each creature with mana value of the chosen quality. Then gain control of all creatures until end of turn. Untap them. They gain haste until end of turn.');
  const TOKENISH = card('Test Zero', 'Creature — Construct', '', { pt: ['1', '1'], cost: '{0}' });
  it('is understood', () => expect(noManual(MUTINY)).toBe(true));
  const pick = (s: GameState, word: string): DecisionAnswer => {
    const p = s.pending as { kind: string; options: { id: string; label?: string }[] };
    const o = p.options.find((x) => (x.label ?? x.id).toLowerCase() === word) ?? p.options.find((x) => x.id.toLowerCase() === word);
    return { kind: 'chooseOption', ids: [o!.id] } as DecisionAnswer;
  };
  it('CR 202.3: "odd" destroys the creatures of odd mana value; the rest change control, untap and gain haste', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mutiny'] }, p2: { battlefield: [{ name: 'Test Ogre', tapped: true }, { name: 'Test Pup2', tapped: true }, 'Test Zero'] }, defs: [MUTINY, OGRE, TOKENISH, card('Test Pup2', 'Creature — Dog', '', { pt: ['1', '1'], cost: '{1}{G}' })] });
    let s = pass(pass(cast(s0, 'Test Mutiny')));
    expect(s.pending?.kind).toBe('chooseOption');
    s = resolveAll(settle(answer(s, pick(s, 'odd'))));
    expect(graveNames(s, 'p2')).toContain('Test Ogre'); // mana value 3
    const pup = find(s, 'Test Pup2', 'battlefield'); // mana value 2
    const zero = find(s, 'Test Zero', 'battlefield'); // mana value 0 (zero is even)
    for (const id of [pup, zero]) {
      expect(s.objects[id]!.controller).toBe('p1');
      expect(s.objects[id]!.tapped).toBe(false);
      expect(keyword(s, id, 'haste')).toBe(true);
    }
  });
  it('CR 202.3: "even" destroys mana value 2 and 0, keeps 3', () => {
    const s0 = scenario([], { p1: { hand: ['Test Mutiny'] }, p2: { battlefield: ['Test Ogre', 'Test Zero'] }, defs: [MUTINY, OGRE, TOKENISH] });
    let s = pass(pass(cast(s0, 'Test Mutiny')));
    s = resolveAll(settle(answer(s, pick(s, 'even'))));
    expect(graveNames(s, 'p2')).toContain('Test Zero');
    expect(s.objects[find(s, 'Test Ogre', 'battlefield')]!.controller).toBe('p1');
  });
});

describe('CR 110.2, 508.4: "put target creature card from defending player\'s graveyard onto the battlefield under your control tapped and attacking"', () => {
  const VOID = card('Test Choir', 'Creature — Spirit', "Whenever this creature attacks, put target creature card from defending player's graveyard onto the battlefield under your control tapped and attacking.", { pt: ['2', '2'] });
  it('is understood', () => expect(noManual(VOID)).toBe(true));
  it('CR 508.4: the card comes back under your control, tapped and attacking (it was never declared as an attacker)', () => {
    const s0 = scenario([], { p1: { battlefield: ['Test Choir'] }, p2: { graveyard: ['Test Ogre'] }, defs: [VOID, OGRE] });
    const ogre = find(s0, 'Test Ogre', 'graveyard', 'p2');
    const s = resolveAll(attackWith(s0, ['Test Choir'], { targets: [[obj(ogre)]] }), { targets: [[obj(ogre)]] });
    const back = find(s, 'Test Ogre', 'battlefield');
    expect(s.objects[back]!.controller).toBe('p1');
    expect(s.objects[back]!.tapped).toBe(true);
    expect(JSON.stringify(s.combat ?? {})).toContain(back);
  });
});

describe('CR 707.2, 111.4, 603.7: "Create X tokens that are copies of target creature you control. Sacrifice them at the beginning of the next end step."', () => {
  const ECHO = card('Test Echo', 'Sorcery', 'Create X tokens that are copies of target creature you control. Those tokens gain haste until end of turn. Sacrifice them at the beginning of the next end step.', { cost: '{X}' });
  it('is understood', () => expect(noManual(ECHO)).toBe(true));
  it('CR 707.2, 107.3: X copies with haste, sacrificed at the next end step', () => {
    const s0 = scenario([], { p1: { hand: ['Test Echo'], battlefield: ['Test Bear', 'Plains', 'Plains', 'Plains'] }, defs: [ECHO, BEAR] });
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Echo', 'hand', 'p1') });
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 10; guard++) {
      if (s.pending.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: 2 }); // X (CR 107.3, 601.2b)
      else if (s.pending.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [obj(bear)] });
      else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    s = resolveAll(s);
    const copies = s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
    expect(copies).toHaveLength(2);
    for (const id of copies) expect(keyword(s, id, 'haste')).toBe(true);
    // CR 603.7: on to the end step of this turn (no attack), where the delayed trigger sacrifices them
    for (let i = 0; i < 60 && s.turn.number === 1 && s.turn.step !== 'cleanup'; i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
  });
});

describe('CR 608.2c, 400.7, 107.3a: "Destroy all creatures with toughness X or less. You lose X life. If X is 2 or more, return a creature card put into a graveyard this way to the battlefield under your control."', () => {
  const BALLAD = card('Test Ballad', 'Sorcery', 'Destroy all creatures with toughness X or less. You lose X life. If X is 2 or more, return a creature card put into a graveyard this way to the battlefield under your control.', { cost: '{X}' });
  it('is understood: the card returned is one of those the destroy put into a graveyard', () => {
    expect(noManual(BALLAD)).toBe(true);
    expect(JSON.stringify(BALLAD.faces[0]!.abilities)).toContain('"zone":"graveyard"');
  });
  /** Cast Test Ballad for X, then let it resolve; `pick` names the card chosen to return. */
  const play = (x: number, pick?: (s: GameState) => ObjectId[]): GameState => {
    const s0 = scenario([], { p1: { hand: ['Test Ballad'], battlefield: ['Plains', 'Plains', 'Plains', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] }, defs: [BALLAD, BEAR, OGRE] });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Ballad', 'hand', 'p1') });
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 10; guard++) {
      if (s.pending.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: x });
      else if (s.pending.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    s = pass(pass(s));
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 10; guard++) {
      if (s.pending.kind === 'chooseObjects' && pick) s = answer(s, { kind: 'chooseObjects', ids: pick(s) });
      else s = settle(s);
      if (s.pending?.kind === 'chooseObjects' && !pick) break;
    }
    return s;
  };
  it('CR 107.3a: X is 1: the 2/2 survives, nothing returns, 1 life lost', () => {
    const s = play(1);
    expect(battlefieldNames(s, 'p1')).toContain('Test Bear');
    expect(life(s, 'p1')).toBe(19);
  });
  it('CR 608.2c, 400.7: X is 3: both creatures are destroyed and you return one of them (here the opponent\'s) under your control', () => {
    const s = play(3, (st) => [find(st, 'Test Ogre', 'graveyard', 'p2')]);
    expect(life(s, 'p1')).toBe(17);
    const ogre = find(s, 'Test Ogre', 'battlefield');
    expect(s.objects[ogre]!.controller).toBe('p1');
    expect(graveNames(s)).toContain('Test Bear');
  });
});
