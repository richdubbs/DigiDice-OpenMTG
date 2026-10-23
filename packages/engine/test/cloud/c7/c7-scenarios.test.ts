/**
 * Cloud batch 3, C7: "this way" results of an earlier instruction (CR 608.2c, 608.2h). Later text in the same resolution reads what an earlier instruction
 * actually did: the objects a destroy destroyed, a sacrifice sacrificed, a discard discarded, a mill put into a graveyard, a move put into its destination
 * (effects/api.ts#StepResult.before; `{q:'resultCount', which}`, `{cond:'did', which, to}`). Played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 701.8a, 702.12b, 111.7     "Destroy all creatures. You gain 3 life for each creature destroyed this way."
 *   CR 701.17a, 614.1a, 608.2c    "Mill four cards. You gain 1 life for each card put into your graveyard this way." (a replaced move counts where the card went)
 *   CR 701.13a, 608.2c            "Exile target card from a graveyard. If a creature card was exiled this way, you gain 2 life."
 *   CR 701.9a, 608.2h             "Each opponent discards two cards. You draw a card for each creature card discarded this way."
 *   CR 701.21a, 608.2d            "Sacrifice any number of creatures. You gain 2 life for each creature sacrificed this way."; "If a Goblin was sacrificed this way"
 *   CR 608.2c, 118.12             "You may put a creature card from your hand onto the battlefield. If you put an artifact onto the battlefield this way, ..."
 *   CR 608.2c                     "Exile the top two cards of your library. You may play them this turn. If you exiled a land card this way, ..."
 *   design 6.4 (fail closed)      two candidate instructions, none, an earlier sentence that is not understood, a moved object that is not counted
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { performedByYou } from '../../../src/parser/lower/conditions';
import type { Unit } from '../../../src/parser/lower/types';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const hand = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const onField = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);

type Target = { kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId };
/** Answer the decisions until priority: payments automatic, the targets in order, `pick` for object choices (default: the first allowed), yes to "may". */
function drive(s0: GameState, targets: Target[][] = [], pick?: (options: ObjectId[], min: number, max: number) => ObjectId[], yes = true): GameState {
  let s = s0;
  const q = [...targets];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(p.options, p.min, p.max) : p.options.slice(0, Math.max(p.min, 1)) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, ...rest: [Target[][]?, Parameters<typeof drive>[2]?, boolean?]): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), ...rest);
  return s;
}
const cast = (s: GameState, name: string, targets: Target[][] = [], pick?: Parameters<typeof drive>[2], yes = true): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), targets, pick, yes), targets, pick, yes);
const activate = (s: GameState, name: string, pick?: Parameters<typeof drive>[2], yes = true): GameState => {
  const src = find(s, name, 'battlefield', 'p1');
  const a = legal(s, 'p1', 'activate').find((x) => x.object === src);
  if (a === undefined) throw new Error(`no activation of ${name}`);
  return resolveAll(drive(act(s, a.action), [], pick, yes), [], pick, yes);
};

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
const GOLEM = card('Test Golem', 'Artifact Creature — Golem', '', { pt: ['3', '3'] });
const WALL = card('Test Wall', 'Creature — Wall', 'Indestructible', { pt: ['0', '4'] });
const RECRUITER = card('Test Recruiter', 'Artifact', '{0}: Create a 1/1 white Soldier creature token.');

describe('CR 701.8a, 702.12b, 111.7: "Destroy all creatures. You gain 3 life for each creature destroyed this way."', () => {
  const PURGE = card('Test Purge', 'Sorcery', 'Destroy all creatures. You gain 3 life for each creature destroyed this way.');
  it('is understood', () => expect(noManual(PURGE)).toBe(true));
  it('counts what was destroyed: every creature of every player and a token (it was destroyed, CR 111.7), never an indestructible one (CR 702.12b)', () => {
    let s = scenario([], { defs: [PURGE, BEAR, WALL, RECRUITER], p1: { hand: ['Test Purge'], battlefield: ['Test Bear', 'Test Recruiter'] }, p2: { battlefield: ['Test Bear', 'Test Wall'] } });
    s = activate(s, 'Test Recruiter');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.kind === 'token')).toBe(true);
    const before = life(s, 'p1');
    s = cast(s, 'Test Purge');
    expect(onField(s, 'Test Bear')).toEqual([]);
    expect(onField(s, 'Test Wall')).toHaveLength(1); // indestructible: not destroyed (CR 702.12b)
    expect(life(s, 'p1')).toBe(before + 9); // two Bears and the Soldier token, 3 life each
  });
  it('CR 608.2c: nothing destroyed, nothing gained', () => {
    let s = scenario([], { defs: [PURGE, WALL], p1: { hand: ['Test Purge'] }, p2: { battlefield: ['Test Wall'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Purge');
    expect(life(s, 'p1')).toBe(before);
  });
});

describe('CR 701.17a, 614.1a, 608.2c: "Mill four cards. You gain 1 life for each card put into your graveyard this way."', () => {
  const MILL = card('Test Grave Count', 'Sorcery', 'Mill four cards. You gain 1 life for each card put into your graveyard this way.');
  const WARDEN = card('Test Warden', 'Enchantment', "If a card would be put into an opponent's graveyard from anywhere, exile it instead.");
  it('is understood', () => { expect(noManual(MILL)).toBe(true); expect(noManual(WARDEN)).toBe(true); });
  it('counts the four cards the mill put into the graveyard', () => {
    let s = scenario([], { defs: [MILL], p1: { hand: ['Test Grave Count'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Grave Count');
    expect(s.zones.graveyard['p1']!.filter((id) => s.objects[id]!.defId === 'Plains')).toHaveLength(4);
    expect(life(s, 'p1')).toBe(before + 4);
  });
  it('CR 614.1a: a card a replacement effect exiled instead was not put into a graveyard, so it is not counted', () => {
    let s = scenario([], { defs: [MILL, WARDEN], p1: { hand: ['Test Grave Count'] }, p2: { battlefield: ['Test Warden'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Grave Count');
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Plains')).toHaveLength(4);
    expect(life(s, 'p1')).toBe(before);
  });
});

describe('CR 701.13a, 608.2c: "Exile target card from a graveyard. If a creature card was exiled this way, you gain 2 life."', () => {
  const TAKER = card('Test Soul Taker', 'Sorcery', 'Exile target card from a graveyard. If a creature card was exiled this way, you gain 2 life.');
  const LEAST = card('Test Grave Robber', 'Sorcery', 'Exile up to two target cards from a single graveyard. If at least one creature card was exiled this way, you gain 2 life.');
  it('is understood', () => { expect(noManual(TAKER)).toBe(true); });
  it('a creature card exiled: the condition holds', () => {
    let s = scenario([], { defs: [TAKER, BEAR], p1: { hand: ['Test Soul Taker'] }, p2: { graveyard: ['Test Bear'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Soul Taker', [[{ kind: 'object', id: find(s, 'Test Bear', 'graveyard', 'p2') }]]);
    expect(life(s, 'p1')).toBe(before + 2);
  });
  it('a land card exiled: it does not', () => {
    let s = scenario([], { defs: [TAKER], p1: { hand: ['Test Soul Taker'] }, p2: { graveyard: ['Plains'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Soul Taker', [[{ kind: 'object', id: find(s, 'Plains', 'graveyard', 'p2') }]]);
    expect(life(s, 'p1')).toBe(before);
  });
  it('"at least one" reads the same as "a" (the compiled ability is the same condition)', () => {
    const json = JSON.stringify(LEAST.faces);
    expect(json).toContain('"cond":"did"');
    expect(json).toContain('"which":{"types":["Creature"],"isCard":true},"to":"exile"');
  });
});

describe('CR 701.9a, 608.2h: "Each opponent discards two cards. You draw a card for each creature card discarded this way."', () => {
  const DRAIN = card('Test Mind Drain', 'Sorcery', 'Each opponent discards two cards. You draw a card for each creature card discarded this way.');
  it('is understood', () => expect(noManual(DRAIN)).toBe(true));
  it('counts only the creature cards among the cards discarded, as they were in the hand', () => {
    let s = scenario([], { defs: [DRAIN, BEAR], p1: { hand: ['Test Mind Drain'] }, p2: { hand: ['Test Bear', 'Plains'] } });
    const before = hand(s, 'p1');
    s = cast(s, 'Test Mind Drain');
    expect(hand(s, 'p2')).toBe(0);
    expect(hand(s, 'p1')).toBe(before - 1 + 1); // the spell left the hand, one card drawn (one creature card discarded)
  });
});

describe('CR 701.21a, 608.2d: "Sacrifice any number of creatures. You gain 2 life for each creature sacrificed this way."', () => {
  const OFFER = card('Test Offering', 'Sorcery', 'Sacrifice any number of creatures. You gain 2 life for each creature sacrificed this way.');
  const TRIBUTE = card('Test Tribute', 'Sorcery', 'Each player sacrifices a creature. If a Goblin was sacrificed this way, you gain 3 life.');
  it('is understood', () => { expect(noManual(OFFER)).toBe(true); expect(noManual(TRIBUTE)).toBe(true); });
  it('the player chooses which of their creatures to sacrifice (two of three): 4 life', () => {
    let s = scenario([], { defs: [OFFER, BEAR], p1: { hand: ['Test Offering'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Offering', [], (options) => options.slice(0, 2));
    expect(onField(s, 'Test Bear')).toHaveLength(2); // one of p1's and p2's (never another player's permanent, CR 701.21a)
    expect(life(s, 'p1')).toBe(before + 4);
  });
  it('choosing none sacrifices nothing and gains nothing', () => {
    let s = scenario([], { defs: [OFFER, BEAR], p1: { hand: ['Test Offering'], battlefield: ['Test Bear'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Offering', [], () => []);
    expect(onField(s, 'Test Bear')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(before);
  });
  it('"If a Goblin was sacrificed this way": an opponent\'s Goblin sacrificed counts; a Bear does not', () => {
    let s = scenario([], { defs: [TRIBUTE, BEAR, GOBLIN], p1: { hand: ['Test Tribute'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Goblin'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Tribute');
    expect(life(s, 'p1')).toBe(before + 3);
    let t = scenario([], { defs: [TRIBUTE, BEAR], p1: { hand: ['Test Tribute'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const before2 = life(t, 'p1');
    t = cast(t, 'Test Tribute');
    expect(life(t, 'p1')).toBe(before2);
  });
});

// Cloud C7 review: "you <verb>ed ... this way" names only what YOU moved, never another player's discard or sacrifice of the same instruction
describe('CR 701.9a, 701.21a, 608.2h: "Each player discards a card. If you discarded a land card this way, ..." reads your own discard only', () => {
  const HARROW = card('Test Harrow', 'Sorcery', 'Each player discards a card. If you discarded a land card this way, you gain 3 life.');
  const CULL = card('Test Cull', 'Sorcery', 'Each player sacrifices a creature. If you sacrificed a Goblin this way, you gain 3 life.');
  it('is understood, with the owner / controller "you" in the description', () => {
    expect(noManual(HARROW)).toBe(true);
    expect(noManual(CULL)).toBe(true);
    expect(JSON.stringify(HARROW.faces)).toContain('"which":{"types":["Land"],"isCard":true,"owner":"you"}');
    expect(JSON.stringify(CULL.faces)).toContain('"which":{"subtypes":["Goblin"],"controller":"you"}');
  });
  it('an opponent discards a land card and you a nonland card: no life (it was not you who discarded the land card)', () => {
    let s = scenario([], { defs: [HARROW, BEAR], p1: { hand: ['Test Harrow', 'Test Bear'] }, p2: { hand: ['Plains'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Harrow');
    expect(hand(s, 'p2')).toBe(0);
    expect(life(s, 'p1')).toBe(before);
  });
  it('you discard a land card: 3 life', () => {
    let s = scenario([], { defs: [HARROW, BEAR], p1: { hand: ['Test Harrow', 'Plains'] }, p2: { hand: ['Test Bear'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Harrow');
    expect(life(s, 'p1')).toBe(before + 3);
  });
  it('an opponent sacrifices a Goblin and you a Bear: no life; you sacrifice a Goblin: 3 life', () => {
    let s = scenario([], { defs: [CULL, BEAR, GOBLIN], p1: { hand: ['Test Cull'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Goblin'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Cull');
    expect(onField(s, 'Test Goblin')).toEqual([]);
    expect(life(s, 'p1')).toBe(before);
    let t = scenario([], { defs: [CULL, BEAR, GOBLIN], p1: { hand: ['Test Cull'], battlefield: ['Test Goblin'] }, p2: { battlefield: ['Test Bear'] } });
    const before2 = life(t, 'p1');
    t = cast(t, 'Test Cull');
    expect(life(t, 'p1')).toBe(before2 + 3);
  });
  it('CR 608.2c: "you put ... this way" reads a move only when you performed it, never one inside another player\'s option or a loop over players', () => {
    const unit = (steps: Record<string, unknown>[]): Unit => ({ index: 0, range: [0, 0], text: 'x', tokens: [], steps, templates: [], experimental: [], flags: [] }) as unknown as Unit;
    const move = { op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'battlefield' } };
    expect(performedByYou([unit([move])], [], move)).toBe(true);
    const mine = { op: 'may', who: { ref: 'you' }, do: [move] };
    expect(performedByYou([unit([mine])], [], move)).toBe(true);
    const theirs = { op: 'may', who: { ref: 'target', id: 'p0' }, do: [move] };
    expect(performedByYou([unit([theirs])], [], move)).toBe(false);
    const loop = { op: 'forEach', over: { ref: 'each', who: 'opponent' }, as: 'p', do: [move] };
    expect(performedByYou([unit([loop])], [], move)).toBe(false);
  });
});

describe('CR 608.2c, 118.12: "You may put a creature card from your hand onto the battlefield. If you put an artifact onto the battlefield this way, ..."', () => {
  const ARTISAN = card('Test Artisan', 'Creature — Human Artificer', '{T}: You may put a creature card from your hand onto the battlefield. If you put an artifact onto the battlefield this way, put two +1/+1 counters on it.', { pt: ['1', '3'] });
  it('is understood', () => expect(noManual(ARTISAN)).toBe(true));
  it('an artifact creature card put onto the battlefield gets the counters', () => {
    let s = scenario([], { defs: [ARTISAN, GOLEM], p1: { battlefield: ['Test Artisan'], hand: ['Test Golem'] } });
    s = activate(s, 'Test Artisan');
    const golem = onField(s, 'Test Golem');
    expect(golem).toHaveLength(1);
    expect(s.objects[golem[0]!]!.counters['+1/+1']).toBe(2);
  });
  it('a creature card that is not an artifact gets none', () => {
    let s = scenario([], { defs: [ARTISAN, BEAR], p1: { battlefield: ['Test Artisan'], hand: ['Test Bear'] } });
    s = activate(s, 'Test Artisan');
    const bear = onField(s, 'Test Bear');
    expect(bear).toHaveLength(1);
    expect(s.objects[bear[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('CR 608.2c: declined, nothing was put onto the battlefield, so nothing happens', () => {
    let s = scenario([], { defs: [ARTISAN, GOLEM], p1: { battlefield: ['Test Artisan'], hand: ['Test Golem'] } });
    s = activate(s, 'Test Artisan', () => [], false); // the option is answered "no" (or by choosing no card)
    expect(onField(s, 'Test Golem')).toEqual([]);
    expect(s.zones.hand['p1']!.filter((id) => s.objects[id]!.defId === 'Test Golem')).toHaveLength(1);
  });
});

describe('CR 608.2c: "Exile the top two cards of your library. You may play them this turn. If you exiled a land card this way, you gain 2 life."', () => {
  const SEER = card('Test Seer', 'Sorcery', 'Exile the top two cards of your library. You may play them this turn. If you exiled a land card this way, you gain 2 life.');
  it('is understood: "this way" names the exile, the one instruction of that kind, not the permission right before it', () => {
    expect(noManual(SEER)).toBe(true);
    let s = scenario([], { defs: [SEER], p1: { hand: ['Test Seer'] } });
    const before = life(s, 'p1');
    s = cast(s, 'Test Seer');
    expect(life(s, 'p1')).toBe(before + 2); // the library is Plains
  });
});

describe('design 6.4: a "this way" reading that has no unique instruction, or reads one that is not understood, is never automated', () => {
  it('two instructions of that kind: manual', () => {
    expect(noManual(card('Test Twin Exile', 'Sorcery', 'Exile target card from a graveyard. Exile target card from a graveyard. You gain 1 life for each card exiled this way.'))).toBe(false);
  });
  it('no instruction of that kind (a destroy is not an exile): manual', () => {
    expect(noManual(card('Test Wrong Verb', 'Sorcery', 'Destroy target creature. You gain 1 life for each card exiled this way.'))).toBe(false);
    expect(noManual(card('Test Wrong Verb II', 'Sorcery', 'Destroy target creature. If a creature card was exiled this way, you gain 2 life.'))).toBe(false);
  });
  it('an earlier sentence that is not understood may have done it: manual', () => {
    expect(noManual(card('Test Murk', 'Sorcery', 'Exile target card from a graveyard. Blorft the glimmer of each zorp. You gain 1 life for each card exiled this way.'))).toBe(false);
  });
  it('a moved object named as an object, not counted, has no reading here: manual', () => {
    // wave 3 merge: after a mill, nothing reads it (C7 reads counts only; Cloud std-eoe's reference reads what a destroy or sacrifice of a group put there)
    expect(noManual(card('Test Recall', 'Sorcery', 'Mill three cards. Return a creature card put into your graveyard this way to the battlefield under your control.'))).toBe(false);
    // ... while after "Destroy all creatures." Cloud std-eoe reads it: one of the cards that destroy put into a graveyard (CR 608.2c, 400.7, 701.8a; Zero Point Ballad)
    expect(noManual(card('Test Recall', 'Sorcery', 'Destroy all creatures. Return a creature card put into a graveyard this way to the battlefield under your control.'))).toBe(true);
  });
});
