/**
 * Lane p2-c-cast-zone, round p2-c-cast-zone-1: abilities that function off the battlefield (CR 113.6), played through the engine with synthetic cards (invented
 * names and wordings, design 6.10), compiled by the game's default compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 113.6k, 603.6c, 400.7   "When this card is put into your graveyard from your library, ...": it triggers from the graveyard, and "it" is the card there
 *   CR 113.6m, 603.4           "if this card is in your graveyard": the ability functions only there; from the hand it does not trigger
 *   CR 113.6k, 601.2i, 603.4   "When you cast this spell, if you have fewer than seven cards in hand, draw cards equal to the difference."
 *   CR 702.33d, 603.4          "When you cast this spell, if it was kicked, ...": the spell's own cast record
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** The card is parsed and automated without a manual unit. */
const automated = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const life = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.objects[id]!.defId);

/** Resolve everything, answering yes/no with `yes`, costs automatically and targets with none, until the stack is empty and p1 has priority. */
function settle(s0: GameState, yes = true): GameState {
  let s = s0;
  for (let guard = 0; guard < 300 && s.pending && !(s.pending.kind === 'priority' && s.zones.stack.length === 0 && s.pending.player === 'p1'); guard++) {
    const d = s.pending;
    if (d.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes });
    else if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (d.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: [] });
    else if (d.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: d.options.slice(0, d.min) });
    else if (d.kind === 'order') s = answer(s, { kind: 'order', ids: d.items.map((i) => i.id) });
    else if (d.kind === 'priority') s = pass(s);
    else throw new Error(`unexpected decision ${d.kind}: ${d.prompt}`);
  }
  return s;
}

describe('CR 113.6k, 603.6c: "When this card is put into your graveyard from your library, you may put it onto the battlefield."', () => {
  const MOEBA = card('Test Bog Wisp', 'Creature — Illusion', 'When this card is put into your graveyard from your library, you may put it onto the battlefield.', ['1', '1']);
  const DIG = card('Test Deep Sift', 'Sorcery', 'Mill ten cards.');
  it('is parsed and automated: a triggered ability that functions in the graveyard', () => {
    expect(automated(MOEBA)).toBe(true);
    expect(JSON.stringify(MOEBA.faces[0]!.abilities)).toContain('"zone":["graveyard"]');
  });
  it('milled from the library, it triggers from the graveyard and you put it onto the battlefield', () => {
    let s = scenario([], { p1: { hand: ['Test Deep Sift'], library: ['Test Bog Wisp'] }, defs: [MOEBA, DIG] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Deep Sift', 'hand', 'p1') });
    s = settle(s);
    expect(names(s, s.zones.battlefield)).toContain('Test Bog Wisp');
  });
  it('the negative case: put into the graveyard from the hand (discarded), it does not trigger', () => {
    const TOSS = card('Test Toss', 'Sorcery', 'Discard a card.');
    let s = scenario([], { p1: { hand: ['Test Toss', 'Test Bog Wisp'] }, defs: [MOEBA, TOSS] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Toss', 'hand', 'p1') });
    s = settle(s);
    expect(names(s, s.zones.battlefield)).not.toContain('Test Bog Wisp');
    expect(names(s, s.zones.graveyard['p1']!)).toContain('Test Bog Wisp');
  });
});

describe('CR 113.6m, 603.4: "Whenever you surveil, if this card is in your graveyard, you may pay 3 life. If you do, return this card to your hand."', () => {
  const AGENT = card('Test Ash Agent', 'Creature — Rogue', 'Whenever you surveil, if this card is in your graveyard, you may pay 3 life. If you do, return this card to your hand.', ['2', '1']);
  const PEEK = card('Test Peek', 'Sorcery', 'Surveil 1.');
  it('is parsed and automated: the condition is the card itself in your graveyard, and the ability functions there', () => {
    expect(automated(AGENT)).toBe(true);
    expect(JSON.stringify(AGENT.faces[0]!.abilities)).toContain('"interveningIf":{"cond":"matches","object":{"ref":"self"},"filter":{"zone":"graveyard","owner":"you"}}');
  });
  it('in your graveyard: you surveil, pay 3 life and return it to your hand', () => {
    let s = scenario([], { p1: { hand: ['Test Peek'], graveyard: ['Test Ash Agent'] }, defs: [AGENT, PEEK] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Peek', 'hand', 'p1') });
    s = settle(s);
    expect(names(s, s.zones.hand['p1']!)).toContain('Test Ash Agent');
    expect(life(s, 'p1')).toBe(17);
  });
  it('the negative case: in your hand, it does not trigger', () => {
    let s = scenario([], { p1: { hand: ['Test Peek', 'Test Ash Agent'] }, defs: [AGENT, PEEK] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Peek', 'hand', 'p1') });
    s = settle(s);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 113.6k, 603.4: "When you cast this spell, if you have fewer than seven cards in hand, draw cards equal to the difference."', () => {
  const TITAN = card('Test Vast Maw', 'Creature — Eldrazi', 'When you cast this spell, if you have fewer than seven cards in hand, draw cards equal to the difference.', ['5', '5']);
  it('is parsed and automated: a cast trigger on the stack whose amount reads its condition', () => {
    expect(automated(TITAN)).toBe(true);
    expect(JSON.stringify(TITAN.faces[0]!.abilities)).toContain('"zone":["stack"]');
  });
  it('cast with two other cards in hand: you draw five, to seven', () => {
    let s = scenario([], { p1: { hand: ['Test Vast Maw', 'Plains', 'Plains'] }, defs: [TITAN] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Vast Maw', 'hand', 'p1') });
    s = settle(s);
    expect(s.zones.hand['p1']!.length).toBe(7);
    expect(names(s, s.zones.battlefield)).toContain('Test Vast Maw');
  });
  it('the negative case: with seven other cards in hand, no draw', () => {
    let s = scenario([], { p1: { hand: ['Test Vast Maw', ...Array(7).fill('Plains')] }, defs: [TITAN] });
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Vast Maw', 'hand', 'p1') });
    s = settle(s);
    expect(s.zones.hand['p1']!.length).toBe(7);
  });
});

describe('CR 702.33d, 603.4: "When you cast this spell, if it was kicked, you gain 3 life."', () => {
  const SPAWN = card('Test Kicked Bloom', 'Creature — Plant', 'Kicker {0}\nWhen you cast this spell, if it was kicked, you gain 3 life.', ['1', '1']);
  it('is parsed and automated: the condition is this spell\'s own cast record (no object)', () => {
    expect(automated(SPAWN)).toBe(true);
    expect(JSON.stringify(SPAWN.faces[0]!.abilities)).toContain('"interveningIf":{"cond":"wasCast","kicked":true}');
  });
  it('kicked: you gain 3 life; not kicked: you do not', () => {
    for (const kick of [true, false]) {
      let s = scenario([], { p1: { hand: ['Test Kicked Bloom'] }, defs: [SPAWN] });
      s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Kicked Bloom', 'hand', 'p1') });
      s = settle(s, kick);
      expect(life(s, 'p1')).toBe(kick ? 23 : 20);
    }
  });
});
