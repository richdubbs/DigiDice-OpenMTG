/**
 * Commander round edh-d-6 (EDHREC ranks 10,001-11,250, second pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the
 * game's default compiler, in 4-player games (Alice, p1, is the active player of turn 1). Each test is named after the rule it checks, with its negative case. CR cites are from the
 * Comprehensive Rules text of 2026-09-25 (media.wizards.com), read when the round ran.
 *
 *   CR 601.2f, 118.7, 500.1          "During your turn, ~ costs {2}{U}{U} less to cast." (Discontinuity)
 *   CR 602.2b, 601.2f, 122.1         "This ability costs {1} less to activate for each +1/+1 counter on creatures you control." (Deepwood Denizen)
 *   CR 603.2c, 400.3, 603.6c         "Whenever one or more noncreature permanents are returned to hand, ..." (Tameshi, Reality Architect)
 *   CR 715.3a, 707.10, 205.3k        "Whenever you cast an Adventure instant or sorcery spell, copy it." (Lucky Clover)
 *   CR 613.1d-f, 613.4b              "Equipped creature has base power and toughness 5/5, has menace, and is a black Demon in addition to its other colors and types." (Blade of the Oni)
 *   CR 607.2a, 108.3, 601.2, 118.9   "the exiled card's owner may cast that card without paying its mana cost" / "you may cast the exiled card without paying its mana cost. If you do, ..." (Spell Queller, Smuggler's Buggy)
 *   CR 701.35a, 611.2c               "Detain each nonland permanent your opponents control with mana value 4 or less." (Lavinia of the Tenth)
 *   CR 603.2, 700.4, 510.2           "Whenever ~ or another nontoken Spirit you control dies or deals combat damage to a player, ..." (Millicent, Restless Revenant)
 *   CR 700.12, 106.6                 "Enchanted land has "{T}: Add two mana of any one color. Spend this mana only to cast outlaw spells or activate abilities of outlaw sources."" (Discreet Retreat; render only)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, pass, put } from '../../m3/scenario';
import { applyAction } from '../../../src/index';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const hand = (s: GameState, p: string): ObjectId[] => s.zones.hand[p] ?? [];
const yard = (s: GameState, p: string): string[] => (s.zones.graveyard[p] ?? []).map((id) => s.objects[id]!.defId);
const lib = (s: GameState, p: string): string[] => (s.zones.library[p] ?? []).map((id) => s.objects[id]!.defId);
const inHand = (s: GameState, p: string, name: string): boolean => hand(s, p).some((id) => s.objects[id]!.defId === name);
const exiled = (s: GameState, name: string): ObjectId[] => s.zones.exile.filter((id) => s.objects[id]!.defId === name);
const lost = (s: GameState, p: string): boolean => s.players.find((x) => x.id === p)!.hasLost;
/** An Aura (or any attached object) of the card `name` that `owner` controls, attached to a player or an object. */
const attach = (s: GameState, name: string, to: ObjectId, owner = 'p1'): GameState => tweak(s, (t) => { t.objects[put(t, owner, 'battlefield', name)]!.attachedTo = to; });

interface Opts { targets?: TargetChoice[][]; picks?: ObjectId[][]; answers?: DecisionAnswer[] }
/** Answer what comes up (targets, object choices, then the answers); pay costs automatically; stop at priority. */
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (p.kind === 'chooseObjects' && o.picks && o.picks.length > 0) s = answer(s, { kind: 'chooseObjects', ids: o.picks.shift()! });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ ...o, targets: [...(o.targets ?? [])], picks: [...(o.picks ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
/** p1 casts a card from their hand, answers what is asked, and lets the stack resolve. */
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
/** p1 activates an ability of a permanent, answers what is asked, and lets the stack resolve. */
function activate(s0: GameState, source: ObjectId, opts: Opts = {}, ability = 'p:0:0'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'activate', player: 'p1', source, ability } as never), q), q);
}
/** Pass (declaring no attackers when asked) until turn `n` begins and its upkeep gives priority. */
function toTurn(s0: GameState, n: number): GameState {
  let s = s0;
  for (let i = 0; i < 400 && !(s.turn.number === n && s.turn.step === 'upkeep' && s.pending?.kind === 'priority'); i++) {
    if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (s.pending?.kind === 'priority') s = pass(s);
    else s = settle(s, {});
  }
  return s;
}


const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2'], '{2}');
const OX = card('Test Ox', 'Creature — Ox', '', ['4', '4'], '{5}');
const RELIC = card('Test Relic', 'Artifact', '', undefined, '{1}');
const SPRING = card('Test Spring', 'Sorcery', 'Return target permanent to its owner\'s hand.');

describe('CR 603.2c, 400.3, 603.6c: "Whenever one or more noncreature permanents are returned to hand, draw a card. This ability triggers only once each turn."', () => {
  const ARCH = card('Test Architect', 'Legendary Creature — Human', 'Whenever one or more noncreature permanents are returned to hand, draw a card. This ability triggers only once each turn.', ['1', '1']);
  const game = () => mpScenario({ defs: [ARCH, BEAR, RELIC, SPRING], zones: { p1: { hand: ['Test Spring', 'Test Spring'], battlefield: ['Test Architect', 'Test Relic', 'Test Bear'] } } });
  it('is automated', () => expect(full(ARCH), JSON.stringify(ARCH.automation)).toBe(true));
  it('returning a noncreature permanent from the battlefield draws a card', () => {
    const s0 = game();
    const before = lib(s0, 'p1').length;
    const s = cast(s0, 'Test Spring', { targets: [[obj(find(s0, 'Test Relic', 'battlefield', 'p1'))]] });
    expect(inHand(s, 'p1', 'Test Relic')).toBe(true);
    expect(lib(s, 'p1').length).toBe(before - 1);
  });
  it('negative: returning a creature draws nothing', () => {
    const s0 = game();
    const before = lib(s0, 'p1').length;
    const s = cast(s0, 'Test Spring', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]] });
    expect(inHand(s, 'p1', 'Test Bear')).toBe(true);
    expect(lib(s, 'p1').length).toBe(before);
  });
  it('negative: it triggers only once each turn (a second return in the same turn draws nothing)', () => {
    const s0 = game();
    const before = lib(s0, 'p1').length;
    const s1 = cast(s0, 'Test Spring', { targets: [[obj(find(s0, 'Test Relic', 'battlefield', 'p1'))]] });
    const s2 = cast(s1, 'Test Spring', { targets: [[obj(find(s1, 'Test Architect', 'battlefield', 'p1'))]] });
    expect(lib(s2, 'p1').length).toBe(before - 1);
  });
});

describe('CR 607.2a, 108.3, 601.2, 118.9: "When ~ leaves the battlefield, the exiled card\'s owner may cast that card without paying its mana cost."', () => {
  const QUELL = card('Test Quell', 'Creature — Faerie', 'Flash\nWhen ~ enters, exile target spell with mana value 4 or less.\nWhen ~ leaves the battlefield, the exiled card\'s owner may cast that card without paying its mana cost.', ['2', '3'], '{0}');
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 3 damage to target player.', undefined, '{0}');
  const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  /** p1 casts Zap at p2, then flashes in Quell exiling it; Quell resolves first. */
  const exiledZap = () => {
    const s0 = mpScenario({ defs: [QUELL, ZAP, SMITE], zones: { p1: { hand: ['Test Zap', 'Test Quell', 'Test Smite'] } } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') } as never), queued({ targets: [[plr('p2')]] }));
    const zap = find(s, 'Test Zap', 'stack');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Quell', 'hand', 'p1') } as never), {});
    return drain(s, queued({ targets: [[obj(zap)]] }));
  };
  it('is automated', () => expect(full(QUELL), JSON.stringify(QUELL.automation)).toBe(true));
  it('the spell is exiled and does not resolve while the creature stays', () => {
    const s = exiledZap();
    expect(exiled(s, 'Test Zap').length).toBe(1);
    expect(life(s, 'p2')).toBe(20);
  });
  it('when the creature leaves, the exiled card\'s owner casts it free (it resolves)', () => {
    const s0 = exiledZap();
    const s = cast(s0, 'Test Smite', { targets: [[obj(find(s0, 'Test Quell', 'battlefield', 'p1'))], [plr('p2')]] });
    expect(life(s, 'p2')).toBe(17);
    expect(exiled(s, 'Test Zap').length).toBe(0);
  });
  it('negative: the owner may decline, and the card stays exiled', () => {
    const s0 = exiledZap();
    const s = cast(s0, 'Test Smite', { targets: [[obj(find(s0, 'Test Quell', 'battlefield', 'p1'))]], answers: [{ kind: 'yesNo', yes: false }] });
    expect(life(s, 'p2')).toBe(20);
    expect(exiled(s, 'Test Zap').length).toBe(1);
  });
});

describe('CR 613.1d, 613.1e, 613.1f, 613.4b: "Equipped creature has base power and toughness 5/5, has menace, and is a black Demon in addition to its other colors and types."', () => {
  const BLADE = card('Test Blade', 'Artifact — Equipment', 'Equipped creature has base power and toughness 5/5, has menace, and is a black Demon in addition to its other colors and types.\nEquip {1}');
  const game = () => mpScenario({ defs: [BLADE, BEAR, OX], zones: { p1: { battlefield: ['Test Blade', 'Test Bear', 'Test Ox'] } } });
  it('is automated', () => expect(full(BLADE), JSON.stringify(BLADE.automation)).toBe(true));
  it('the equipped creature is a 5/5 black Demon with menace, and keeps its type', () => {
    const s0 = game();
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s = attach(s0, 'Test Blade', bear) ;
    const blade = findAll(s, 'Test Blade', 'battlefield', 'p1')[0]!;
    const c = getChars(s, bear)!;
    expect(`${c.power}/${c.toughness}`).toBe('5/5');
    expect(c.subtypes).toEqual(expect.arrayContaining(['Bear', 'Demon']));
    expect(c.colors).toContain('B');
    expect(JSON.stringify(c.abilities ?? c.keywords ?? [])).toContain('menace');
    expect(blade).toBeDefined();
  });
  it('negative: an unequipped creature is unchanged', () => {
    const s0 = game();
    const s = attach(s0, 'Test Blade', find(s0, 'Test Bear', 'battlefield', 'p1'));
    expect(pt(s, find(s, 'Test Ox', 'battlefield', 'p1'))).toBe('4/4');
    expect(getChars(s, find(s, 'Test Ox', 'battlefield', 'p1'))!.subtypes).not.toContain('Demon');
  });
});

describe('CR 701.35a, 611.2c: "Detain each nonland permanent your opponents control with mana value 4 or less."', () => {
  const DETAINER = card('Test Detainer', 'Creature — Angel', 'When ~ enters, detain each nonland permanent your opponents control with mana value 4 or less.', ['2', '2'], '{0}');
  const game = () => cast(mpScenario({ defs: [DETAINER, BEAR, OX], zones: { p1: { hand: ['Test Detainer'] }, p2: { battlefield: ['Test Bear', 'Test Ox'] } } }), 'Test Detainer');
  /** Pass to the declare-attackers decision of turn 2 (p2 is the active player). */
  const toAttackers = (s0: GameState): GameState => {
    let s = toTurn(s0, 2);
    for (let i = 0; i < 40 && s.pending?.kind !== 'declareAttackers'; i++) s = s.pending?.kind === 'priority' ? pass(s) : settle(s, {});
    return s;
  };
  it('is automated', () => expect(full(DETAINER), JSON.stringify(DETAINER.automation)).toBe(true));
  it('a detained permanent (mana value 4 or less) cannot attack until the detainer\'s controller\'s next turn', () => {
    const s = toAttackers(game());
    expect(s.pending?.kind).toBe('declareAttackers');
    const bear = find(s, 'Test Bear', 'battlefield', 'p2');
    expect(applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: bear, defender: 'p1' }] } } as never).error).toBeDefined();
  });
  it('negative: a permanent with mana value 5 is not detained and can attack', () => {
    const s = toAttackers(game());
    const ox = find(s, 'Test Ox', 'battlefield', 'p2');
    expect(applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: ox, defender: 'p1' }] } } as never).error).toBeUndefined();
  });
  it('negative: a permanent that enters later is not detained (the group is fixed when the ability resolves, CR 611.2c)', () => {
    const s0 = game();
    const early = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s1 = tweak(s0, (t) => { put(t, 'p2', 'battlefield', 'Test Bear'); });
    const s = toAttackers(s1);
    const late = findAll(s, 'Test Bear', 'battlefield', 'p2').find((id) => id !== early)!;
    expect(applyAction(s, { type: 'answer', player: 'p2', decisionId: s.pending!.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: late, defender: 'p1' }] } } as never).error?.message).toBeUndefined();
  });
});

describe('CR 603.2, 700.4: "Whenever ~ or another nontoken Spirit you control dies or deals combat damage to a player, create a 1/1 white Spirit creature token with flying."', () => {
  const REV = card('Test Revenant', 'Legendary Creature — Spirit', 'Whenever ~ or another nontoken Spirit you control dies or deals combat damage to a player, create a 1/1 white Spirit creature token with flying.', ['2', '2']);
  const GHOST = card('Test Ghost', 'Creature — Spirit', '', ['1', '1']);
  const SMITE = card('Test Smite', 'Sorcery', 'Destroy target creature.');
  const game = () => mpScenario({ defs: [REV, GHOST, BEAR, SMITE], zones: { p1: { hand: ['Test Smite'], battlefield: ['Test Revenant', 'Test Ghost', 'Test Bear'] } } });
  const tokens = (s: GameState): number => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1').length;
  it('is automated', () => expect(full(REV), JSON.stringify(REV.automation)).toBe(true));
  it('when it dies it makes a Spirit token', () => {
    const s0 = game();
    expect(tokens(cast(s0, 'Test Smite', { targets: [[obj(find(s0, 'Test Revenant', 'battlefield', 'p1'))]] }))).toBe(1);
  });
  it('when another nontoken Spirit you control dies it makes a Spirit token', () => {
    const s0 = game();
    expect(tokens(cast(s0, 'Test Smite', { targets: [[obj(find(s0, 'Test Ghost', 'battlefield', 'p1'))]] }))).toBe(1);
  });
  it('negative: a creature that is not a Spirit dying makes nothing', () => {
    const s0 = game();
    expect(tokens(cast(s0, 'Test Smite', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))]] }))).toBe(0);
  });
});

describe('CR 715.3a, 707.10, 205.3k: "Whenever you cast an Adventure instant or sorcery spell, copy it. You may choose new targets for the copy."', () => {
  const CLOVER = card('Test Clover', 'Artifact', 'Whenever you cast an Adventure instant or sorcery spell, copy it. You may choose new targets for the copy.');
  const ADV = compileCard({
    name: 'Test Rider // Test Gallop', layout: 'adventure', mana_cost: '{0} // {0}', type_line: 'Creature — Elf Knight // Instant — Adventure', colors: [],
    card_faces: [
      { name: 'Test Rider', mana_cost: '{0}', type_line: 'Creature — Elf Knight', oracle_text: '', power: '1', toughness: '1' },
      { name: 'Test Gallop', mana_cost: '{0}', type_line: 'Instant — Adventure', oracle_text: 'Test Gallop deals 1 damage to target player.' },
    ],
  } as unknown as OracleCard);
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to target player.', undefined, '{0}');
  const life = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
  const game = () => mpScenario({ defs: [CLOVER, ADV, ZAP], zones: { p1: { hand: ['Test Rider // Test Gallop', 'Test Zap'], battlefield: ['Test Clover'] } } });
  const castAdv = (s0: GameState): GameState => drain(settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Rider // Test Gallop', 'hand', 'p1'), face: 1 } as never), queued({ targets: [[plr('p2')], [plr('p2')]] })), queued({ targets: [[plr('p2')], [plr('p2')]] }));
  it('is automated', () => expect(full(CLOVER), JSON.stringify(CLOVER.automation)).toBe(true));
  it('casting the Adventure half copies it: the copy and the spell each deal damage', () => {
    const s = castAdv(game());
    expect(life(s, 'p2')).toBe(18);
  });
  it('negative: an instant that is not an Adventure is not copied', () => {
    const s0 = game();
    const s = cast(s0, 'Test Zap', { targets: [[plr('p2')]] });
    expect(life(s, 'p2')).toBe(19);
  });
});

describe('CR 601.2f, 118.7, 500.1: "During your turn, ~ costs {2}{U}{U} less to cast."', () => {
  const DISC = card('Test Discount', 'Instant', 'During your turn, ~ costs {2}{U}{U} less to cast.\nDraw a card.', undefined, '{2}{U}{U}');
  it('is automated', () => expect(full(DISC), JSON.stringify(DISC.automation)).toBe(true));
  it('on your own turn it costs nothing (cast with no mana)', () => {
    const s0 = mpScenario({ defs: [DISC], zones: { p1: { hand: ['Test Discount'] } } });
    const before = lib(s0, 'p1').length;
    const s = cast(s0, 'Test Discount');
    expect(lib(s, 'p1').length).toBe(before - 1);
  });
  it('negative: in an opponent\'s turn it is not reduced (it cannot be cast without mana)', () => {
    const s0 = mpScenario({ defs: [DISC], zones: { p1: { hand: ['Test Discount'] } } });
    let s = toTurn(s0, 2);
    for (let i = 0; i < 4 && s.pending?.player !== 'p1'; i++) s = pass(s);
    expect(s.pending?.player).toBe('p1');
    expect(s.turn.activePlayer).toBe('p2');
    expect(applyAction(s, { type: 'cast', player: 'p1', card: find(s, 'Test Discount', 'hand', 'p1') } as never).error).toBeDefined();
  });
});

describe('CR 602.2b, 601.2f, 122.1: "This ability costs {1} less to activate for each +1/+1 counter on creatures you control."', () => {
  const WELL = card('Test Well', 'Creature — Elf', '{3}, {T}: Draw a card. This ability costs {1} less to activate for each +1/+1 counter on creatures you control.', ['1', '1']);
  const game = (counters: number) => mpScenario({ defs: [WELL, BEAR], zones: { p1: { battlefield: ['Test Well', { name: 'Test Bear', counters: { '+1/+1': counters } }] } } });
  it('is automated', () => expect(full(WELL), JSON.stringify(WELL.automation)).toBe(true));
  it('with three +1/+1 counters among your creatures the ability costs nothing', () => {
    const s0 = game(3);
    const before = lib(s0, 'p1').length;
    const s = activate(s0, find(s0, 'Test Well', 'battlefield', 'p1'));
    expect(lib(s, 'p1').length).toBe(before - 1);
  });
  it('negative: with two counters the ability still costs {1} (it cannot be paid with no mana)', () => {
    const s0 = game(2);
    expect(applyAction(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Well', 'battlefield', 'p1'), ability: 'p:0:0' } as never).error).toBeDefined();
  });
});

describe('CR 607.2a, 601.2, 118.9, 608.2c: "You may cast the exiled card without paying its mana cost. If you do, return ~ to its owner\'s hand."', () => {
  const CACHE = card('Test Cache', 'Artifact', 'When ~ enters, exile target nonland permanent an opponent controls.\n{T}: You may cast the exiled card without paying its mana cost. If you do, return ~ to its owner\'s hand.', undefined, '{0}');
  const game = () => {
    const s0 = mpScenario({ defs: [CACHE, BEAR], zones: { p1: { hand: ['Test Cache'] }, p2: { battlefield: ['Test Bear'] } } });
    return cast(s0, 'Test Cache', { targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p2'))]] });
  };
  it('is automated', () => expect(full(CACHE), JSON.stringify(CACHE.automation)).toBe(true));
  it('casting the exiled card puts it onto the battlefield and returns the artifact to its owner\'s hand', () => {
    const s0 = game();
    expect(exiled(s0, 'Test Bear').length).toBe(1);
    const s = activate(s0, find(s0, 'Test Cache', 'battlefield', 'p1'), {}, 'p:0:1');
    expect(findAll(s, 'Test Bear', 'battlefield').filter((id) => s.objects[id]!.controller === 'p1').length).toBe(1);
    expect(inHand(s, 'p1', 'Test Cache')).toBe(true);
  });
  it('negative: declining the cast leaves the card exiled and the artifact on the battlefield', () => {
    const s0 = game();
    const s = activate(s0, find(s0, 'Test Cache', 'battlefield', 'p1'), { answers: [{ kind: 'yesNo', yes: false }] }, 'p:0:1');
    expect(exiled(s, 'Test Bear').length).toBe(1);
    expect(inHand(s, 'p1', 'Test Cache')).toBe(false);
  });
});
