/**
 * edh-c-42 (Commander effort, EDHREC ranks 29,001-29,500): the round's readings played through the engine with synthetic cards (invented names and wordings,
 * design 6.10), compiled by the game's default compiler. Each reading has its negative case. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 702.38a, 614.12a         amplify N: as it enters its controller reveals any number of cards in hand that share a creature type with it; N +1/+1 counters
 *                               for each; no card that shares no type, none revealed: none
 *   CR 614.12a, 122.6           "As ~ enters, you may reveal any number of other artifact cards from your hand. ~ enters with a +1/+1 counter ... for each card"
 *   CR 702.59a                  recover: a creature put into your graveyard from the battlefield: pay, return the card to your hand; otherwise exile it;
 *                               an opponent's creature does not trigger it
 *   CR 305.2, 604.1, 611.2a     "Players can't play lands." / "Target player can't play lands this turn."
 *   CR 615.12, 120.3            "Damage that would be dealt by ~ can't be prevented.": a prevention of all combat damage stops the other creature, not this one
 *   CR 614.1a, 107.1a           "it deals half that damage, rounded down, ... instead": 5 damage becomes 2
 *   CR 508.1d, 603.4            "~ can't attack unless you control a Knight or a Soldier"
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, legal, life, pass, scenario } from '../../m3/scenario';
import { declareAttackers, passUntil, toDeclareAttackers } from '../../m4/helpers';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const counters = (s: GameState, id: ObjectId, kind = '+1/+1'): number => s.objects[id]?.counters[kind] ?? 0;
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };

interface Script { targets?: TargetChoice[][]; pay?: boolean; pick?: (options: ObjectId[]) => ObjectId[] }
/** Answer the decisions that come up until a player has priority again. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const targets = [...(script.targets ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: targets.shift() ?? [] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.pay ?? false });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (script.pick ?? (() => []))((p as { options: ObjectId[] }).options) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(p as { options: { id: string }[] }).options[0]!.id] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (p as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (p.kind === 'chooseReplacement') s = answer(s, { kind: 'chooseReplacement', id: (p as { options: { id: string }[] }).options[0]!.id } as never);
    else break;
  }
  return s;
}
/** Pass priority until the stack is empty, answering decisions with the script. */
function resolveAll(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && guard < 30; guard++) s = drive(pass(s), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), script);

const CRAWLER = card('Test Crawler', 'Creature — Beast', 'Amplify 2', ['1', '1']);
const BEAST_A = card('Test Beast A', 'Creature — Beast', '', ['1', '1']);
const BEAST_B = card('Test Beast B', 'Creature — Beast Elf', '', ['1', '1']);
const BEAR = card('Test Bear', 'Creature — Bear', '', ['2', '2']);
const THRESHER = card('Test Thresher', 'Artifact Creature — Construct', 'As ~ enters, you may reveal any number of other artifact cards from your hand. ~ enters with a +1/+1 counter on it for each card revealed this way.', ['1', '1']);
const RING = card('Test Ring', 'Artifact', '');
const RELIC = card('Test Relic', 'Artifact', '');
const ELIXIR = card('Test Elixir', 'Instant', 'You gain 4 life.\nRecover {1}{W}');
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
const DISPUTE = card('Test Dispute', 'Enchantment', "Players can't play lands.");
const SOLFA = card('Test Solfa', 'Instant', "Target player can't play lands this turn.");
const BRUTE = card('Test Brute', 'Creature — Avatar', "Damage that would be dealt by ~ can't be prevented.", ['4', '4']);
const FOG = card('Test Fog', 'Instant', 'Prevent all combat damage that would be dealt this turn.');
const GHOST = card('Test Ghost', 'Creature — Spirit', 'If a source would deal damage to a permanent or player, it deals half that damage, rounded down, to that permanent or player instead.', ['1', '1']);
const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 5 damage to any target.');
const FALCON = card('Test Falcon', 'Creature — Bird', "Flying\n~ can't attack unless you control a Knight or a Soldier.", ['2', '1']);
const SOLDIER = card('Test Soldier', 'Creature — Human Soldier', '', ['1', '1']);
const KNIGHT = card('Test Knight', 'Creature — Human Knight', '', ['1', '1']);
const TURF = card('Test Turf', 'Instant', "Target player can't play lands this turn. Draw a card at the beginning of the next turn's upkeep.");
const MINER = card('Test Miner', 'Creature — Dwarf', "Sacrifice ~: Target player can't play lands this turn.", ['1', '1']);
const DEFS = [TURF, MINER, CRAWLER, BEAST_A, BEAST_B, BEAR, THRESHER, RING, RELIC, ELIXIR, SMITE, DISPUTE, SOLFA, BRUTE, FOG, GHOST, BOLT, FALCON, SOLDIER, KNIGHT];

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

const start = (p1: { hand?: string[]; battlefield?: string[]; graveyard?: string[] }, p2: { hand?: string[]; battlefield?: string[] } = {}, lands: string[] = []): GameState =>
  advanceTo(scenario(lands, { p1, p2, defs: DEFS }), 1, 'main1');

describe('CR 702.38a, 614.12a: amplify', () => {
  it('amplify 2: the Beasts of the hand are offered (not the Bear, not itself); revealing both gives four +1/+1 counters', () => {
    let offered: ObjectId[] = [];
    const s0 = start({ hand: ['Test Crawler', 'Test Beast A', 'Test Beast B', 'Test Bear'] });
    const s = cast(s0, 'Test Crawler', { pick: (o) => { offered = o; return o; } });
    const resolved = resolveAll(s, { pick: (o) => { offered = o; return o; } });
    expect(offered.map((id) => s0.defs[resolved.objects[id]!.defId]!.name).sort()).toEqual(['Test Beast A', 'Test Beast B']);
    expect(counters(resolved, find(resolved, 'Test Crawler', 'battlefield', 'p1'))).toBe(4);
    // revealing does not move the cards
    expect(resolved.zones.hand['p1']!.length).toBe(3);
  });
  it('revealing one card gives two counters; revealing none gives none', () => {
    const s0 = start({ hand: ['Test Crawler', 'Test Beast A', 'Test Beast B'] });
    const one = resolveAll(cast(s0, 'Test Crawler', { pick: (o) => [o[0]!] }), { pick: (o) => [o[0]!] });
    expect(counters(one, find(one, 'Test Crawler', 'battlefield', 'p1'))).toBe(2);
    const none = resolveAll(cast(s0, 'Test Crawler'));
    expect(counters(none, find(none, 'Test Crawler', 'battlefield', 'p1'))).toBe(0);
  });
  it('with no card sharing a creature type nothing is asked and it enters as printed', () => {
    const s = resolveAll(cast(start({ hand: ['Test Crawler', 'Test Bear'] }), 'Test Crawler'));
    expect(counters(s, find(s, 'Test Crawler', 'battlefield', 'p1'))).toBe(0);
    expect(pt(s, find(s, 'Test Crawler', 'battlefield', 'p1'))).toBe('1/1');
  });
});

describe('CR 614.12a, 122.6: "As ~ enters, you may reveal any number of other artifact cards from your hand. ~ enters with a +1/+1 counter ... for each card revealed this way."', () => {
  it('only the other artifact cards are offered; two revealed give two counters', () => {
    let offered: ObjectId[] = [];
    const s0 = start({ hand: ['Test Thresher', 'Test Ring', 'Test Relic', 'Test Bear'] });
    const s = resolveAll(cast(s0, 'Test Thresher', { pick: (o) => { offered = o; return o; } }), { pick: (o) => { offered = o; return o; } });
    expect(offered.map((id) => s0.defs[s.objects[id]!.defId]!.name).sort()).toEqual(['Test Relic', 'Test Ring']);
    expect(counters(s, find(s, 'Test Thresher', 'battlefield', 'p1'))).toBe(2);
  });
  it('revealing none gives no counter', () => {
    const s = resolveAll(cast(start({ hand: ['Test Thresher', 'Test Ring'] }), 'Test Thresher'));
    expect(counters(s, find(s, 'Test Thresher', 'battlefield', 'p1'))).toBe(0);
  });
});

describe('CR 702.59a: recover', () => {
  const board = (): GameState => {
    const s0 = start({ hand: ['Test Smite'], battlefield: ['Test Bear', 'Plains', 'Plains'], graveyard: ['Test Elixir'] }, { battlefield: ['Test Bear'] });
    return s0;
  };
  const smiteOwn = (s0: GameState, script: Script): GameState => {
    const bear = find(s0, 'Test Bear', 'battlefield', 'p1');
    return resolveAll(cast(s0, 'Test Smite', { ...script, targets: [[{ kind: 'object', id: bear }]] }), script);
  };
  it('a creature of yours dies: pay {1}{W} and the card returns to your hand', () => {
    const s = smiteOwn(board(), { pay: true });
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Elixir')).toBe(true);
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Elixir')).toBe(false);
  });
  it('declining the payment exiles the card', () => {
    const s = smiteOwn(board(), { pay: false });
    expect(s.zones.exile.some((id) => s.objects[id]!.defId === 'Test Elixir')).toBe(true);
    expect(s.zones.hand['p1']!.some((id) => s.objects[id]!.defId === 'Test Elixir')).toBe(false);
  });
  it("an opponent's creature dying does not trigger it: the card stays in the graveyard", () => {
    const s0 = board();
    const theirs = find(s0, 'Test Bear', 'battlefield', 'p2');
    const s = resolveAll(cast(s0, 'Test Smite', { targets: [[{ kind: 'object', id: theirs }]], pay: true }), { pay: true });
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Elixir')).toBe(true);
  });
});

describe('CR 305.2, 604.1, 611.2a: "Players can\'t play lands." and "Target player can\'t play lands this turn."', () => {
  it('Players can\'t play lands: no land play is offered to either player', () => {
    let s = start({ hand: ['Plains'], battlefield: ['Test Dispute'] }, { hand: ['Plains'] });
    expect(legal(s, 'p1', 'playLand')).toEqual([]);
    s = advanceTo(s, 2, 'main1');
    expect(legal(s, 'p2', 'playLand')).toEqual([]);
  });
  it('without it a land play is offered', () => {
    const s = start({ hand: ['Plains'] });
    expect(legal(s, 'p1', 'playLand').length).toBeGreaterThan(0);
  });
  it('the spell stops the targeted player this turn only', () => {
    const s0 = start({ hand: ['Test Solfa', 'Plains'] }, { hand: ['Plains'] });
    let s = resolveAll(cast(s0, 'Test Solfa', { targets: [[{ kind: 'player', id: 'p1' }]] }));
    expect(legal(s, 'p1', 'playLand')).toEqual([]);
    s = advanceTo(s, 2, 'main1');
    expect(legal(s, 'p2', 'playLand').length).toBeGreaterThan(0);
    s = advanceTo(s, 3, 'main1');
    expect(legal(s, 'p1', 'playLand').length).toBeGreaterThan(0);
  });
  it('the spell leaves the other player free this turn: aimed at the opponent, you can still play a land', () => {
    const s0 = start({ hand: ['Test Solfa', 'Plains'] }, { hand: ['Plains'] });
    const s = resolveAll(cast(s0, 'Test Solfa', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(legal(s, 'p1', 'playLand').length).toBeGreaterThan(0);
  });
});

describe('CR 615.12: "Damage that would be dealt by ~ can\'t be prevented."', () => {
  const attackBoth = (extra: string[], withBrute: boolean): GameState => {
    const s0 = start({ hand: ['Test Fog'], battlefield: [...(withBrute ? ['Test Brute'] : []), 'Test Bear', ...extra] });
    const ids = ['Test Bear', ...(withBrute ? ['Test Brute'] : [])].map((n) => find(s0, n, 'battlefield', 'p1'));
    const fogged = resolveAll(cast(s0, 'Test Fog'));
    return passUntil(declareAttackers(toDeclareAttackers(fogged), ids.map((id) => [id] as [ObjectId])), (x) => x.turn.step === 'endCombat' || x.turn.step === 'main2', 'combat over', 80);
  };
  it('a prevention of all combat damage stops the Bear but not the Brute: 4 damage', () => {
    const s = attackBoth([], true);
    expect(life(s, 'p2')).toBe(16);
  });
  it('without the Brute the Fog stops the Bear\'s damage', () => {
    const s = attackBoth([], false);
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 614.1a, 107.1a: "it deals half that damage, rounded down, to that permanent or player instead"', () => {
  it('5 damage becomes 2', () => {
    const s0 = start({ hand: ['Test Bolt'], battlefield: ['Test Ghost'] });
    const s = resolveAll(cast(s0, 'Test Bolt', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(life(s, 'p2')).toBe(18);
  });
  it('two Ghosts are cumulative (ruling 2005-10-01): 5 damage becomes 2, then 1', () => {
    const s0 = start({ hand: ['Test Bolt'], battlefield: ['Test Ghost', 'Test Ghost'] });
    const s = resolveAll(cast(s0, 'Test Bolt', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(life(s, 'p2')).toBe(19);
  });
  it('half of 1 rounded down is 0: no damage is dealt at all (ruling 2005-10-01)', () => {
    const ONE = card('Test Ping', 'Instant', 'Test Ping deals 1 damage to any target.');
    const s0 = advanceTo(scenario([], { p1: { hand: ['Test Ping'], battlefield: ['Test Ghost'] }, p2: {}, defs: [...DEFS, ONE] }), 1, 'main1');
    const s = resolveAll(cast(s0, 'Test Ping', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(life(s, 'p2')).toBe(20);
  });
  it('without the Ghost all 5 damage is dealt', () => {
    const s0 = start({ hand: ['Test Bolt'] });
    const s = resolveAll(cast(s0, 'Test Bolt', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(life(s, 'p2')).toBe(15);
  });
});

describe('CR 508.1d: "~ can\'t attack unless you control a Knight or a Soldier"', () => {
  const attempt = (others: string[]): string | undefined => {
    const s0 = start({ battlefield: ['Test Falcon', ...others] });
    // with nothing able to attack the game never asks for attackers
    let s: GameState;
    try { s = toDeclareAttackers(s0); } catch { return 'no creature can attack'; }
    const falcon = find(s, 'Test Falcon', 'battlefield', 'p1');
    const d = s.pending!;
    return applyAction(s, { type: 'answer', player: d.player, decisionId: d.id, answer: { kind: 'declareAttackers', attacks: [{ attacker: falcon, defender: 'p2' }] } }).error?.message;
  };
  it('alone it can\'t attack', () => expect(attempt([])).toBeDefined());
  it('with a Soldier it can', () => expect(attempt(['Test Soldier'])).toBeUndefined());
  it('with a Knight it can', () => expect(attempt(['Test Knight'])).toBeUndefined());
  it('a creature that is neither does not enable it', () => expect(attempt(['Test Bear'])).toBeDefined());
});

describe('Turf Wound and Pardic Miner wordings use the same reading', () => {
  it('Test Turf stops the targeted player\'s land plays this turn', () => {
    const s0 = start({ hand: ['Test Turf', 'Plains'] });
    const s = resolveAll(cast(s0, 'Test Turf', { targets: [[{ kind: 'player', id: 'p1' }]] }));
    expect(legal(s, 'p1', 'playLand')).toEqual([]);
  });
  it('Test Miner: sacrificing it stops the targeted player\'s land plays this turn', () => {
    const s0 = start({ hand: ['Plains'], battlefield: ['Test Miner'] });
    expect(legal(s0, 'p1', 'playLand').length).toBeGreaterThan(0);
    const miner = find(s0, 'Test Miner', 'battlefield', 'p1');
    const s = resolveAll(drive(act(s0, { type: 'activate', player: 'p1', source: miner, ability: 'p:0:0' } as never), { targets: [[{ kind: 'player', id: 'p1' }]] }));
    expect(legal(s, 'p1', 'playLand')).toEqual([]);
  });
});
