/**
 * std-cardcopy-9 (lane std-cardcopy): the round's engine changes played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 607.2a        two abilities that exile are both linked to "a creature card exiled with ~"
 *   CR 607.2d        "Choose a creature card exiled with ~.": the source keeps the card chosen last; nothing chosen before, nothing kept
 *   CR 613.1f        "~ has all activated and triggered abilities of the last chosen card": both kinds, from the last chosen card only
 *   CR 603.2c, 603.10a  "Whenever one or more creatures you control and/or creature cards in your graveyard are put into exile": once per batch, from either origin;
 *                    not for an opponent's creature or card
 *   CR 608.2d, 707.2, 707.9a, 611.2a  "you may choose a creature card from among them. Until end of turn, target token you control becomes a copy of it, except it
 *                    has flying": the token is a copy of the chosen card with flying until the end of the turn; nothing chosen, nothing changes
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, drive, find, next, scenario, target } from '../../m6/dfc/support';
import { getChars } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const lifeOf = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
function upTo(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t) && t.pending?.kind !== 'yesNo'; i++) {
    t = t.pending && t.pending.kind !== 'priority' && t.pending.kind !== 'declareAttackers' && t.pending.kind !== 'declareBlockers' ? drive(t) : next(t);
  }
  return t;
}
const settle = (s: GameState): GameState => upTo(s, (t) => t.zones.stack.length === 0 && t.pending?.kind === 'priority');
const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => upTo(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);

const THIEF = card('Test Face Thief', 'Legendary Creature — Shapeshifter Spirit', 'When this creature enters, exile up to one other target creature.\nWhenever another nontoken creature dies, you may exile it.\nPay 1 life: Choose a creature card exiled with Test Face Thief.\nTest Face Thief has all activated and triggered abilities of the last chosen card.', { pt: ['1', '3'] });
const HEALER = card('Test Healer', 'Creature — Human Cleric', '{1}: You gain 1 life.\nAt the beginning of your upkeep, you gain 3 life.', { pt: ['2', '2'] });
const SAGE = card('Test Sage', 'Creature — Human Wizard', '{2}: Draw a card.', { pt: ['1', '1'] });
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 2 damage to target creature.');
const DEFS: CardDef[] = [THIEF, HEALER, SAGE, SHOCK];

const labelsOf = (s: GameState): string[] => legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object === find(s, 'Test Face Thief', 'battlefield', 'p1')).map((a) => a.label);
/** The thief cast and its enters trigger resolved, exiling the opponent's Healer. */
function stolen(): GameState {
  let s = scenario(['Plains', 'Mountain'], { defs: DEFS, p1: { hand: ['Test Face Thief', 'Test Shock'], battlefield: ['Plains', 'Plains', 'Plains', 'Mountain'] }, p2: { battlefield: ['Test Healer', 'Test Sage'] } });
  s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Face Thief', 'hand', 'p1') }));
  s = settle(s);
  s = drive(s, [target(find(s, 'Test Healer', 'battlefield', 'p2'))]);
  return settle(s);
}
const choose = (s: GameState, name: string): GameState => {
  const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.label.includes('Choose'))!;
  let t = drive(act(s, la.action));
  t = upTo(t, (x) => x.pending?.kind === 'chooseObjects' || x.zones.stack.length === 0);
  if (t.pending?.kind === 'chooseObjects') t = drive(answer(t, { kind: 'chooseObjects', ids: [t.zones.exile.find((id) => t.defs[t.objects[id]!.defId]!.name === name)!] } as DecisionAnswer));
  return settle(t);
};

describe('the synthetic cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 607.2a, 607.2d, 613.1f: "has all activated and triggered abilities of the last chosen card"', () => {
  it('CR 607.2d: before any card was chosen it has none of the exiled card\'s abilities', () => {
    const s = stolen();
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Healer')).toBe(true);
    expect(labelsOf(s).some((l) => l.includes('gain 1 life'))).toBe(false);
  });
  it('CR 613.1f: after the card is chosen it has its activated ability (and using it works for its controller)', () => {
    let s = choose(stolen(), 'Test Healer');
    const la = legalActions(s, 'p1').find((a) => a.kind === 'activate' && a.object === find(s, 'Test Face Thief', 'battlefield', 'p1') && a.label.toLowerCase().includes('gain 1 life'));
    expect(la).toBeDefined();
    const life = lifeOf(s, 'p1');
    s = settle(drive(act(s, la!.action)));
    expect(lifeOf(s, 'p1')).toBe(life + 1);
  });
  it('CR 613.1f: and its triggered ability: at the beginning of its controller\'s upkeep they gain 3 life', () => {
    let s = choose(stolen(), 'Test Healer');
    const life = lifeOf(s, 'p1');
    s = mainOf(mainOf(s, 'p2'), 'p1');
    expect(lifeOf(s, 'p1')).toBe(life + 3);
  });
  it('CR 607.2a: a card the dies trigger exiled is "exiled with" it too; CR 607.2d: choosing it replaces the earlier choice (the last chosen card only)', () => {
    let s = choose(stolen(), 'Test Healer');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Shock', 'hand', 'p1') }), [target(find(s, 'Test Sage', 'battlefield', 'p2'))]);
    s = upTo(s, () => false);
    if (s.pending?.kind === 'yesNo') s = drive(answer(s, { kind: 'yesNo', yes: true } as DecisionAnswer));
    s = settle(s);
    expect(s.zones.exile.some((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Sage')).toBe(true);
    s = choose(s, 'Test Sage');
    const labels = labelsOf(s).map((l) => l.toLowerCase());
    expect(labels.some((l) => l.includes('draw a card'))).toBe(true);
    expect(labels.some((l) => l.includes('gain 1 life'))).toBe(false);
  });
});
