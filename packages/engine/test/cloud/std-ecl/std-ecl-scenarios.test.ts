/**
 * Cloud batch 2, slice std-ecl (the Standard backlog of Lorwyn Eclipsed, tuning half): the templates of parser/templates/zz-cloud/std-ecl.json and the hole,
 * renderer and engine support they needed, played through the engine with synthetic cards compiled by the game's default compiler (invented names and
 * wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 115.1, 601.2c, 205.3m, 702.73a   "two target creature cards that share a creature type" (a changeling shares every type)
 *   CR 122.1, 602.1a, 118.3             "Remove two counters from ~" as a cost: counters of any kinds, the kinds chosen by the payer
 *   CR 702.8a, 604.1, 601.2             "You may cast ~ as though it had flash if you control a Wizard."
 *   CR 611.3a, 613.4c                   "+X/+X, where X is the number of creatures that entered the battlefield under your control this turn"
 *   CR 508.1, 611.3a, 602.5b            "you attacked with two or more <creatures> this turn": each attacker counted once
 *   CR 205.3m, 613.1d, 611.2a           "Target creature gains all creature types until end of turn."
 *   CR 122.1, 608.2d                    "Remove any number of counters from target creature you control."
 *   CR 611.2c, 613.1d, 613.1f, 613.4b   "each creature target opponent controls loses all abilities, becomes a Frog in addition to its other types, and has base P/T 1/1"
 *   CR 603.2, 603.6a                    "When ~ enters and whenever you cast a spell with mana value 2 or greater, ..."
 *   CR 701.17a, 608.2c                  "Target player mills three cards, then puts each Goblin card milled this way into their hand."
 *   CR 707.9b, 707.2, 111.1             "Create a token that's a copy of target creature you control, except it has haste and \"At the beginning of the end step, sacrifice this token.\""
 *   CR 701.4a, 702.34a                  "Flashback—{0}, Behold two Goblins."
 *   CR 608.2c, 701.68a                  "Then if you control three or more creatures, blight 1." / "Then if ..., create ... token."
 *   CR 115.1, 120.3                     "~ deals 1 damage to each creature target player controls."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { countHistory } from '../../../src/rules/history';
import { maxHandSize } from '../../../src/statics/hooks';
import { ENCHANTMENT, ruleMod, staticOf } from '../../m5/rulehooks/fixtures';
import { act, advanceTo, answer, find, findAll, passBoth, put, reject, scenario } from '../../m3/scenario';
import { declareAttackers, lifeOf, passUntil, toDeclareAttackers, toStep } from '../../m4/helpers';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Nothing of the card is left manual (the level itself is checked by the template tests: an experimental template caps it, design 6.9). */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

/** The answers to the decisions that come up, in order of kind; mana payment is automatic. Stops at the next priority decision. */
interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][]; options?: string[][]; numbers?: number[] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])], options: [...(script.options ?? [])], numbers: [...(script.numbers ?? [])] };
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: q.options.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: q.numbers.shift() ?? p.min });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
  }
  return s;
}
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player: PlayerId = 'p1', method?: string, zone: 'hand' | 'graveyard' = 'hand'): GameState =>
  drive(act(s, { type: 'cast', player, card: find(s, name, zone, player), ...(method ? { method } : {}) } as never), script);
const castAndResolve = (s: GameState, name: string, script?: Script): GameState => resolveAll(cast(s, name, script), script);
const activate = (s: GameState, name: string, script?: Script, player: PlayerId = 'p1'): GameState => {
  const src = find(s, name, 'battlefield', player);
  const a = legalActions(s, player).find((x) => x.action.type === 'activate' && (x.action as { source?: ObjectId }).source === src && !/Add \{/.test(x.label));
  if (a === undefined) throw new Error(`no activation of ${name}`);
  return resolveAll(drive(act(s, a.action), script), script);
};
const canActivate = (s: GameState, name: string, player: PlayerId = 'p1'): boolean => {
  const src = find(s, name, 'battlefield', player);
  return legalActions(s, player).some((x) => x.action.type === 'activate' && (x.action as { source?: ObjectId }).source === src && !/Add \{/.test(x.label));
};
const castable = (s: GameState, name: string, player: PlayerId = 'p1', zone: 'hand' | 'graveyard' = 'hand'): boolean => {
  const id = find(s, name, zone, player);
  return legalActions(s, player).some((a) => a.action.type === 'cast' && a.action.card === id);
};
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id });
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const handNames = (s: GameState, p: PlayerId): string[] => names(s, s.zones.hand[p]!);
const countersOn = (s: GameState, id: ObjectId): Record<string, number> => Object.fromEntries(Object.entries(s.objects[id]!.counters).filter(([, n]) => n > 0));

const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', '{1}', ['1', '1']);
const GOBLIN_2 = card('Test Goblin Scout', 'Creature — Goblin Scout', '', '{1}', ['1', '1']);
const ELF = card('Test Elf', 'Creature — Elf', '', '{1}', ['1', '1']);
const ELF_2 = card('Test Elf Archer', 'Creature — Elf Archer', '', '{1}', ['1', '1']);
const SHIFTER = card('Test Shifter', 'Creature — Shapeshifter', 'Changeling (This card is every creature type.)', '{1}', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', '{1}', ['2', '2']);
const DRAKE = card('Test Drake', 'Creature — Drake', 'Flying', '{1}', ['3', '3']);
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', '{1}', ['1', '1']);
const RELIC = card('Test Relic', 'Artifact', '', '{1}');
const COMMON = [GOBLIN, GOBLIN_2, ELF, ELF_2, SHIFTER, BEAR, DRAKE, WIZARD, RELIC];

describe('CR 115.1, 601.2c, 205.3m: "Return two target creature cards that share a creature type from your graveyard to your hand."', () => {
  const RECALL = card('Test Kin Recall', 'Sorcery', 'Return two target creature cards that share a creature type from your graveyard to your hand.');
  const graveyard = { p1: { hand: ['Test Kin Recall'], graveyard: ['Test Goblin', 'Test Goblin Scout', 'Test Elf', 'Test Bear'] } };
  it('is understood', () => expect(noManual(RECALL)).toBe(true));
  it('a Goblin and an Elf are refused (no creature type in common); two Goblins return to your hand', () => {
    let s = scenario([], { defs: [...COMMON, RECALL], ...graveyard });
    const goblin = find(s, 'Test Goblin', 'graveyard', 'p1');
    const scout = find(s, 'Test Goblin Scout', 'graveyard', 'p1');
    const elf = find(s, 'Test Elf', 'graveyard', 'p1');
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kin Recall', 'hand', 'p1') });
    expect(s.pending?.kind).toBe('chooseTargets');
    const refused = reject(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'chooseTargets', targets: [obj(goblin), obj(elf)] } });
    expect(refused.message).toMatch(/must share a creature type/);
    s = resolveAll(drive(s, { targets: [[obj(goblin), obj(scout)]] }));
    expect(handNames(s, 'p1')).toEqual(['Test Goblin', 'Test Goblin Scout']);
  });
  it('CR 702.73a, 604.3: a changeling card in the graveyard has every creature type, so it shares one with the Elf', () => {
    let s = scenario([], { defs: [...COMMON, RECALL], p1: { hand: ['Test Kin Recall'], graveyard: ['Test Shifter', 'Test Elf'] } });
    const shifter = find(s, 'Test Shifter', 'graveyard', 'p1');
    const elf = find(s, 'Test Elf', 'graveyard', 'p1');
    s = resolveAll(cast(s, 'Test Kin Recall', { targets: [[obj(shifter), obj(elf)]] }));
    expect(handNames(s, 'p1')).toEqual(['Test Elf', 'Test Shifter']);
  });
  it('CR 601.2c: with no two cards that share a creature type the spell has no legal set of targets and can\'t be cast', () => {
    const s = scenario([], { defs: [...COMMON, RECALL], p1: { hand: ['Test Kin Recall'], graveyard: ['Test Goblin', 'Test Elf', 'Test Bear'] } });
    expect(castable(s, 'Test Kin Recall')).toBe(false);
  });
});

describe('CR 122.1, 602.1a, 118.3: "{0}, Remove two counters from ~: Draw a card." (counters of any kinds)', () => {
  const FONT = card('Test Counter Font', 'Artifact', '{0}, Remove two counters from ~: Draw a card.');
  it('is understood', () => expect(noManual(FONT)).toBe(true));
  it('two counters of two kinds are removed (the payer chooses the kind of each); with one counter left the ability can\'t be activated', () => {
    let s = scenario([], { defs: [FONT], p1: { battlefield: [{ name: 'Test Counter Font', counters: { charge: 2, oil: 1 } }] } });
    const font = find(s, 'Test Counter Font', 'battlefield', 'p1');
    const hand = s.zones.hand['p1']!.length;
    s = activate(s, 'Test Counter Font');
    expect(s.zones.hand['p1']!.length).toBe(hand + 1);
    const left = countersOn(s, font);
    expect(Object.values(left).reduce((a, b) => a + b, 0)).toBe(1);
    expect(canActivate(s, 'Test Counter Font')).toBe(false);
  });
});

describe('CR 702.8a, 604.1: "You may cast ~ as though it had flash if you control a Wizard."', () => {
  const SNEAK = card('Test Sneak', 'Creature — Faerie Rogue', 'You may cast ~ as though it had flash if you control a Wizard.', '{0}', ['1', '1']);
  it('is understood', () => expect(noManual(SNEAK)).toBe(true));
  it('in the opponent\'s turn the card can be cast while you control a Wizard, and not without one', () => {
    const at = (s: GameState): GameState => passUntil(advanceTo(s, 2, 'upkeep'), (x) => x.pending?.player === 'p1', 'priority for p1 in turn 2');
    const yes = at(scenario([], { defs: [...COMMON, SNEAK], p1: { hand: ['Test Sneak'], battlefield: ['Test Wizard'] } }));
    expect(castable(yes, 'Test Sneak')).toBe(true);
    const no = at(scenario([], { defs: [...COMMON, SNEAK], p1: { hand: ['Test Sneak'], battlefield: ['Test Bear'] } }));
    expect(castable(no, 'Test Sneak')).toBe(false);
  });
});

describe('CR 611.3a, 613.4c: "Creatures you control get +X/+X, where X is the number of creatures that entered the battlefield under your control this turn."', () => {
  const RALLY = card('Test Rally', 'Enchantment', 'Creatures you control get +X/+X, where X is the number of creatures that entered the battlefield under your control this turn.');
  it('is understood', () => expect(noManual(RALLY)).toBe(true));
  it('counts your creatures that entered this turn, not an opponent\'s, and starts over the next turn', () => {
    let s = scenario([], { defs: [...COMMON, RALLY], p1: { hand: ['Test Bear', 'Test Elf'], battlefield: ['Test Rally', 'Test Drake', 'Plains', 'Plains'] }, p2: { hand: ['Test Goblin'], battlefield: ['Plains'] } });
    const drake = find(s, 'Test Drake', 'battlefield', 'p1');
    expect(ptOf(s, drake)).toBe('3/3');
    s = castAndResolve(s, 'Test Bear');
    expect(ptOf(s, drake)).toBe('4/4');
    s = castAndResolve(s, 'Test Elf');
    expect(ptOf(s, drake)).toBe('5/5');
    expect(ptOf(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe('4/4');
    s = advanceTo(s, 2, 'main1');
    expect(ptOf(s, drake)).toBe('3/3'); // a new turn: nothing entered under p1's control yet
    s = resolveAll(cast(s, 'Test Goblin', undefined, 'p2')); // an opponent's creature entering is not counted
    expect(ptOf(s, drake)).toBe('3/3');
  });
});

describe('CR 611.3a, 402.2: a rule modification whose amount is a history count follows the history ("maximum hand size equal to the number of creatures that died this turn")', () => {
  const died = { ev: 'zoneChange' as const, subject: { types: ['Creature' as const] }, from: 'battlefield' as const, to: 'graveyard' as const };
  const GRIM = ENCHANTMENT('Test Grim Hand', [staticOf('Your maximum hand size is equal to the number of creatures that died this turn.', [ruleMod('maxHandSize', { value: { q: 'happenedCount', event: died, scope: 'turn' } })])], '{0}');
  const KILL = card('Test Kill', 'Sorcery', 'Destroy target creature.');
  it('0 while no creature died this turn, 1 after one died, 0 again the next turn', () => {
    let s = scenario([], { defs: [...COMMON, GRIM, KILL], p1: { battlefield: ['Test Grim Hand'], hand: ['Test Kill'] }, p2: { battlefield: ['Test Bear'] } });
    expect(maxHandSize(s, 'p1')).toBe(0);
    s = castAndResolve(s, 'Test Kill', { targets: [[obj(find(s, 'Test Bear', 'battlefield', 'p2'))]] });
    expect(maxHandSize(s, 'p1')).toBe(1);
    s = advanceTo(s, 2, 'upkeep');
    expect(maxHandSize(s, 'p1')).toBe(0);
  });
});

describe('CR 508.1, 611.3a, 602.5b: "you attacked with two or more <creatures> this turn"', () => {
  const BANNER = card('Test Elf Banner', 'Enchantment', 'As long as you attacked with two or more Elves this turn, Elves you control get +1/+0.');
  const KEEP = card('Test Keep', 'Land', '{2}, {T}: Draw a card. Activate only if you attacked with two or more creatures this turn.');
  it('is understood', () => {
    expect(noManual(BANNER)).toBe(true);
    expect(noManual(KEEP)).toBe(true);
  });
  it('after two Elves attack, Elves you control get +1/+0 for the rest of the turn; one Elf attacking is not enough', () => {
    const start = scenario([], { defs: [...COMMON, BANNER], p1: { battlefield: ['Test Elf Banner', 'Test Elf', 'Test Elf Archer', 'Test Bear'] } });
    const [elf, archer] = [find(start, 'Test Elf', 'battlefield', 'p1'), find(start, 'Test Elf Archer', 'battlefield', 'p1')];
    let s = declareAttackers(toDeclareAttackers(start), [[elf], [archer]]);
    expect(ptOf(s, elf)).toBe('2/1');
    s = toStep(passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers'), 'main2');
    expect(ptOf(s, archer)).toBe('2/1');
    let t = declareAttackers(toDeclareAttackers(start), [[elf], [find(start, 'Test Bear', 'battlefield', 'p1')]]);
    expect(ptOf(t, elf)).toBe('1/1');
    t = advanceTo(t, 2, 'upkeep');
    expect(ptOf(t, elf)).toBe('1/1');
  });
  it('CR 602.5b: the land can be activated only after you attacked with two creatures this turn', () => {
    const start = scenario([], { defs: [...COMMON, KEEP], p1: { battlefield: ['Test Keep', 'Test Elf', 'Test Bear', 'Plains', 'Plains'] } });
    expect(canActivate(start, 'Test Keep')).toBe(false);
    let s = declareAttackers(toDeclareAttackers(start), [[find(start, 'Test Elf', 'battlefield', 'p1')], [find(start, 'Test Bear', 'battlefield', 'p1')]]);
    s = toStep(passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers'), 'main2');
    expect(canActivate(s, 'Test Keep')).toBe(true);
  });
  it('CR 508.1: a creature that attacked is counted once, however many attack events the history holds for it (an additional combat)', () => {
    const start = scenario([], { defs: [...COMMON], p1: { battlefield: ['Test Elf', 'Test Bear'] } });
    const elf = find(start, 'Test Elf', 'battlefield', 'p1');
    let s = declareAttackers(toDeclareAttackers(start), [[elf]]);
    const pattern = { ev: 'attacks', attacker: { types: ['Creature'], controller: 'you' } } as const;
    const once = countHistory(s, pattern as never, 'turn', undefined, { you: 'p1' } as never);
    expect(once).toBe(1);
    const entry = s.history.find((h) => (h as { ev?: string }).ev === 'attacks' || JSON.stringify(h).includes('"attacks"'))!;
    s = { ...s, history: [...s.history, entry] }; // the same creature attacking again in an additional combat phase
    expect(countHistory(s, pattern as never, 'turn', undefined, { you: 'p1' } as never)).toBe(1);
  });
});

describe('CR 205.3m, 613.1d, 611.2a: "Target creature gains all creature types until end of turn."', () => {
  const MASK = card('Test Kin Mask', 'Instant', 'Target creature gains all creature types until end of turn.');
  const LORD = card('Test Goblin Lord', 'Enchantment', 'Goblins you control get +1/+1.');
  it('is understood', () => expect(noManual(MASK)).toBe(true));
  it('the Bear is every creature type until end of turn (a Goblin the lord pumps), then a Bear again', () => {
    let s = scenario([], { defs: [...COMMON, MASK, LORD], p1: { hand: ['Test Kin Mask'], battlefield: ['Test Goblin Lord', 'Test Bear'] } });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = castAndResolve(s, 'Test Kin Mask', { targets: [[obj(bear)]] });
    expect(getChars(s, bear)!.subtypes).toContain('Goblin');
    expect(getChars(s, bear)!.subtypes).toContain('Elf');
    expect(ptOf(s, bear)).toBe('3/3');
    s = advanceTo(s, 2, 'upkeep');
    expect(getChars(s, bear)!.subtypes).toEqual(['Bear']);
    expect(ptOf(s, bear)).toBe('2/2');
  });
});

describe('CR 122.1, 608.2d: "{0}: Remove any number of counters from target creature you control."', () => {
  const SALVE = card('Test Salve Stone', 'Artifact', '{0}: Remove any number of counters from target creature you control.');
  it('is understood', () => expect(noManual(SALVE)).toBe(true));
  it('for each kind of counter on it, the player removes the number they choose (zero or more)', () => {
    let s = scenario([], { defs: [...COMMON, SALVE], p1: { battlefield: ['Test Salve Stone', { name: 'Test Drake', counters: { '-1/-1': 2, stun: 1 } }] } });
    const drake = find(s, 'Test Drake', 'battlefield', 'p1');
    expect(ptOf(s, drake)).toBe('1/1');
    // one decision for each kind there, from 0 to the number of that kind: both -1/-1 counters, no stun counter
    let t = drive(act(s, legalActions(s, 'p1').find((x) => x.action.type === 'activate')!.action), { targets: [[obj(drake)]] });
    t = passBoth(t);
    const asked: { prompt: string; max: number }[] = [];
    for (let guard = 0; guard < 4 && t.pending?.kind === 'chooseNumber'; guard++) {
      const d = t.pending;
      asked.push({ prompt: d.prompt, max: d.max });
      t = answer(t, { kind: 'chooseNumber', n: /-1\/-1/.test(d.prompt) ? 2 : 0 });
    }
    expect(asked.map((a) => a.max).sort()).toEqual([1, 2]);
    expect(asked.every((a) => /-1\/-1|stun/.test(a.prompt))).toBe(true);
    t = resolveAll(drive(t));
    expect(countersOn(t, drake)).toEqual({ stun: 1 });
    expect(ptOf(t, drake)).toBe('3/3');
  });
});

describe('CR 611.2c, 613.1d, 613.1f, 613.4b: "When ~ enters, each creature target opponent controls loses all abilities, becomes a Frog in addition to its other types, and has base power and toughness 1/1."', () => {
  const HEX = card('Test Hexer', 'Creature — Faerie Wizard', 'When ~ enters, each creature target opponent controls loses all abilities, becomes a Frog in addition to its other types, and has base power and toughness 1/1.', '{0}', ['1', '1']);
  it('is understood', () => expect(noManual(HEX)).toBe(true));
  it('the opponent\'s creatures become 1/1 Frogs with no abilities for good; a creature that enters afterwards is not affected (the set is fixed as the trigger resolves)', () => {
    let s = scenario([], { defs: [...COMMON, HEX], p1: { hand: ['Test Hexer'] }, p2: { battlefield: ['Test Drake', 'Test Bear', 'Plains'], hand: ['Test Goblin'] } });
    const drake = find(s, 'Test Drake', 'battlefield', 'p2');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    s = castAndResolve(s, 'Test Hexer', { targets: [[player('p2')]] });
    expect(ptOf(s, drake)).toBe('1/1');
    expect(getChars(s, drake)!.subtypes).toEqual(['Drake', 'Frog']);
    expect(getChars(s, drake)!.keywords).toEqual([]);
    expect(ptOf(s, bear)).toBe('1/1');
    s = advanceTo(s, 2, 'main1');
    expect(ptOf(s, drake)).toBe('1/1'); // for good
    s = resolveAll(cast(s, 'Test Goblin', undefined, 'p2'));
    const goblin = find(s, 'Test Goblin', 'battlefield', 'p2');
    expect(getChars(s, goblin)!.subtypes).toEqual(['Goblin']);
    expect(ptOf(s, goblin)).toBe('1/1');
  });
});

describe('CR 603.2, 603.6a: "When ~ enters and whenever you cast a spell with mana value 2 or greater, you gain 2 life."', () => {
  const KITE = card('Test Ember Kite', 'Creature — Elemental', 'When ~ enters and whenever you cast a spell with mana value 2 or greater, you gain 2 life.', '{0}', ['1', '1']);
  const BIG = card('Test Big Spell', 'Sorcery', 'Draw a card.', '{2}');
  const SMALL = card('Test Small Spell', 'Sorcery', 'Draw a card.', '{1}');
  it('is understood', () => expect(noManual(KITE)).toBe(true));
  it('it triggers as it enters and for each spell of mana value 2 or more you cast, not for a smaller one or an opponent\'s', () => {
    let s = scenario([], { defs: [KITE, BIG, SMALL], p1: { hand: ['Test Ember Kite', 'Test Big Spell', 'Test Small Spell'], battlefield: ['Plains', 'Plains', 'Plains'] }, p2: { hand: ['Test Big Spell'], battlefield: ['Plains', 'Plains'] } });
    s = castAndResolve(s, 'Test Ember Kite');
    expect(lifeOf(s, 'p1')).toBe(22);
    s = castAndResolve(s, 'Test Big Spell');
    expect(lifeOf(s, 'p1')).toBe(24);
    s = castAndResolve(s, 'Test Small Spell');
    expect(lifeOf(s, 'p1')).toBe(24);
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(cast(s, 'Test Big Spell', undefined, 'p2'));
    expect(lifeOf(s, 'p1')).toBe(24);
  });
});

describe('CR 701.17a, 608.2c: "Target player mills three cards, then puts each Goblin card milled this way into their hand."', () => {
  const DIG = card('Test Goblin Dig', 'Sorcery', 'Target player mills three cards, then puts each Goblin card milled this way into their hand.');
  it('is understood', () => expect(noManual(DIG)).toBe(true));
  it('the Goblin cards among the three milled go to that player\'s hand; the rest stay in the graveyard; a Goblin card not milled stays in the library', () => {
    let s = scenario([], { defs: [...COMMON, DIG], p1: { hand: ['Test Goblin Dig'] }, p2: { graveyard: ['Test Goblin Scout'] } });
    // the top of p2's library: Goblin, Bear, Goblin, then (fourth) Goblin; index 0 is the top (CR 401.5)
    const ids = ['Test Goblin', 'Test Bear', 'Test Goblin', 'Test Goblin'].map((n) => put(s, 'p2', 'library', n));
    s.zones.library['p2'] = [...ids, ...s.zones.library['p2']!.filter((id) => !ids.includes(id))];
    const handBefore = handNames(s, 'p2');
    s = castAndResolve(s, 'Test Goblin Dig', { targets: [[player('p2')]] });
    expect(handNames(s, 'p2')).toEqual([...handBefore, 'Test Goblin', 'Test Goblin'].sort());
    expect(names(s, s.zones.graveyard['p2']!)).toEqual(['Test Bear', 'Test Goblin Scout']);
    expect(s.objects[ids[3]!]!.zone).toBe('library'); // the fourth card from the top was not milled
  });
});

describe('CR 707.9b, 707.2, 111.1: "Create a token that\'s a copy of target creature you control, except it has haste and \\"At the beginning of the end step, sacrifice this token.\\""', () => {
  const ECHO = card('Test Echo', 'Sorcery', 'Create a token that\'s a copy of target creature you control, except it has haste and "At the beginning of the end step, sacrifice this token."');
  it('is understood', () => expect(noManual(ECHO)).toBe(true));
  it('the token is a copy with haste that can attack at once, and it is sacrificed at the beginning of the end step', () => {
    let s = scenario([], { defs: [...COMMON, ECHO], p1: { hand: ['Test Echo'], battlefield: ['Test Drake'] } });
    const drake = find(s, 'Test Drake', 'battlefield', 'p1');
    s = castAndResolve(s, 'Test Echo', { targets: [[obj(drake)]] });
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    const c = getChars(s, token)!;
    expect(c.names).toEqual(['Test Drake']);
    expect(c.keywords.map((k) => k.keyword).sort()).toEqual(['flying', 'haste']);
    s = declareAttackers(toDeclareAttackers(s), [[token]]); // haste: it attacks the turn it was created (CR 702.10b)
    expect(s.combat?.attackers.map((a) => a.id)).toEqual([token]);
    s = resolveAll(toStep(passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers'), 'end'));
    s = resolveAll(drive(s));
    expect(s.objects[token]?.zone ?? 'gone').not.toBe('battlefield');
    expect(s.objects[drake]!.zone).toBe('battlefield');
  });
});

describe('CR 701.68c, 508.4, 707.9b: "Whenever ~ attacks, you may blight 1. If you do, create a tapped and attacking token that\'s a copy of the blighted creature, except it has ..."', () => {
  const AUNTIE = card('Test Auntie', 'Creature — Goblin Warrior', 'Whenever ~ attacks, you may blight 1. If you do, create a tapped and attacking token that\'s a copy of the blighted creature, except it has "At the beginning of the end step, sacrifice this token."', '{0}', ['3', '3']);
  it('is understood', () => expect(noManual(AUNTIE)).toBe(true));
  it('the creature you blight gets a -1/-1 counter, a copy of it enters tapped and attacking and deals its damage, and the copy is sacrificed at the end step', () => {
    let s = scenario([], { defs: [...COMMON, AUNTIE], p1: { battlefield: ['Test Auntie', 'Test Bear'] } });
    const auntie = find(s, 'Test Auntie', 'battlefield', 'p1');
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    s = declareAttackers(toDeclareAttackers(s), [[auntie]]);
    s = drive(s, { yes: [true], objects: [[bear]] });
    s = resolveAll(s, { yes: [true], objects: [[bear]] });
    expect(countersOn(s, bear)).toEqual({ '-1/-1': 1 });
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(token).toBeDefined();
    expect(getChars(s, token)!.names).toEqual(['Test Bear']);
    expect(ptOf(s, token)).toBe('2/2'); // counters are not copied (CR 707.2)
    expect(s.objects[token]!.tapped).toBe(true);
    expect(s.combat?.attackers.map((a) => a.id).sort()).toEqual([auntie, token].sort()); // CR 508.4: attacking, never declared as an attacker
    s = toStep(passUntil(s, (x) => x.pending?.kind === 'declareBlockers' || x.turn.step === 'combatDamage', 'blockers'), 'main2');
    expect(lifeOf(s, 'p2')).toBe(15);
    s = resolveAll(drive(toStep(s, 'end')));
    expect(s.objects[token]?.zone ?? 'gone').not.toBe('battlefield');
    expect(s.objects[bear]!.zone).toBe('battlefield');
  });
  it('CR 118.12: if you don\'t blight, no token is created', () => {
    let s = scenario([], { defs: [...COMMON, AUNTIE], p1: { battlefield: ['Test Auntie', 'Test Bear'] } });
    s = declareAttackers(toDeclareAttackers(s), [[find(s, 'Test Auntie', 'battlefield', 'p1')]]);
    s = resolveAll(drive(s, { yes: [false] }), { yes: [false] });
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token')).toBe(false);
    expect(countersOn(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toEqual({});
  });
});

describe('CR 701.4a, 702.34a: "Flashback—{0}, Behold two Goblins."', () => {
  const RALLY_CRY = card('Test Rally Cry', 'Sorcery', 'You gain 3 life.\nFlashback—{0}, Behold two Goblins.');
  it('is understood', () => expect(noManual(RALLY_CRY)).toBe(true));
  it('it is cast from the graveyard by beholding two Goblins (a Goblin you control and a Goblin card revealed from your hand), and not with one', () => {
    let s = scenario([], { defs: [...COMMON, RALLY_CRY], p1: { graveyard: ['Test Rally Cry'], hand: ['Test Goblin Scout'], battlefield: ['Test Goblin'] } });
    expect(castable(s, 'Test Rally Cry', 'p1', 'graveyard')).toBe(true);
    s = resolveAll(cast(s, 'Test Rally Cry', {}, 'p1', 'flashback', 'graveyard'));
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Rally Cry')).toBe(true); // CR 702.34a: exiled
    expect(handNames(s, 'p1')).toEqual(['Test Goblin Scout']); // a revealed card stays in the hand (CR 701.4a)
    const one = scenario([], { defs: [...COMMON, RALLY_CRY], p1: { graveyard: ['Test Rally Cry'], battlefield: ['Test Goblin'] } });
    expect(castable(one, 'Test Rally Cry', 'p1', 'graveyard')).toBe(false);
  });
});

describe('CR 608.2c, 701.68a: "Draw a card. Then if you control three or more creatures, blight 1." / "..., create a token"', () => {
  const OMEN = card('Test Withering Omen', 'Sorcery', 'Draw a card. Then if you control three or more creatures, blight 1.');
  const FORGE = card('Test Thopter Forge', 'Sorcery', 'Draw a card. Then if you control two or more artifacts, create a 1/1 colorless Thopter artifact creature token with flying.');
  it('is understood', () => {
    expect(noManual(OMEN)).toBe(true);
    expect(noManual(FORGE)).toBe(true);
  });
  it('with three creatures you put a -1/-1 counter on one of them; with two, nothing happens after the draw', () => {
    let s = scenario([], { defs: [...COMMON, OMEN], p1: { hand: ['Test Withering Omen'], battlefield: ['Test Bear', 'Test Drake', 'Test Elf'] } });
    const drake = find(s, 'Test Drake', 'battlefield', 'p1');
    s = castAndResolve(s, 'Test Withering Omen', { objects: [[drake]] });
    expect(countersOn(s, drake)).toEqual({ '-1/-1': 1 });
    let t = scenario([], { defs: [...COMMON, OMEN], p1: { hand: ['Test Withering Omen'], battlefield: ['Test Bear', 'Test Drake'] } });
    t = castAndResolve(t, 'Test Withering Omen');
    expect(t.zones.battlefield.every((id) => Object.values(t.objects[id]!.counters).every((n) => n === 0))).toBe(true);
  });
  it('with two artifacts the Thopter is created; with one it is not', () => {
    let s = scenario([], { defs: [...COMMON, FORGE], p1: { hand: ['Test Thopter Forge'], battlefield: ['Test Relic', 'Test Relic'] } });
    s = castAndResolve(s, 'Test Thopter Forge');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(1);
    let t = scenario([], { defs: [...COMMON, FORGE], p1: { hand: ['Test Thopter Forge'], battlefield: ['Test Relic'] } });
    t = castAndResolve(t, 'Test Thopter Forge');
    expect(t.zones.battlefield.filter((id) => t.objects[id]!.kind === 'token').length).toBe(0);
  });
});

describe('CR 115.1, 120.3: "~ deals 1 damage to each creature target player controls."', () => {
  const SPARKS = card('Test Sparks', 'Sorcery', '~ deals 1 damage to each creature target player controls.');
  it('is understood', () => expect(noManual(SPARKS)).toBe(true));
  it('the creatures of the target player are dealt the damage; yours are not', () => {
    let s = scenario([], { defs: [...COMMON, SPARKS], p1: { hand: ['Test Sparks'], battlefield: ['Test Elf'] }, p2: { battlefield: ['Test Goblin', 'Test Bear'] } });
    s = castAndResolve(s, 'Test Sparks', { targets: [[player('p2')]] });
    expect(findAll(s, 'Test Goblin', 'graveyard', 'p2').length).toBe(1);
    expect(s.objects[find(s, 'Test Bear', 'battlefield', 'p2')]!.damage).toBe(1);
    expect(s.objects[find(s, 'Test Elf', 'battlefield', 'p1')]!.damage).toBe(0);
  });
});
