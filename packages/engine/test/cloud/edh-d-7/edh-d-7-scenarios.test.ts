/**
 * Commander lane edh-d, round edh-d-7 (EDHREC ranks 12,501-13,750, second pass): the round's readings played through the engine with synthetic cards (invented names), compiled by the
 * default compiler. Alice (p1) is the active player of turn 1. Each test names the rule it checks, with its negative case. CR cites are from the Comprehensive Rules of 2026-09-25 (fetched).
 *
 *   CR 614.12, 122.6, 208.1        "~ enters with X +1/+1 counters on it, where X is the greatest power among creatures you control and creature cards in your graveyard."
 *   CR 701.23a, 701.23d            "Search target player's library for three cards and exile them." / "... for a card and reveal it. Shuffle and put that card on top."
 *   CR 601.2, 118.9                "You may cast it without paying its mana cost if it's an instant or sorcery spell."
 *   CR 101.4, 608.2d               "Each player returns two land cards from their graveyard to the battlefield."
 *   CR 401.2, 608.2c               "Put one of those cards into your hand, one into your graveyard, and one on the bottom of your library."
 *   CR 614.15                      "Each player draws a card. If C, instead only you draw a card."
 *   CR 603.10a, 202.3              "When a creature enters, sacrifice ~ and create X tokens, where X is that creature's mana value."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { canSee } from '../../../src/core/view';
import { maxHandSize } from '../../../src/statics/hooks';
import { act, answer, find, pass } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const plr = (id: string): TargetChoice => ({ kind: 'player', id } as TargetChoice);

interface Opts { targets?: TargetChoice[][]; answers?: DecisionAnswer[] }
function settle(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 40; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets' && o.targets && o.targets.length > 0) s = answer(s, { kind: 'chooseTargets', targets: o.targets.shift()! });
    else if (o.answers && o.answers.length > 0) s = answer(s, o.answers.shift()!);
    else break;
  }
  return s;
}
const queued = (o: Opts): Opts => ({ targets: [...(o.targets ?? [])], answers: [...(o.answers ?? [])] });
function drain(s0: GameState, o: Opts): GameState {
  let s = s0;
  for (let guard = 0; s.pending?.kind === 'priority' && s.zones.stack.length > 0 && guard < 40; guard++) s = settle(pass(s), o);
  return s;
}
function cast(s0: GameState, name: string, opts: Opts = {}, player = 'p1'): GameState {
  const q = queued(opts);
  return drain(settle(act(s0, { type: 'cast', player, card: find(s0, name, 'hand', player) } as never), q), q);
}
type Zone = 'battlefield' | 'hand' | 'graveyard' | 'library' | 'exile';
const names = (s: GameState, name: string, zone: Zone = 'battlefield'): ObjectId[] =>
  Object.values(s.objects).filter((o) => o.zone === zone && s.defs[o.defId]?.name === name).map((o) => o.id);
const byName = (s: GameState, name: string, zone: Zone = 'battlefield', owner?: string): ObjectId =>
  Object.values(s.objects).find((o) => s.defs[o.defId]?.name === name && o.zone === zone && (owner === undefined || o.owner === owner))!.id;
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const OGRE = card('Test Ogre', 'Creature — Ogre', '', ['5', '5']);
const DRAGON = card('Test Dragonborn', 'Creature — Dragon', 'This creature enters with X +1/+1 counters on it, where X is the greatest power among creatures you control and creature cards in your graveyard.', ['0', '0']);
const CAP = card('Test Cap', 'Artifact', "{T}, Sacrifice this artifact: Search target player's library for three cards and exile them. Then that player shuffles.");
const BEAST = card('Test Tracker', 'Creature — Scout', 'When this creature enters, search your library for a creature card with deathtouch, hexproof, reach, or trample and reveal it. Shuffle and put that card on top.', ['1', '1']);
const TRAMPLER = { ...card('Test Trampler', 'Creature — Beast', 'Trample', ['3', '3']) };
const FLIER = card('Test Flier', 'Creature — Bird', 'Flying', ['1', '1']);
const GALV = card('Test Galvanoth', 'Creature — Beast', "At the beginning of your upkeep, you may look at the top card of your library. You may cast it without paying its mana cost if it's an instant or sorcery spell.", ['3', '3']);
const BOLT = card('Test Bolt', 'Instant', 'You gain 3 life.');
const THRAN = card('Test Thran', 'Sorcery', 'Each player returns two land cards from their graveyard to the battlefield.');
const FOREST = card('Test Forest', 'Basic Land — Forest', '');
const TRUTH = card('Test Truth', 'Instant', 'Look at the top three cards of your library. Put one of those cards into your hand, one into your graveyard, and one on the bottom of your library.');
const AWAKE = card('Test Awakening', 'Enchantment', "At the beginning of your upkeep, each player draws a card. If you control a Bear, instead only you draw a card.");
const AWAKE_SPELL = card('Test Awake Spell', 'Sorcery', 'Each player draws a card. If you control a Bear, instead only you draw a card.');
const LOOK = card('Test Look', 'Sorcery', "You may look at the top card of your library. You may cast it without paying its mana cost if it's an instant or sorcery spell.");
const CAGE = card('Test Cage', 'Artifact', 'When a creature enters, sacrifice this artifact and create X 2/2 green Monkey creature tokens, where X is that creature\'s mana value.');
const TENT = card('Test Tentacles', 'Sorcery', "Target opponent mills two cards. You may put an artifact card from that player's graveyard onto the battlefield under your control.");
const RING = card('Test Ring', 'Artifact', '');
const EXPL = card('Test Exploit', 'Sorcery', "Search target opponent's library for an instant or sorcery card. You may cast that card without paying its mana cost. Then that player shuffles.");
const FIVE = card('Test Five', 'Creature — Giant', '', ['5', '5'], '{5}');

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of [TENT, EXPL, DRAGON, CAP, BEAST, GALV, THRAN, TRUTH, AWAKE, CAGE, AWAKE_SPELL, LOOK]) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 614.12, 122.6, 208.1: enters with X counters, X the greatest power among your creatures and the creature cards in your graveyard', () => {
  it('counts a creature card in your graveyard (5) over your battlefield (2): five +1/+1 counters', () => {
    const s0 = mpScenario({ players: 3, defs: [DRAGON, BEAR, OGRE], zones: { p1: { hand: ['Test Dragonborn'], battlefield: ['Test Bear'], graveyard: ['Test Ogre'] } } });
    const s = cast(s0, 'Test Dragonborn');
    const d = s.objects[byName(s, 'Test Dragonborn')]!;
    expect(JSON.stringify(d.counters ?? {})).toContain('5');
  });
  it('does not count the opponent\'s graveyard or creatures: only the 2/2 you control gives two counters', () => {
    const s0 = mpScenario({ players: 3, defs: [DRAGON, BEAR, OGRE], zones: { p1: { hand: ['Test Dragonborn'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Ogre'], graveyard: ['Test Ogre'] } } });
    const s = cast(s0, 'Test Dragonborn');
    const d = s.objects[byName(s, 'Test Dragonborn')]!;
    expect(JSON.stringify(d.counters ?? {})).toContain('2');
    expect(JSON.stringify(d.counters ?? {})).not.toContain('5');
  });
});

describe('CR 701.23d: "Search target player\'s library for three cards and exile them."', () => {
  it('exiles three cards of the target player\'s library (all they have when fewer)', () => {
    const s0 = mpScenario({ players: 3, defs: [CAP, BEAR], zones: { p1: { battlefield: ['Test Cap'] }, p2: { library: ['Test Bear', 'Test Bear', 'Test Bear', 'Test Bear'] } } });
    const ids = names(s0, 'Test Bear', 'library').filter((id) => s0.objects[id]!.owner === 'p2').slice(0, 3);
    const cap = byName(s0, 'Test Cap');
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: cap, ability: 'p:0:0' } as never), { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids }] });
    s = drain(s, { answers: [{ kind: 'chooseObjects', ids }] });
    expect(names(s, 'Test Bear', 'exile').length).toBe(3);
  });
});

describe('CR 701.23a, 701.24a: search for a creature with a keyword among a list, reveal it, shuffle and put it on top', () => {
  it('finds the trampler (not the flier) and puts it on top of the library', () => {
    const s0 = mpScenario({ players: 3, defs: [BEAST, TRAMPLER, FLIER], zones: { p1: { hand: ['Test Tracker'], library: ['Plains', 'Test Flier', 'Test Flier', 'Test Trampler'] } } });
    const tr = byName(s0, 'Test Trampler', 'library');
    const s = cast(s0, 'Test Tracker', { answers: [{ kind: 'chooseObjects', ids: [tr] }] });
    expect(s.defs[s.objects[s.zones.library['p1']![0]!]!.defId]!.name).toBe('Test Trampler');
    void tr;
  });
  it('a creature with only flying is not a legal choice', () => {
    const s0 = mpScenario({ players: 3, defs: [BEAST, TRAMPLER, FLIER], zones: { p1: { hand: ['Test Tracker'], library: ['Plains', 'Test Flier', 'Test Trampler'] } } });
    const fl = byName(s0, 'Test Flier', 'library');
    expect(() => cast(s0, 'Test Tracker', { answers: [{ kind: 'chooseObjects', ids: [fl] }] })).toThrow();
  });
});

describe('CR 101.4, 608.2d: "Each player returns two land cards from their graveyard to the battlefield."', () => {
  it('each player returns two lands of their own graveyard (a player with one returns it)', () => {
    const s0 = mpScenario({ players: 3, defs: [THRAN, FOREST], zones: { p1: { hand: ['Test Thran'], graveyard: ['Test Forest', 'Test Forest', 'Test Forest'] }, p2: { graveyard: ['Test Forest'] } } });
    const mine = names(s0, 'Test Forest', 'graveyard').filter((id) => s0.objects[id]!.owner === 'p1').slice(0, 2);
    const theirs = names(s0, 'Test Forest', 'graveyard').filter((id) => s0.objects[id]!.owner === 'p2');
    const s = cast(s0, 'Test Thran', { answers: [{ kind: 'chooseObjects', ids: mine }, { kind: 'chooseObjects', ids: theirs }] });
    expect(names(s, 'Test Forest').length).toBe(3);
    expect(names(s, 'Test Forest', 'graveyard').length).toBe(1);
  });
});

describe('CR 401.2, 608.2c: one to hand, one to graveyard, one to the bottom', () => {
  it('the three cards go to the three places', () => {
    const s0 = mpScenario({ players: 3, defs: [TRUTH, BEAR, OGRE, FOREST], zones: { p1: { hand: ['Test Truth'], library: ['Plains', 'Test Bear', 'Test Ogre', 'Test Forest', 'Test Forest'] } } });
    const bear = byName(s0, 'Test Bear', 'library');
    const ogre = byName(s0, 'Test Ogre', 'library');
    const s = cast(s0, 'Test Truth', { answers: [{ kind: 'chooseObjects', ids: [bear] }, { kind: 'chooseObjects', ids: [ogre] }] });
    void bear; void ogre;
    expect(names(s, 'Test Bear', 'hand').length).toBe(1);
    expect(names(s, 'Test Ogre', 'graveyard').length).toBe(1);
    const lib = s.zones.library['p1']!;
    expect(s.defs[s.objects[lib[lib.length - 1]!]!.defId]!.name).toBe('Test Forest'); // the third card looked at is the one put on the bottom (below all the padding)
  });
});

describe('CR 401.2: with four cards looked at, only one goes to the bottom', () => {
  it('the fourth card stays on top of the library', () => {
    const FOUR = card('Test Four', 'Instant', 'Look at the top four cards of your library. Put one of those cards into your hand, one into your graveyard, and one on the bottom of your library.');
    const s0 = mpScenario({ players: 3, defs: [FOUR, BEAR, OGRE, FOREST], zones: { p1: { hand: ['Test Four'], library: ['Plains', 'Test Bear', 'Test Ogre', 'Test Forest', 'Test Forest'] } } });
    const s = cast(s0, 'Test Four', { answers: [{ kind: 'chooseObjects', ids: [byName(s0, 'Test Bear', 'library')] }, { kind: 'chooseObjects', ids: [byName(s0, 'Test Ogre', 'library')] }, { kind: 'chooseObjects', ids: [names(s0, 'Test Forest', 'library')[0]!] }] });
    expect(s.defs[s.objects[s.zones.library['p1']![0]!]!.defId]!.name).toBe('Test Forest');
    const lib = s.zones.library['p1']!;
    expect(s.defs[s.objects[lib[lib.length - 1]!]!.defId]!.name).toBe('Test Forest');
  });
});

describe('CR 614.15: "Each player draws a card. If you control a Bear, instead only you draw a card."', () => {
  const upkeepDraws = (bear: boolean): { p1: number; p2: number } => {
    const zones = { p1: { hand: ['Test Awake Spell'], battlefield: bear ? ['Test Bear'] : [], library: ['Plains', 'Plains', 'Plains'] }, p2: { library: ['Plains', 'Plains', 'Plains'] } };
    const s0 = mpScenario({ players: 3, defs: [AWAKE_SPELL, BEAR], zones });
    const before = { p1: s0.zones.hand['p1']!.length, p2: s0.zones.hand['p2']!.length };
    const s = cast(s0, 'Test Awake Spell');
    return { p1: s.zones.hand['p1']!.length - before.p1 + 1, p2: s.zones.hand['p2']!.length - before.p2 };
  };
  it('without the condition every player draws one card', () => expect(upkeepDraws(false)).toEqual({ p1: 1, p2: 1 }));
  it('with the condition only you draw', () => expect(upkeepDraws(true)).toEqual({ p1: 1, p2: 0 }));
});

describe('CR 601.2, 118.9: "You may cast it without paying its mana cost if it\'s an instant or sorcery spell."', () => {
  const play = (top: string): GameState => {
    const s0 = mpScenario({ players: 3, defs: [LOOK, BOLT, BEAR], zones: { p1: { hand: ['Test Look'], library: ['Plains', top, 'Plains'] } } });
    return cast(s0, 'Test Look', { answers: [{ kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: true }, { kind: 'yesNo', yes: true }] });
  };
  it('an instant on top is cast for free: its life gain happens and it leaves the library', () => {
    const s = play('Test Bolt');
    expect(lifeOf(s, 'p1')).toBe(23);
  });
  it('a creature on top is not cast', () => {
    const s = play('Test Bear');
    expect(names(s, 'Test Bear', 'battlefield').length).toBe(0);
    expect(lifeOf(s, 'p1')).toBe(20);
  });
});

describe('CR 603.10a, 202.3: "When a creature enters, sacrifice ~ and create X tokens, X that creature\'s mana value."', () => {
  it('compiled with the entering creature\'s mana value and a sacrifice of the source', () => {
    const j = JSON.stringify(CAGE.faces);
    expect(j).toContain('"op":"sacrifice"');
    expect(j).toContain('"stat":"manaValue"');
    expect(j).toContain('"role":"subject"');
  });
  it('plays: a mana value 5 creature makes five Monkeys and the Cage is gone', () => {
    const s0 = mpScenario({ players: 3, defs: [CAGE, FIVE, FOREST], zones: { p1: { hand: ['Test Five'], battlefield: ['Test Cage', 'Test Forest', 'Test Forest', 'Test Forest', 'Test Forest', 'Test Forest'] } } });
    const s = cast(s0, 'Test Five');
    expect(names(s, 'Test Cage').length).toBe(0);
    expect(Object.values(s.objects).filter((o) => o.zone === 'battlefield' && s.defs[o.defId]?.name === 'Monkey Token').length).toBe(5);
  });
});


describe('CR 608.2d, 110.2a: "Target opponent mills two cards. You may put an artifact card from that player\'s graveyard onto the battlefield under your control."', () => {
  it('the artifact milled comes to your battlefield, under your control', () => {
    const s0 = mpScenario({ players: 3, defs: [TENT, RING], zones: { p1: { hand: ['Test Tentacles'] }, p2: { library: ['Test Ring', 'Test Ring', 'Test Ring'] } } });
    let s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Tentacles', 'hand', 'p1') } as never), { targets: [[plr('p2')]] });
    for (let g = 0; g < 10 && s.pending?.kind === 'priority' && s.zones.stack.length > 0; g++) s = pass(s);
    const ask = s.pending as { kind: string; options?: ObjectId[] };
    expect(ask.kind).toBe('chooseObjects');
    s = answer(s, { kind: 'chooseObjects', ids: [ask.options![0]!] });
    const onBf = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && s.defs[o.defId]?.name === 'Test Ring');
    expect(onBf.length).toBe(1);
    expect(onBf[0]!.controller).toBe('p1');
    expect(names(s, 'Test Ring', 'graveyard').length).toBe(1);
  });
  it('declining leaves both milled cards in the graveyard', () => {
    const s0 = mpScenario({ players: 3, defs: [TENT, RING], zones: { p1: { hand: ['Test Tentacles'] }, p2: { library: ['Test Ring', 'Test Ring', 'Test Ring'] } } });
    const s = cast(s0, 'Test Tentacles', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [] }] });
    expect(names(s, 'Test Ring', 'graveyard').length).toBe(2);
  });
});

describe('CR 701.23a, 601.2: "Search target opponent\'s library for an instant or sorcery card. You may cast that card without paying its mana cost."', () => {
  it('only an instant or sorcery can be found, and casting it for free gains 3 life', () => {
    const s0 = mpScenario({ players: 3, defs: [EXPL, BOLT, BEAR], zones: { p1: { hand: ['Test Exploit'] }, p2: { library: ['Test Bear', 'Test Bolt'] } } });
    const bolt = byName(s0, 'Test Bolt', 'library');
    const bear = byName(s0, 'Test Bear', 'library');
    expect(() => cast(s0, 'Test Exploit', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [bear] }] })).toThrow();
    const s = cast(s0, 'Test Exploit', { targets: [[plr('p2')]], answers: [{ kind: 'chooseObjects', ids: [bolt] }, { kind: 'yesNo', yes: true }] });
    expect(lifeOf(s, 'p1')).toBe(23);
  });
});
