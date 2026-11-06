/**
 * edh-players-16 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites were checked against the Comprehensive Rules
 * text of 2026-09-25 (media.wizards.com).
 *
 *   CR 608.2c, 608.2h, 400.7, 701.8a  "Destroy all creatures. Each player loses life equal to the number of creatures they controlled that were destroyed this way."
 *   CR 120.1, 120.3, 608.2c           "When this creature enters, you may discard your hand and draw cards equal to the damage dealt to target opponent this turn."
 *   CR 118.12, 119.4, 608.2d          "You may pay any amount of life. If you do, draw that many cards."
 *   CR 608.2c, 608.2h                 "Whenever ~ deals combat damage to a player, you may discard any number of cards. If you do, draw that many cards." (the number is the discard's)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario, namesOn } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
const player = (id: PlayerId): TargetChoice => ({ kind: 'player', id }) as TargetChoice;

interface Script { yes?: boolean[]; numbers?: number[]; targets?: TargetChoice[][]; objects?: ((options: ObjectId[]) => ObjectId[])[] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: pick ? pick(p.options) : p.options.slice(0, p.min) }); }
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const cast = (s: GameState, name: string, script: Script = {}, who: PlayerId = 'p1'): GameState => settle(drive(act(s, { type: 'cast', player: who, card: find(s, name, 'hand', who) }), script), script);

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const STONE = card('Test Stone', 'Creature — Golem', 'Indestructible', { pt: ['2', '2'] });

// ---- "Destroy all creatures. Each player loses life equal to the number of creatures they controlled that were destroyed this way." -------------------------------------------

const TEMPEST = card('Test Tempest', 'Sorcery', 'Destroy all creatures. Each player loses life equal to the number of creatures they controlled that were destroyed this way.');

describe('CR 608.2c, 608.2h, 400.7: "Each player loses life equal to the number of creatures they controlled that were destroyed this way."', () => {
  const setup = (): GameState => mpScenario({
    defs: [TEMPEST, BEAR, STONE],
    zones: { p1: { hand: ['Test Tempest'], battlefield: ['Test Bear', 'Test Bear'] }, p2: { battlefield: ['Test Bear', 'Test Bear', 'Test Bear'] }, p3: { battlefield: ['Test Stone', 'Test Bear'] }, p4: {} },
  });
  it('is automated', () => expect(full(TEMPEST)).toBe(true));
  it('each player loses life equal to the number of THEIR creatures that were destroyed; a player with none loses nothing', () => {
    const s = cast(setup(), 'Test Tempest');
    expect([lifeOf(s, 'p1'), lifeOf(s, 'p2'), lifeOf(s, 'p3'), lifeOf(s, 'p4')]).toEqual([18, 17, 19, 20]);
  });
  it('a creature that was not destroyed (indestructible) is not counted for its controller, and stays on the battlefield (the negative case)', () => {
    const s = cast(setup(), 'Test Tempest');
    expect(namesOn(s, 'p3')).toEqual(['Test Stone']);
    expect(lifeOf(s, 'p3')).toBe(19); // 2 creatures, 1 destroyed
  });
});

// ---- "the damage dealt to target opponent this turn" ----------------------------------------------------------------------------------------------------------------------

const BOLT = card('Test Bolt', 'Instant', 'Test Bolt deals 3 damage to target player.');
const SMALL = card('Test Small Bolt', 'Instant', 'Test Small Bolt deals 2 damage to target player.');
const DRAGON = card('Test Dragon', 'Creature — Dragon', 'When this creature enters, you may discard your hand and draw cards equal to the damage dealt to target opponent this turn.', { pt: ['4', '4'] });

describe('CR 120.1, 120.3, 608.2c: "you may discard your hand and draw cards equal to the damage dealt to target opponent this turn."', () => {
  const setup = (): GameState => mpScenario({ defs: [BOLT, SMALL, DRAGON, BEAR], zones: { p1: { hand: ['Test Bolt', 'Test Small Bolt', 'Test Dragon', 'Test Bear'] } } });
  it('is automated', () => expect(full(DRAGON)).toBe(true));
  it('draws as many cards as the damage dealt to the chosen opponent this turn, by all sources, and not the damage dealt to another opponent', () => {
    let s = setup();
    s = cast(s, 'Test Bolt', { targets: [[player('p2')]] });
    s = cast(s, 'Test Small Bolt', { targets: [[player('p3')]] });
    s = cast(s, 'Test Dragon', { targets: [[player('p2')]], yes: [true] });
    expect(handSize(s, 'p1')).toBe(3); // the hand (one Bear) was discarded, three cards drawn
    expect(namesOn(s, 'p1')).toEqual(['Test Dragon']); // (the Bear in hand went to the graveyard)
    expect(s.zones.graveyard['p1']!.map((id) => s.defs[s.objects[id]!.defId]!.name)).toContain('Test Bear');
  });
  it('the other opponent chosen counts that one\'s damage; an opponent not damaged this turn gives no cards', () => {
    let s = setup();
    s = cast(s, 'Test Bolt', { targets: [[player('p2')]] });
    s = cast(s, 'Test Small Bolt', { targets: [[player('p3')]] });
    const t = cast(s, 'Test Dragon', { targets: [[player('p3')]], yes: [true] });
    expect(handSize(t, 'p1')).toBe(2);
    const u = cast(s, 'Test Dragon', { targets: [[player('p4')]], yes: [true] });
    expect(handSize(u, 'p1')).toBe(0);
  });
  it('declining the "may" keeps the hand and draws nothing', () => {
    let s = setup();
    s = cast(s, 'Test Bolt', { targets: [[player('p2')]] });
    const before = handSize(s, 'p1');
    s = cast(s, 'Test Dragon', { targets: [[player('p2')]], yes: [false] });
    expect(handSize(s, 'p1')).toBe(before - 1); // only the Dragon left the hand
  });
});

// ---- "You may pay any amount of life. If you do, draw that many cards." ---------------------------------------------------------------------------------------------

const PACT = card('Test Pact', 'Sorcery', 'You may pay any amount of life. If you do, draw that many cards.');

describe('CR 118.12, 119.4, 608.2d: "You may pay any amount of life. If you do, draw that many cards."', () => {
  const setup = (life = 20): GameState => mpScenario({ defs: [PACT], life, zones: { p1: { hand: ['Test Pact'] } } });
  it('is automated', () => expect(full(PACT)).toBe(true));
  it('pays the number you choose and draws that many cards', () => {
    const s = cast(setup(), 'Test Pact', { numbers: [3] });
    expect(lifeOf(s, 'p1')).toBe(17);
    expect(handSize(s, 'p1')).toBe(handSize(setup(), 'p1') - 1 + 3);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
  it('paying nothing is not "doing" it: no life is lost and no card is drawn (the negative case)', () => {
    const s = cast(setup(), 'Test Pact', { numbers: [0] });
    expect(lifeOf(s, 'p1')).toBe(20);
    expect(handSize(s, 'p1')).toBe(handSize(setup(), 'p1') - 1);
  });
  it('the most you can pay is your life total (CR 119.4: you can pay life only if your life total is at least the payment)', () => {
    const s0 = setup(4);
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Pact', 'hand', 'p1') });
    for (let i = 0; i < 10 && s.pending?.kind !== 'chooseNumber'; i++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : drive(s);
    expect(s.pending?.kind).toBe('chooseNumber');
    expect((s.pending as { max: number }).max).toBe(4);
    s = cast(setup(4), 'Test Pact', { numbers: [4] });
    expect(lifeOf(s, 'p1')).toBe(0);
  });
});

// ---- "you may discard any number of cards. If you do, draw that many cards." under a trigger with an amount of its own -------------------------------------------------------

const BRUTE = card('Test Brute', 'Creature — Zombie', 'Whenever this creature deals combat damage to a player, you may discard any number of cards. If you do, draw that many cards.', { pt: ['3', '3'] });

describe('CR 608.2c, 608.2h: "that many" after "you may discard any number of cards. If you do," is the discard\'s count, not the combat damage', () => {
  it('is automated', () => expect(full(BRUTE)).toBe(true));
  it('reads the discard\'s result as the number (and the damage amount is not a candidate)', () => {
    const json = JSON.stringify(BRUTE.faces[0]!.abilities);
    expect(json).toContain('"q":"resultCount"');
    expect(json).not.toContain('"q":"eventAmount"');
  });
});

// ---- the reflexive form, with life ---------------------------------------------------------------------------------------------------------------------------------------

const ZAP = card('Test Zap', 'Sorcery', 'You may pay any amount of life. When you do, Test Zap deals that much damage to target player.');

describe('CR 118.12, 603.12, 608.2d: "You may pay any amount of life. When you do, ~ deals that much damage to target player."', () => {
  it('is automated; the damage is the life paid, and paying nothing deals none (the negative case)', () => {
    expect(full(ZAP)).toBe(true);
    const setup = (): GameState => mpScenario({ defs: [ZAP], zones: { p1: { hand: ['Test Zap'] } } });
    const a = cast(setup(), 'Test Zap', { numbers: [5], targets: [[player('p2')]] });
    expect([lifeOf(a, 'p1'), lifeOf(a, 'p2')]).toEqual([15, 15]);
    const b = cast(setup(), 'Test Zap', { numbers: [0], targets: [[player('p2')]] });
    expect([lifeOf(b, 'p1'), lifeOf(b, 'p2')]).toEqual([20, 20]);
  });
});

const SCRIBE = card('Test Scribe', 'Enchantment', 'Whenever you lose life, draw a card.');

describe('CR 119.4, 118.3: paying any amount of life is ONE payment of that much life (one life-loss event), not one payment for each point', () => {
  it('a "whenever you lose life" ability triggers once for a payment of 3', () => {
    const s0 = mpScenario({ defs: [PACT, SCRIBE], zones: { p1: { hand: ['Test Pact'], battlefield: ['Test Scribe'] } } });
    const base = handSize(s0, 'p1');
    const s = cast(s0, 'Test Pact', { numbers: [3] });
    expect(lifeOf(s, 'p1')).toBe(17);
    expect(handSize(s, 'p1')).toBe(base - 1 + 3 + 1); // three drawn for the payment, one for the single trigger
  });
});
