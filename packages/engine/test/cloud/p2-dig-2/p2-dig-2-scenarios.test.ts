/**
 * Phase 2 lane p2-dig, round p2-dig-2: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default
 * compiler. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 701.20a, 608.2c     "Scry 1, then you may reveal the top card of your library. If a creature card is revealed this way, draw a card.": a creature card revealed
 *                          draws; a land card revealed, or no reveal (the option declined), draws nothing
 *   CR 701.20a, 608.2c     "... If a land card is revealed this way, put it onto the battlefield tapped.": "it" is the revealed card (the condition names it), not ~
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { act, answer, find, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, pt?: [string, string], cost = '{0}'): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { yes?: boolean }
/** Answer the decisions that come up until a player has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes ?? true });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min) });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const resolveAll = (s0: GameState, script: Script = {}): GameState => {
  let s = s0;
  for (let i = 0; i < 10 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
};

const BEAR = card('Test Brown Bear', 'Creature — Bear', '', ['2', '2']);
const ROCK = card('Test Gray Rock', 'Artifact', '');
const PEEK = card('Test Keen Peek', 'Sorcery', 'You may reveal the top card of your library. If a creature card is revealed this way, draw a card.');

describe('CR 701.20a, 608.2c: "You may reveal the top card of your library. If a creature card is revealed this way, draw a card."', () => {
  it('is automated: the condition is that the card the reveal revealed is a creature card', () => {
    expect(full(PEEK)).toBe(true);
    expect(JSON.stringify(PEEK.faces)).toContain('"cond":{"cond":"matches","object":{"ref":"bound","name":"them"},"filter":{"types":["Creature"],"isCard":true}}');
  });
  const play = (top: string, yes: boolean): { drew: number } => {
    let s = scenario([], { defs: [PEEK, BEAR, ROCK], p1: { hand: ['Test Keen Peek'], library: [top] } });
    const hand = s.zones.hand.p1!.length;
    s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Keen Peek', 'hand', 'p1') }), { yes }), { yes });
    return { drew: s.zones.hand.p1!.length - (hand - 1) };
  };
  it('a creature card revealed: you draw it', () => expect(play('Test Brown Bear', true).drew).toBe(1));
  it('the negative case: a noncreature card revealed: no draw', () => expect(play('Test Gray Rock', true).drew).toBe(0));
  it('the negative case: the option declined, nothing was revealed: no draw', () => expect(play('Test Brown Bear', false).drew).toBe(0));
});

describe('CR 701.20a, 608.2c: "When this creature enters, you may reveal the top card of your library. If a land card is revealed this way, put it onto the battlefield tapped."', () => {
  const SCOUT = card('Test Path Scout', 'Creature — Elf Scout', 'When this creature enters, you may reveal the top card of your library. If a land card is revealed this way, put it onto the battlefield tapped.', ['1', '1'], '{0}');
  const LAND = card('Test Moss Field', 'Land', '');
  it('is automated; "it" is the revealed card (the creature itself is not moved)', () => {
    expect(full(SCOUT)).toBe(true);
    expect(JSON.stringify(SCOUT.faces)).toContain('{"op":"move","what":{"ref":"bound","name":"them"},"to":{"zone":"battlefield","controller":{"ref":"you"},"tapped":true}}');
  });
  it('a land card revealed enters tapped; a creature card revealed stays on top', () => {
    for (const [top, enters] of [['Test Moss Field', true], ['Test Brown Bear', false]] as const) {
      let s = scenario([], { defs: [SCOUT, LAND, BEAR], p1: { hand: ['Test Path Scout'], library: [top] } });
      s = resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Path Scout', 'hand', 'p1') })));
      const onBf = s.zones.battlefield.filter((id) => s.objects[id]!.defId === top);
      expect(onBf.length, top).toBe(enters ? 1 : 0);
      if (enters) expect(s.objects[onBf[0]!]!.tapped).toBe(true);
      else expect(s.objects[s.zones.library.p1![0]!]!.defId).toBe(top);
      expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Path Scout')).toBe(true);
    }
  });
});
