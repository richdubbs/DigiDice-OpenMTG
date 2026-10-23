/**
 * p2-intervening-1 (lane p2-intervening): the intervening "if" readings of parser/holes/p2iv1.ts played through the engine with synthetic cards compiled by the
 * game's default compiler (wordings invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified
 * (rules/cr/ is not in the cloud checkout).
 *
 *   CR 603.4, 119.3, 500.1  "if you lost life last turn": the previous turn's history, whoever's turn it was
 *   CR 603.4, 508.1         "if you attacked with creatures with total power 6 or greater this combat" (pack tactics): the declared attackers' total power
 *   CR 603.4                "if that player controls more lands than you": the player of the event, counted against you
 *   CR 603.4, 601.2a, 400.7d "if it wasn't cast": the cast record of the creature that entered
 *   CR 603.4, 201.2         "if it doesn't have the same name as another creature you control or a creature card in your graveyard"
 *   CR 603.4                "if no creatures are on the battlefield"
 *   CR 603.4, 404.1         "if you have two or more creature cards in your graveyard"
 *   CR 603.4, 702.33d       "if that spell was kicked": the cast record of the spell a cast trigger names
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const handSize = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const castCard = (s: GameState, name: string, player = 'p1'): GameState => settle(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }));

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['4', '4'] });
const LAND = card('Test Field', 'Land', '');

const MOURNER = card('Test Mourning Bell', 'Enchantment', 'At the beginning of each upkeep, if you lost life last turn, you gain 2 life.');
const BLEED = card('Test Bleed', 'Sorcery', 'You lose 3 life.');
const PACK = card('Test Pack Runner', 'Creature — Wolf', 'Whenever this creature attacks, if you attacked with creatures with total power 6 or greater this combat, draw a card.', { pt: ['2', '2'] });
const SURVEY = card('Test Border Survey', 'Enchantment', 'Whenever a land an opponent controls enters, if that player controls more lands than you, you gain 3 life.');
const ECHO = card('Test Echo Warden', 'Enchantment', "Whenever another nontoken creature you control enters, if it wasn't cast, you gain 2 life.");
const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
const UNIQUE = card('Test Unique Ledger', 'Enchantment', "Whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, you gain 2 life.");
const EMPTY = card('Test Empty Field', 'Enchantment', 'At the beginning of the end step, if no creatures are on the battlefield, you gain 2 life.');
const CRYPT = card('Test Crypt Bell', 'Enchantment', 'At the beginning of your upkeep, if you have two or more creature cards in your graveyard, you gain 2 life.');
const KICKWATCH = card('Test Kick Watcher', 'Enchantment', 'Whenever you cast a spell, if that spell was kicked, you gain 2 life.');
const KICKED = card('Test Kicked Spark', 'Instant', 'Kicker {0}\nYou gain 1 life.');
const DEFS: CardDef[] = [BEAR, OX, LAND, MOURNER, BLEED, PACK, SURVEY, ECHO, RAISE, UNIQUE, EMPTY, CRYPT, KICKWATCH, KICKED];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

/** Pass until the stack is empty and the active player has priority in `step` of `turn` (triggers there resolved). */
const reach = (s: GameState, turn: number, step: GameState['turn']['step']): GameState => resolveAll(advanceTo(s, turn, step));

describe('CR 603.4, 119.3, 500.1: "At the beginning of each upkeep, if you lost life last turn, ..."', () => {
  it('you lost life on turn 1: at turn 2\'s upkeep (the opponent\'s turn) it gains you 2 life; at turn 3\'s upkeep (nothing lost on turn 2) it does not', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Mourning Bell'], hand: ['Test Bleed'] } });
    s = resolveAll(castCard(s, 'Test Bleed'));
    expect(life(s, 'p1')).toBe(17);
    s = reach(s, 2, 'draw');
    expect(life(s, 'p1')).toBe(19);
    s = reach(s, 3, 'draw');
    expect(life(s, 'p1')).toBe(19);
  });
  it('no life lost on turn 1: nothing at turn 2\'s upkeep', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Mourning Bell'] } });
    s = reach(s, 2, 'draw');
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 603.4, 508.1: pack tactics, "if you attacked with creatures with total power 6 or greater this combat"', () => {
  const attack = (s0: GameState, ids: ObjectId[]): GameState => {
    let s = advanceTo(s0, 3, 'main1');
    s = toDeclareAttackers(s);
    s = declareAttackers(s, ids.map((id) => [id, 'p2'] as [ObjectId, string]));
    return passUntil(s, (x) => x.turn.step === 'combatDamage' || x.turn.step === 'endCombat', 'combat');
  };
  it('a 2/2 and a 4/4 attack (total power 6): it draws a card', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pack Runner', 'Test Ox'] } });
    const before = handSize(advanceTo(s0, 3, 'main1'), 'p1');
    const s = attack(s0, [find(s0, 'Test Pack Runner', 'battlefield', 'p1'), find(s0, 'Test Ox', 'battlefield', 'p1')]);
    expect(handSize(s, 'p1')).toBe(before + 1);
  });
  it('the 2/2 attacks alone (total power 2): no card', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Pack Runner', 'Test Ox'] } });
    const before = handSize(advanceTo(s0, 3, 'main1'), 'p1');
    const s = attack(s0, [find(s0, 'Test Pack Runner', 'battlefield', 'p1')]);
    expect(handSize(s, 'p1')).toBe(before);
  });
});

describe('CR 603.4: "Whenever a land an opponent controls enters, if that player controls more lands than you, ..."', () => {
  const opponentPlaysLand = (s0: GameState): GameState => {
    let s = advanceTo(s0, 2, 'main1');
    s = act(s, { type: 'playLand', player: 'p2', card: find(s, 'Test Field', 'hand', 'p2') });
    return resolveAll(s);
  };
  it('the opponent then controls three lands to your one: you gain 3 life', () => {
    const s = opponentPlaysLand(scenario([], { defs: DEFS, p1: { battlefield: ['Test Border Survey', 'Test Field'] }, p2: { battlefield: ['Test Field', 'Test Field'], hand: ['Test Field'] } }));
    expect(life(s, 'p1')).toBe(23);
  });
  it('a tie (two lands each after the land enters): nothing', () => {
    const s = opponentPlaysLand(scenario([], { defs: DEFS, p1: { battlefield: ['Test Border Survey', 'Test Field', 'Test Field'] }, p2: { battlefield: ['Test Field'], hand: ['Test Field'] } }));
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 603.4, 601.2a, 400.7d: "Whenever another nontoken creature you control enters, if it wasn\'t cast, ..."', () => {
  it('a creature cast from hand: nothing; the same creature returned from the graveyard by a spell: you gain 2 life', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Echo Warden'], hand: ['Test Bear', 'Test Raise'], graveyard: ['Test Ox'] } });
    s = resolveAll(castCard(s, 'Test Bear'));
    expect(life(s, 'p1')).toBe(20);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Raise', 'hand', 'p1') }), { targets: [{ kind: 'object', id: find(s, 'Test Ox', 'graveyard', 'p1') }] }));
    expect(findAll(s, 'Test Ox', 'battlefield', 'p1')).toHaveLength(1);
    expect(life(s, 'p1')).toBe(22);
  });
});

describe('CR 603.4, 201.2: "if it doesn\'t have the same name as another creature you control or a creature card in your graveyard"', () => {
  it('the first Test Bear: you gain 2 life; a second one (a creature you control has its name): nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Unique Ledger'], hand: ['Test Bear', 'Test Bear'] } });
    s = resolveAll(castCard(s, 'Test Bear'));
    expect(life(s, 'p1')).toBe(22);
    s = resolveAll(castCard(s, 'Test Bear'));
    expect(life(s, 'p1')).toBe(22);
  });
  it('a Test Bear card in your graveyard: nothing', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Unique Ledger'], hand: ['Test Bear'], graveyard: ['Test Bear'] } });
    s = resolveAll(castCard(s, 'Test Bear'));
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 603.4: "At the beginning of the end step, if no creatures are on the battlefield, ..."', () => {
  it('no creatures: you gain 2 life at the end step; an opponent\'s creature: nothing', () => {
    expect(life(reach(scenario([], { defs: DEFS, p1: { battlefield: ['Test Empty Field'] } }), 1, 'end'), 'p1')).toBe(22);
    expect(life(reach(scenario([], { defs: DEFS, p1: { battlefield: ['Test Empty Field'] }, p2: { battlefield: ['Test Bear'] } }), 1, 'end'), 'p1')).toBe(20);
  });
});

describe('CR 603.4, 404.1: "At the beginning of your upkeep, if you have two or more creature cards in your graveyard, ..."', () => {
  it('two creature cards: you gain 2 life at your upkeep; one creature card and a land card: nothing', () => {
    expect(life(reach(scenario([], { defs: DEFS, p1: { battlefield: ['Test Crypt Bell'], graveyard: ['Test Bear', 'Test Ox'] } }), 3, 'draw'), 'p1')).toBe(22);
    expect(life(reach(scenario([], { defs: DEFS, p1: { battlefield: ['Test Crypt Bell'], graveyard: ['Test Bear', 'Test Field'] } }), 3, 'draw'), 'p1')).toBe(20);
  });
});

describe('CR 603.4, 702.33d: "Whenever you cast a spell, if that spell was kicked, ..."', () => {
  const castKicked = (kick: boolean): GameState => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Kick Watcher'], hand: ['Test Kicked Spark'] } });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kicked Spark', 'hand', 'p1') });
    for (let k = 0; k < 10 && s.pending && s.pending.kind !== 'priority'; k++) {
      const d = s.pending as { kind: string; options?: { id: string }[] };
      if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: kick });
      else if (d.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: kick ? [d.options![0]!.id] : [] });
      else s = settle(s);
    }
    return resolveAll(s);
  };
  it('kicked: 2 life from the trigger and 1 from the spell; not kicked: only the spell\'s 1', () => {
    expect(life(castKicked(true), 'p1')).toBe(23);
    expect(life(castKicked(false), 'p1')).toBe(21);
  });
});

void pass;
