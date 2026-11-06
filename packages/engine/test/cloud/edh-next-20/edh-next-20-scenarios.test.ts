/**
 * Commander lane edh-next, round edh-next-20: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's
 * default compiler. Alice (p1) is the active player of turn 1. Each test is named after the rule it checks, with its negative case. CR cites checked against the Comprehensive
 * Rules of 2026-09-25 (see the round's record).
 *
 *   CR 701.23a-b, 702.33d, 614.15   "Search your library for a basic land card, reveal it, put it into your hand, then shuffle. If this spell was kicked, search your library for two basic land cards instead of one." (Reclaim the Wastes)
 *   CR 115.1, 506.4, 120.3          "~ deals 2 damage to each attacking or blocking creature target player controls." (Brigid, Hero of Kinsbaile)
 *   CR 120.1, 608.2c, 111.1        "You create a Treasure token for each opponent who was dealt damage this turn." (You've Been Caught Stealing)
 *   CR 509.1b, 509.1c, 611.2c       "They can't be blocked this turn except by creatures with haste." (Run for Your Life); "~ and target Frog you control can't be blocked this turn except by creatures with flying or reach." (Tatsunari, Toad Rider)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, reject, scenario } from '../../m3/scenario';
import { declareAttackers, declareBlockers, toDeclareAttackers, toDeclareBlockers, toStep } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const handNames = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const namesOn = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.defs[s.objects[id]!.defId]!.name);
const inGraveyard = (s: GameState, name: string, p: PlayerId): boolean => s.zones.graveyard[p]!.some((id) => s.defs[s.objects[id]!.defId]!.name === name);

type Targets = ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][];
interface Opts { targets?: Targets; yes?: boolean; mode?: number }
/** Answer the decisions until priority: payments automatic, targets in order, kicker by `yes`, the mode by index, a search by its first options. */
function drive(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const q = [...(o.targets ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: o.mode !== undefined ? [p.options[o.mode]!.id] : p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min === 0 ? p.max : p.min) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Opts = {}): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o), o);
const activate = (s: GameState, source: ObjectId, o: Opts = {}): GameState => resolveAll(drive(act(s, { type: 'activate', player: 'p1', source, ability: 'p:0:0' } as never), o), o);
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });
const plr = (id: PlayerId): { kind: 'player'; id: PlayerId } => ({ kind: 'player', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const HASTY = card('Test Hasty', 'Creature — Bear', 'Haste', { pt: ['1', '1'] });
const BIRD = card('Test Bird', 'Creature — Bird', 'Flying', { pt: ['1', '1'] });

describe('CR 701.23a-b, 702.33d, 614.15: "Search your library for a basic land card, reveal it, put it into your hand, then shuffle. If this spell was kicked, search your library for two basic land cards instead of one."', () => {
  const RECLAIM = card('Test Reclaim', 'Sorcery', 'Kicker {3}\nSearch your library for a basic land card, reveal it, put it into your hand, then shuffle. If this spell was kicked, search your library for two basic land cards instead of one.');
  const CAVE = card('Test Cave', 'Land', '');
  const defs = [RECLAIM, CAVE];
  const start = (library: string[]) => scenario(['Forest', 'Island'], { defs, p1: { hand: ['Test Reclaim'], battlefield: ['Plains', 'Plains', 'Plains'], library } });
  it('is understood', () => expect(noManual(RECLAIM)).toBe(true));
  it('CR 702.33d: kicked, two basic land cards are found and put into the hand', () => {
    const s = cast(start(['Forest', 'Island', 'Forest']), 'Test Reclaim', { yes: true });
    expect(handNames(s, 'p1')).toEqual(['Forest', 'Island']);
  });
  it('CR 608.2c: not kicked, only one basic land card is found', () => {
    const s = cast(start(['Forest', 'Island', 'Forest']), 'Test Reclaim', { yes: false });
    expect(handNames(s, 'p1')).toEqual(['Forest']);
  });
  it('CR 205.4a: a land card that is not basic is never found, kicked or not', () => {
    const s = cast(start(['Test Cave', 'Test Cave', 'Test Cave']), 'Test Reclaim', { yes: true });
    expect(handNames(s, 'p1').filter((n) => n === 'Test Cave')).toEqual([]);
    expect(handNames(s, 'p1').length).toBe(2);
  });
});

describe('CR 115.1, 506.4, 120.3: "{T}: ~ deals 2 damage to each attacking or blocking creature target player controls."', () => {
  const PINGER = card('Test Pinger', 'Creature — Wizard', '{T}: ~ deals 2 damage to each attacking or blocking creature target player controls.', { pt: ['1', '1'] });
  const defs = [PINGER, BEAR];
  it('is understood', () => expect(noManual(PINGER)).toBe(true));
  it('CR 506.4: the target player\'s attacking creature takes 2 damage, a creature of theirs that is not attacking does not', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Pinger', 'Test Bear', 'Test Bear'] } });
    const [a, b] = s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Bear');
    const attacked = declareAttackers(toDeclareAttackers(s0), [[a!]]);
    const s = activate(attacked, find(attacked, 'Test Pinger', 'battlefield', 'p1'), { targets: [[plr('p1')]] });
    expect(s.zones.battlefield).not.toContain(a);
    expect(s.zones.battlefield).toContain(b);
    expect(s.objects[b!]!.damage ?? 0).toBe(0);
  });
  it('CR 115.1: aimed at the other player, it hurts none of the target-less attackers of the first player', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Pinger', 'Test Bear'] } });
    const a = find(s0, 'Test Bear', 'battlefield', 'p1');
    const attacked = declareAttackers(toDeclareAttackers(s0), [[a]]);
    const s = activate(attacked, find(attacked, 'Test Pinger', 'battlefield', 'p1'), { targets: [[plr('p2')]] });
    expect(s.zones.battlefield).toContain(a);
  });
});

describe('CR 120.1, 608.2c, 111.1: "You create a Treasure token for each opponent who was dealt damage this turn."', () => {
  const HEIST = card('Test Heist', 'Sorcery', 'Choose one --\n• Rest -- You gain 1 life.\n• Loot -- You create a Treasure token for each opponent who was dealt damage this turn.');
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to target player.');
  const defs = [HEIST, ZAP];
  const start = () => scenario([], { defs, p1: { hand: ['Test Heist', 'Test Zap'] } });
  it('is understood', () => expect(noManual(HEIST)).toBe(true));
  it('CR 120.1: after an opponent was dealt damage this turn, one Treasure token is created', () => {
    let s = cast(start(), 'Test Zap', { targets: [[plr('p2')]] });
    s = cast(s, 'Test Heist', { mode: 1 });
    expect(namesOn(s, 'p1')).toEqual(['Treasure Token']);
  });
  it('CR 608.2c: no opponent was dealt damage this turn, so no Treasure token is created', () => {
    const s = cast(start(), 'Test Heist', { mode: 1 });
    expect(namesOn(s, 'p1')).toEqual([]);
  });
  it('damage dealt to the controller does not count (only opponents)', () => {
    let s = cast(start(), 'Test Zap', { targets: [[plr('p1')]] });
    s = cast(s, 'Test Heist', { mode: 1 });
    expect(namesOn(s, 'p1')).toEqual([]);
  });
});

describe('CR 509.1b, 509.1c, 611.2c: "One or two target creatures each gain haste until end of turn. They can\'t be blocked this turn except by creatures with haste."', () => {
  const RUSH = card('Test Rush', 'Instant', 'One or two target creatures each gain haste until end of turn. They can\'t be blocked this turn except by creatures with haste.');
  const defs = [RUSH, BEAR, HASTY];
  const start = () => scenario([], { defs, p1: { hand: ['Test Rush'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Hasty'] } });
  it('is understood', () => expect(noManual(RUSH)).toBe(true));
  it('CR 509.1b: a creature without haste cannot block the target; one with haste can', () => {
    const s0 = start();
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const s1 = cast(s0, 'Test Rush', { targets: [[obj(mine)]] });
    const blockers = toDeclareBlockers(declareAttackers(toDeclareAttackers(s1), [[mine]]));
    const slow = find(blockers, 'Test Bear', 'battlefield', 'p2');
    const fast = find(blockers, 'Test Hasty', 'battlefield', 'p2');
    reject(blockers, { type: 'declareBlockers', player: 'p2', blocks: [{ blocker: slow, attacker: mine }] } as never);
    const blocked = declareBlockers(blockers, [[fast, mine]]);
    expect(toStep(blocked, 'endCombat').zones.battlefield).toContain(mine);
  });
  it('CR 115.1: with two targets both are covered; an attacker that was not targeted can still be blocked by a creature without haste', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Rush'], battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear'] } });
    const [x, y, z] = s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Bear' && s0.objects[id]!.controller === 'p1');
    const s1 = cast(s0, 'Test Rush', { targets: [[obj(x!), obj(y!)]] });
    const blockers = toDeclareBlockers(declareAttackers(toDeclareAttackers(s1), [[x!], [y!], [z!]]));
    const slow = find(blockers, 'Test Bear', 'battlefield', 'p2');
    reject(blockers, { type: 'declareBlockers', player: 'p2', blocks: [{ blocker: slow, attacker: x! }] } as never);
    reject(blockers, { type: 'declareBlockers', player: 'p2', blocks: [{ blocker: slow, attacker: y! }] } as never);
    expect(() => declareBlockers(blockers, [[slow, z!]])).not.toThrow();
  });
  it('CR 611.2c: without the spell the same blocker may block', () => {
    const s0 = start();
    const mine = find(s0, 'Test Bear', 'battlefield', 'p1');
    const blockers = toDeclareBlockers(declareAttackers(toDeclareAttackers(s0), [[mine]]));
    const slow = find(blockers, 'Test Bear', 'battlefield', 'p2');
    expect(() => declareBlockers(blockers, [[slow, mine]])).not.toThrow();
  });
});

describe('CR 509.1b, 509.1c, 611.2c: "{0}: ~ and target Frog you control can\'t be blocked this turn except by creatures with flying or reach."', () => {
  const TOAD = card('Test Toad', 'Creature — Frog', '{0}: ~ and target Frog you control can\'t be blocked this turn except by creatures with flying or reach.', { pt: ['2', '2'] });
  const FROG = card('Test Frog', 'Creature — Frog', '', { pt: ['1', '1'] });
  const defs = [TOAD, FROG, BEAR, BIRD];
  const start = () => scenario([], { defs, p1: { battlefield: ['Test Toad', 'Test Frog'] }, p2: { battlefield: ['Test Bear', 'Test Bird'] } });
  it('is understood', () => expect(noManual(TOAD)).toBe(true));
  it('CR 509.1b: both the Toad and the targeted Frog can be blocked only by a creature with flying or reach', () => {
    const s0 = start();
    const toad = find(s0, 'Test Toad', 'battlefield', 'p1');
    const frog = find(s0, 'Test Frog', 'battlefield', 'p1');
    const s1 = activate(s0, toad, { targets: [[obj(frog)]] });
    const blockers = toDeclareBlockers(declareAttackers(toDeclareAttackers(s1), [[toad], [frog]]));
    const bear = find(blockers, 'Test Bear', 'battlefield', 'p2');
    const bird = find(blockers, 'Test Bird', 'battlefield', 'p2');
    reject(blockers, { type: 'declareBlockers', player: 'p2', blocks: [{ blocker: bear, attacker: toad }] } as never);
    reject(blockers, { type: 'declareBlockers', player: 'p2', blocks: [{ blocker: bear, attacker: frog }] } as never);
    expect(() => declareBlockers(blockers, [[bird, toad]])).not.toThrow();
  });
  it('CR 509.1b: a creature with reach may block either one; a Frog that was not the target stays blockable by a creature without flying or reach', () => {
    const SPIDER = card('Test Spider', 'Creature — Spider', 'Reach', { pt: ['1', '1'] });
    const s0 = scenario([], { defs: [...defs, SPIDER], p1: { battlefield: ['Test Toad', 'Test Frog', 'Test Frog'] }, p2: { battlefield: ['Test Bear', 'Test Spider'] } });
    const toad = find(s0, 'Test Toad', 'battlefield', 'p1');
    const [frog, other] = s0.zones.battlefield.filter((id) => s0.defs[s0.objects[id]!.defId]!.name === 'Test Frog');
    const s1 = activate(s0, toad, { targets: [[obj(frog!)]] });
    const blockers = toDeclareBlockers(declareAttackers(toDeclareAttackers(s1), [[toad], [frog!], [other!]]));
    const bear = find(blockers, 'Test Bear', 'battlefield', 'p2');
    const spider = find(blockers, 'Test Spider', 'battlefield', 'p2');
    reject(blockers, { type: 'declareBlockers', player: 'p2', blocks: [{ blocker: bear, attacker: frog! }] } as never);
    expect(() => declareBlockers(blockers, [[spider, toad]])).not.toThrow();
    expect(() => declareBlockers(blockers, [[spider, frog!]])).not.toThrow();
    expect(() => declareBlockers(blockers, [[bear, other!]])).not.toThrow();
  });
});
