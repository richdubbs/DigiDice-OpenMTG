/**
 * Commander lane edh-c, round edh-c-4: the round's readings played through the engine with synthetic cards (invented names), compiled by the game's default compiler.
 * Alice (p1) casts or controls the card under test. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 404.1, 608.2d      "That player exiles two cards from their graveyard." (Curse of Oblivion: fewer cards than that exile all of them)
 *   CR 101.4, 608.2d      "Each player returns a creature they control to its owner's hand." (Curfew: every player chooses their own; a player with none returns nothing)
 *   CR 601.2f, 604.5      "If an opponent controls seven or more lands, ~ costs {6} less to cast." (Avatar of Fury: one opponent with seven, never seven lands among all)
 *   CR 608.2h, 120.3      "You may have ~ deal damage equal to the number of +1/+1 counters on it to target player." (Goblin Razerunners: counted when it resolves)
 *   CR 701.24a, 121.1     "Shuffle any number of cards from your hand into your library, then draw that many cards." (Credit Voucher)
 *   CR 701.21a, 608.2e    "Each player sacrifices all lands they control except for three." (Keldon Firebombers: each player keeps three of their choice)
 *   CR 701.20e, 701.13a   "Look at the top two cards of target opponent's library, then exile one of them." (Thoughtpicker Witch)
 *   CR 205.3i, 305.7      "Enchanted land is every basic land type in addition to its other types." (Nylea's Presence)
 *   CR 614.1a, 614.6      "If a permanent would be put into a graveyard, exile it instead." (Samurai of the Pale Curtain: from the battlefield only)
 *   CR 402.2, 514.1       "Your maximum hand size is equal to the number of hour counters on ~." (Midnight Oil)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, answer, find, findAll, pass } from '../../m3/scenario';
import { activatedAbilities, charsOfObject } from '../../../src/index';
import { maxHandSize } from '../../../src/statics/hooks';
import { mpScenario, resolveStack, lifeOf } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, cost = '{0}', extra: Partial<OracleCard> = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...extra } as OracleCard);
}
/** The key of the first non-mana activated ability of the named permanent. */
const abilityKey = (s: GameState, name: string, p = 'p1'): string => activatedAbilities(s, s.objects[find(s, name, 'battlefield', p)]!).find((i) => i.def.isMana !== true)!.key;
const zoneOf = (s: GameState, p: string, zone: 'hand' | 'graveyard' | 'battlefield' | 'exile' | 'library'): string[] =>
  Object.values(s.objects).filter((o) => o.zone === zone && o.owner === p).map((o) => s.defs[o.defId]!.name);
const count = (s: GameState, p: string, zone: 'hand' | 'graveyard' | 'battlefield' | 'exile' | 'library', name: string): number => zoneOf(s, p, zone).filter((n) => n === name).length;

/** p1 casts the named spell from hand (free), everything resolves; `answers` answer the decisions in order. */
function castAndResolve(s: GameState, name: string, answers: Parameters<typeof resolveStack>[1] = []): GameState {
  let t = act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') } as never);
  if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
  return resolveStack(t, answers);
}

describe('CR 404.1, 608.2d: "That player exiles two cards from their graveyard."', () => {
  const CURSE = card('Test Oblivion Curse', 'Enchantment — Aura Curse', 'Enchant player\nAt the beginning of enchanted player\'s upkeep, that player exiles two cards from their graveyard.');
  const FILL = card('Test Filler', 'Sorcery', 'You gain 1 life.');
  it('is automated', () => expect(CURSE.automation.level).toBe('full'));
  function atUpkeep(grave: number): GameState {
    let s = mpScenario({ players: 3, defs: [CURSE, FILL], zones: { p1: { battlefield: ['Test Oblivion Curse'] }, p2: { graveyard: Array(grave).fill('Test Filler') }, p3: { graveyard: ['Test Filler', 'Test Filler'] } },
      setup: (st) => { Object.values(st.objects).find((o) => st.defs[o.defId]?.name === 'Test Oblivion Curse')!.attachedTo = 'p2'; } });
    for (let i = 0; i < 80 && !(s.pending?.kind === 'chooseObjects' || (s.turn.activePlayer === 'p2' && s.turn.step === 'draw')); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    return s;
  }
  it('three cards in the graveyard: the enchanted player chooses two to exile and keeps the third; the other players are untouched', () => {
    let s = atUpkeep(3);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending?.player).toBe('p2');
    const ids = (s.pending as { options: ObjectId[] }).options;
    s = answer(s, { kind: 'chooseObjects', ids: ids.slice(0, 2) });
    s = resolveStack(s, []);
    expect(zoneOf(s, 'p2', 'exile').length).toBe(2);
    expect(zoneOf(s, 'p2', 'graveyard').length).toBe(1);
    expect(zoneOf(s, 'p3', 'graveyard').length).toBe(2);
  });
  it('one card in the graveyard: that card is exiled, no choice is asked (negative: nothing else happens)', () => {
    const s = atUpkeep(1);
    expect(s.pending?.kind).not.toBe('chooseObjects');
    expect(zoneOf(s, 'p2', 'exile').length).toBe(1);
    expect(zoneOf(s, 'p2', 'graveyard').length).toBe(0);
  });
});

describe('CR 101.4, 608.2d: "Each player returns a creature they control to its owner\'s hand."', () => {
  const CURFEW = card('Test Curfew', 'Instant', 'Each player returns a creature they control to its owner\'s hand.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', { power: '2', toughness: '2' });
  const CAT = card('Test Cat', 'Creature — Cat', '', '{0}', { power: '1', toughness: '1' });
  it('is automated', () => expect(CURFEW.automation.level).toBe('full'));
  it('every player chooses one of their own creatures; a player with no creature returns nothing', () => {
    const s0 = mpScenario({ players: 3, defs: [CURFEW, BEAR, CAT], zones: { p1: { hand: ['Test Curfew'], battlefield: ['Test Bear', 'Test Cat'] }, p2: { battlefield: ['Test Bear', 'Test Cat'] }, p3: {} } });
    const t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Curfew', 'hand', 'p1') } as never);
    let s = t.pending?.kind === 'payCost' ? answer(t, { kind: 'payCost', auto: true }) : t;
    const pick = (st: GameState, who: string, name: string): GameState => {
      expect(st.pending?.kind).toBe('chooseObjects');
      expect(st.pending?.player).toBe(who);
      const opts = (st.pending as { options: ObjectId[] }).options;
      expect(opts.every((id) => st.objects[id]!.controller === who)).toBe(true); // only their own creatures are offered
      return answer(st, { kind: 'chooseObjects', ids: [opts.find((id) => st.defs[st.objects[id]!.defId]!.name === name)!] });
    };
    s = resolveStack(s, []);
    s = pick(s, 'p1', 'Test Cat');
    s = resolveStack(s, []);
    s = pick(s, 'p2', 'Test Bear');
    s = resolveStack(s, []);
    expect(zoneOf(s, 'p1', 'hand')).toContain('Test Cat');
    expect(zoneOf(s, 'p2', 'hand')).toContain('Test Bear');
    expect(count(s, 'p1', 'battlefield', 'Test Bear')).toBe(1);
    expect(count(s, 'p2', 'battlefield', 'Test Cat')).toBe(1);
    expect(zoneOf(s, 'p3', 'hand')).not.toContain('Test Bear');
  });
});

describe('CR 601.2f, 604.5: "If an opponent controls seven or more lands, ~ costs {6} less to cast."', () => {
  const AVATAR = card('Test Avatar', 'Creature — Avatar', 'If an opponent controls seven or more lands, this spell costs {6} less to cast.\nFlying', '{6}{R}{R}', { power: '6', toughness: '6' });
  it('is automated', () => expect(AVATAR.automation.level).toBe('full'));
  const cast = (p2Lands: number, p3Lands: number): boolean => {
    const s = mpScenario({ players: 3, cards: ['Mountain'], defs: [AVATAR], zones: { p1: { hand: ['Test Avatar'], battlefield: ['Mountain', 'Mountain'] }, p2: { battlefield: Array(p2Lands).fill('Plains') }, p3: { battlefield: Array(p3Lands).fill('Plains') } } });
    try {
      let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Avatar', 'hand', 'p1') } as never);
      if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      t = resolveStack(t, []);
      return count(t, 'p1', 'battlefield', 'Test Avatar') === 1;
    } catch { return false; }
  };
  it('one opponent with seven lands: it costs {R}{R} and is cast with two Mountains', () => expect(cast(7, 0)).toBe(true));
  it('an opponent with exactly six lands: no reduction (negative)', () => expect(cast(6, 0)).toBe(false));
  it('seven lands among two opponents (4 and 3): no single opponent controls seven (negative)', () => expect(cast(4, 3)).toBe(false));
});

describe('CR 608.2h, 120.3: "You may have ~ deal damage equal to the number of +1/+1 counters on it to target player or planeswalker."', () => {
  const RAZE = card('Test Raze', 'Creature — Goblin', 'At the beginning of your end step, you may have this creature deal damage equal to the number of +1/+1 counters on it to target player or planeswalker.', '{0}', { power: '2', toughness: '2' });
  it('is automated', () => expect(RAZE.automation.level).toBe('full'));
  function endStep(counters: number, yes: boolean): GameState {
    let s = mpScenario({ players: 3, defs: [RAZE], zones: { p1: { battlefield: [{ name: 'Test Raze', counters: { '+1/+1': counters } }] } } });
    for (let i = 0; i < 40 && !(s.pending?.kind === 'chooseTargets' || s.pending?.kind === 'yesNo'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
    for (let i = 0; i < 40 && s.zones.stack.length > 0; i++) {
      if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else break;
    }
    return s;
  }
  it('three +1/+1 counters: the chosen player loses 3 life', () => {
    const s = endStep(3, true);
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p3')).toBe(20);
  });
  it('declining the optional damage: nobody loses life (negative)', () => {
    const s = endStep(3, false);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('no counters: no damage is dealt', () => {
    const s = endStep(0, true);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

describe('CR 608.2h, 113.7a: the damage uses the counters it last had (Goblin Razerunners ruling 2009-02-01)', () => {
  const RAZE = card('Test Raze', 'Creature — Goblin', 'At the beginning of your end step, you may have this creature deal damage equal to the number of +1/+1 counters on it to target player or planeswalker.', '{0}', { power: '2', toughness: '2' });
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  it('it leaves the battlefield in response: the last-known counters still count', () => {
    let s = mpScenario({ players: 3, defs: [RAZE, SMITE], zones: { p1: { battlefield: [{ name: 'Test Raze', counters: { '+1/+1': 2 } }] }, p2: { hand: ['Test Smite'] } } });
    for (let i = 0; i < 40 && s.pending?.kind !== 'chooseTargets'; i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p3' }] });
    const raze = Object.values(s.objects).find((o) => s.defs[o.defId]!.name === 'Test Raze')!.id;
    s = act(s, { type: 'pass', player: s.pending!.player }); // p1 passes: p2 may respond
    expect(s.pending?.player).toBe('p2');
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Smite', 'hand', 'p2') } as never);
    if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'object', id: raze }] });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    for (let i = 0; i < 40 && s.zones.stack.length > 0; i++) {
      if (s.pending?.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else break;
    }
    expect(zoneOf(s, 'p1', 'graveyard')).toContain('Test Raze');
    expect(lifeOf(s, 'p3')).toBe(18);
  });
});

describe('CR 701.24a, 121.1: "Shuffle any number of cards from your hand into your library, then draw that many cards."', () => {
  const VOUCHER = card('Test Voucher', 'Artifact', '{T}, Sacrifice this artifact: Shuffle any number of cards from your hand into your library, then draw that many cards.');
  const SLIP = card('Test Slip', 'Sorcery', 'You gain 1 life.');
  it('is automated', () => expect(VOUCHER.automation.level).toBe('full'));
  function use(pick: number): GameState {
    let s = mpScenario({ players: 3, defs: [VOUCHER, SLIP], zones: { p1: { battlefield: ['Test Voucher'], hand: ['Test Slip', 'Test Slip', 'Test Slip'] } } });
    const v = find(s, 'Test Voucher', 'battlefield', 'p1');
    s = act(s, { type: 'activate', player: 'p1', source: v, ability: abilityKey(s, 'Test Voucher') });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = resolveStack(s, []);
    expect(s.pending?.kind).toBe('chooseObjects');
    const opts = (s.pending as { options: ObjectId[] }).options;
    expect(opts.length).toBe(4); // three Slips and the Plains the game dealt
    s = answer(s, { kind: 'chooseObjects', ids: opts.slice(0, pick) });
    return resolveStack(s, []);
  }
  it('two cards chosen: they go into the library and two cards are drawn (hand size unchanged)', () => {
    const s = use(2);
    expect(zoneOf(s, 'p1', 'hand').length).toBe(4);
    expect(zoneOf(s, 'p1', 'battlefield')).not.toContain('Test Voucher');
  });
  it('none chosen: nothing is shuffled and no card is drawn (negative)', () => {
    const s = use(0);
    expect(zoneOf(s, 'p1', 'hand').length).toBe(4);
    expect(count(s, 'p1', 'hand', 'Test Slip')).toBe(3);
  });
  it('the cards drawn count the cards put into the library, not the hand (one chosen: one drawn)', () => {
    const lib = (st: GameState): number => zoneOf(st, 'p1', 'library').length;
    const s0 = use(0);
    const s = use(1);
    expect(zoneOf(s, 'p1', 'hand').length).toBe(4);
    expect(lib(s)).toBe(lib(s0)); // one card went in and one came out
  });
});

describe('CR 701.21a, 608.2e: "Each player sacrifices all lands they control except for three."', () => {
  const BOMB = card('Test Bomber', 'Creature — Human Soldier', 'When this creature enters, each player sacrifices all lands they control except for three.', '{0}', { power: '3', toughness: '3' });
  it('is automated', () => expect(BOMB.automation.level).toBe('full'));
  it('each player with more than three lands sacrifices the rest of their choice; a player with three or fewer sacrifices none; nonland permanents stay', () => {
    const s0 = mpScenario({ players: 3, cards: ['Mountain'], defs: [BOMB], zones: { p1: { hand: ['Test Bomber'], battlefield: Array(5).fill('Plains') }, p2: { battlefield: [...Array(5).fill('Mountain'), 'Test Bomber'] }, p3: { battlefield: Array(3).fill('Plains') } } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bomber', 'hand', 'p1') } as never);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    const asked: string[] = [];
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || s.pending?.kind === 'chooseObjects'); i++) {
      if (s.pending?.kind === 'chooseObjects') {
        const p = s.pending as { player: string; options: ObjectId[]; min: number; max: number };
        asked.push(`${p.player}:${p.min}-${p.max}`);
        s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
      } else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else break;
    }
    expect(asked.sort()).toEqual(['p1:2-2', 'p2:2-2']);
    expect(count(s, 'p1', 'battlefield', 'Plains')).toBe(3);
    expect(count(s, 'p2', 'battlefield', 'Mountain')).toBe(3);
    expect(count(s, 'p3', 'battlefield', 'Plains')).toBe(3);
    expect(count(s, 'p2', 'battlefield', 'Test Bomber')).toBe(1);
    expect(count(s, 'p1', 'battlefield', 'Test Bomber')).toBe(1);
  });
});

describe('CR 701.20e, 701.13a: "Look at the top two cards of target opponent\'s library, then exile one of them."', () => {
  const WITCH = card('Test Peeker', 'Creature — Human Wizard', '{0}, Sacrifice a creature: Look at the top two cards of target opponent\'s library, then exile one of them.', '{0}', { power: '1', toughness: '1' });
  const TOP = card('Test Top Card', 'Sorcery', 'You gain 1 life.');
  const NEXT = card('Test Next Card', 'Sorcery', 'You gain 2 life.');
  it('is automated', () => expect(WITCH.automation.level).toBe('full'));
  it('the controller sees the top two cards of the targeted opponent\'s library and exiles the one they choose; the other stays on top', () => {
    let s = mpScenario({ players: 3, defs: [WITCH, TOP, NEXT], zones: { p1: { battlefield: ['Test Peeker'] }, p2: { library: ['Test Top Card', 'Test Next Card'] } } });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Peeker', 'battlefield', 'p1'), ability: abilityKey(s, 'Test Peeker') });
    for (let i = 0; i < 6 && ['chooseTargets', 'chooseObjects', 'payCost'].includes(s.pending?.kind ?? ''); i++) {
      if (s.pending?.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      else if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else break;
    }
    s = resolveStack(s, []);
    expect(s.pending?.kind).toBe('chooseObjects');
    expect(s.pending?.player).toBe('p1');
    const opts = (s.pending as { options: ObjectId[] }).options;
    expect(opts.length).toBe(2);
    const second = opts.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Next Card')!;
    s = answer(s, { kind: 'chooseObjects', ids: [second] });
    s = resolveStack(s, []);
    expect(zoneOf(s, 'p2', 'exile')).toEqual(['Test Next Card']);
    expect(s.zones.library['p2']![0]).toBeDefined();
    expect(s.defs[s.objects[s.zones.library['p2']![0]!]!.defId]!.name).toBe('Test Top Card');
    expect(zoneOf(s, 'p3', 'exile')).toEqual([]);
  });
});

describe('CR 205.3i, 305.7, 613.1d: "Enchanted land is every basic land type in addition to its other types."', () => {
  const AURA = card('Test Gaia Aura', 'Enchantment — Aura', 'Enchant land\nEnchanted land is every basic land type in addition to its other types.');
  const GUILD = card('Test Guildgate', 'Land — Gate', '');
  it('is automated', () => expect(AURA.automation.level).toBe('full'));
  it('the enchanted land has all five basic land types and keeps its own; an unenchanted land is unchanged (negative)', () => {
    const s = mpScenario({ players: 3, defs: [AURA, GUILD], zones: { p1: { battlefield: ['Test Guildgate', 'Test Guildgate', 'Test Gaia Aura'] } },
      setup: (st) => {
        const gates = Object.values(st.objects).filter((o) => st.defs[o.defId]?.name === 'Test Guildgate');
        Object.values(st.objects).find((o) => st.defs[o.defId]?.name === 'Test Gaia Aura')!.attachedTo = gates[0]!.id;
      } });
    const gates = Object.values(s.objects).filter((o) => s.defs[o.defId]?.name === 'Test Guildgate');
    const aura = Object.values(s.objects).find((o) => s.defs[o.defId]?.name === 'Test Gaia Aura')!;
    const enchanted = gates.find((g) => g.id === aura.attachedTo)!;
    const other = gates.find((g) => g.id !== aura.attachedTo)!;
    const types = (id: ObjectId): string[] => [...(charsOfObject(s, s.objects[id]!).subtypes ?? [])];
    expect(types(enchanted.id).sort()).toEqual(['Forest', 'Gate', 'Island', 'Mountain', 'Plains', 'Swamp']);
    expect(types(other.id)).toEqual(['Gate']);
  });
});

describe('CR 614.1a, 614.6, 400.7: "If a permanent would be put into a graveyard, exile it instead."', () => {
  const SAMURAI = card('Test Samurai', 'Creature — Human Samurai', 'If a permanent would be put into a graveyard, exile it instead.', '{0}', { power: '1', toughness: '1' });
  const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', { power: '2', toughness: '2' });
  const SLIP = card('Test Slip', 'Instant', 'You gain 1 life.');
  function smite(): GameState {
    const s = mpScenario({ players: 3, defs: [SAMURAI, SMITE, BEAR, SLIP], zones: { p1: { hand: ['Test Smite', 'Test Slip'], battlefield: ['Test Samurai'] }, p2: { battlefield: ['Test Bear'] } } });
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Smite', 'hand', 'p1') } as never);
    if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'object', id: find(s, 'Test Bear', 'battlefield', 'p2') }] });
    if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    return resolveStack(t, []);
  }
  it('is automated', () => expect(SAMURAI.automation.level).toBe('full'));
  it('a destroyed creature of any player is exiled instead of going to the graveyard', () => {
    const s = smite();
    expect(zoneOf(s, 'p2', 'exile')).toEqual(['Test Bear']);
    expect(zoneOf(s, 'p2', 'graveyard')).toEqual([]);
  });
  it('an instant that resolves still goes to its owner\'s graveyard: it is no permanent (negative)', () => {
    const s = smite();
    expect(zoneOf(s, 'p1', 'graveyard')).toEqual(['Test Smite']);
  });
  it('a card going from the hand to the graveyard (discard) is not affected: only permanents are (negative)', () => {
    const DISC = card('Test Discard', 'Sorcery', 'Discard a card.');
    const s0 = mpScenario({ players: 3, defs: [SAMURAI, DISC, SLIP], zones: { p1: { hand: ['Test Discard', 'Test Slip'], battlefield: ['Test Samurai'] } } });
    let t = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Discard', 'hand', 'p1') } as never);
    if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    t = resolveStack(t, []);
    if (t.pending?.kind === 'chooseObjects') t = resolveStack(answer(t, { kind: 'chooseObjects', ids: [find(t, 'Test Slip', 'hand', 'p1')] }), []);
    expect(zoneOf(t, 'p1', 'graveyard')).toContain('Test Slip');
    expect(zoneOf(t, 'p1', 'exile')).toEqual([]);
  });
});

describe('CR 402.2, 514.1, 613.11: "Your maximum hand size is equal to the number of hour counters on ~." (Midnight Oil)', () => {
  const OIL = card('Test Midnight Lamp', 'Enchantment', 'This enchantment enters with seven hour counters on it.\nAt the beginning of your draw step, draw an additional card and remove two hour counters from this enchantment.\nYour maximum hand size is equal to the number of hour counters on this enchantment.\nWhenever you discard a card, you lose 1 life.');
  const SLIP = card('Test Slip', 'Instant', 'You gain 1 life.');
  it('is automated', () => expect(OIL.automation.level).toBe('full'));
  it('the maximum hand size follows the counters (the draw step took two off before the main phase); another player keeps seven (negative)', () => {
    const s = mpScenario({ players: 3, defs: [OIL, SLIP], zones: { p1: { battlefield: [{ name: 'Test Midnight Lamp', counters: { hour: 5 } }] } } });
    expect(maxHandSize(s, 'p1')).toBe(3);
    expect(maxHandSize(s, 'p2')).toBe(7);
  });
  it('no counters left: the maximum hand size is zero', () => {
    const s = mpScenario({ players: 3, defs: [OIL, SLIP], zones: { p1: { battlefield: [{ name: 'Test Midnight Lamp', counters: { hour: 2 } }] } } });
    expect(maxHandSize(s, 'p1')).toBe(0);
  });
  it('discarding down at the cleanup step makes its controller lose 1 life per discard', () => {
    let s = mpScenario({ players: 3, defs: [OIL, SLIP], zones: { p1: { battlefield: [{ name: 'Test Midnight Lamp', counters: { hour: 4 } }], hand: ['Test Slip', 'Test Slip', 'Test Slip', 'Test Slip'] } } });
    const hand0 = zoneOf(s, 'p1', 'hand').length;
    let discards = 0;
    for (let i = 0; i < 80 && s.turn.number === 1; i++) {
      const p = s.pending!;
      if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((x) => x.id) });
      else if (p.kind === 'chooseObjects') { const c = p as { options: ObjectId[]; min: number }; discards += c.min; s = answer(s, { kind: 'chooseObjects', ids: c.options.slice(0, c.min) }); }
      else s = act(s, { type: 'pass', player: p.player });
    }
    expect(discards).toBe(hand0 - 2);
    expect(lifeOf(s, 'p1')).toBe(20 - discards);
  });
});

describe('CR 614.1a, 614.6, 101.4, 608.2d: "...each player returns a permanent they control to its owner\'s hand instead." (Words of Wind, read through the same template)', () => {
  const WIND = card('Test Gale Words', 'Enchantment', '{1}: The next time you would draw a card this turn, each player returns a permanent they control to its owner\'s hand instead.');
  const DRAW = card('Test Draw', 'Sorcery', 'Draw a card.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', { power: '2', toughness: '2' });
  it('is automated', () => expect(WIND.automation.level).toBe('full'));
  it('the next draw is replaced once: every player returns one permanent of their own and the drawing player draws nothing', () => {
    let s = mpScenario({ players: 3, defs: [WIND, DRAW, BEAR], zones: { p1: { battlefield: ['Test Gale Words', 'Test Bear', 'Plains'], hand: ['Test Draw', 'Test Draw'] }, p2: { battlefield: ['Test Bear'] } } });
    s = act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Gale Words', 'battlefield', 'p1'), ability: abilityKey(s, 'Test Gale Words') });
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    s = resolveStack(s, []);
    const handBefore = zoneOf(s, 'p1', 'hand').length;
    const libBefore = zoneOf(s, 'p1', 'library').length;
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Draw', 'hand', 'p1') } as never);
    if (s.pending?.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    const asked: string[] = [];
    for (let i = 0; i < 40 && (s.zones.stack.length > 0 || s.pending?.kind === 'chooseObjects'); i++) {
      if (s.pending?.kind === 'chooseObjects') {
        const p = s.pending as { player: string; options: ObjectId[] };
        asked.push(p.player);
        expect(p.options.every((id) => s.objects[id]!.controller === p.player)).toBe(true);
        s = answer(s, { kind: 'chooseObjects', ids: [p.options.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Bear') ?? p.options[0]!] });
      } else if (s.pending?.kind === 'priority') s = act(s, { type: 'pass', player: s.pending.player });
      else break;
    }
    expect(asked).toEqual(['p1']); // p2 has one permanent (no choice to make), p3 none
    expect(count(s, 'p2', 'hand', 'Test Bear')).toBe(1);
    expect(zoneOf(s, 'p1', 'hand').length).toBe(handBefore - 1 + 1); // the Draw spell left the hand, the Bear came in, nothing was drawn
    expect(zoneOf(s, 'p1', 'library').length).toBe(libBefore); // nothing was drawn
  });
});
