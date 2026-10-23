/**
 * std-cardcopy-5 (lane std-cardcopy): the round's engine changes played through the engine with synthetic cards compiled by the game's default compiler (wordings
 * invented, design 6.10). Each test is named after the rule it checks, with its negative case. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 603.2c, 603.10a  "Whenever one or more creatures you control and/or creature cards in your graveyard are put into exile": once per batch, from either origin;
 *                    not for an opponent's creature or card
 *   CR 608.2d, 707.2, 707.9a, 611.2a  "you may choose a creature card from among them. Until end of turn, target token you control becomes a copy of it, except it
 *                    has flying": the token is a copy of the chosen card with flying until the end of the turn; nothing chosen, nothing changes
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
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

const JUDGE = card('Test Spirit Judge', 'Enchantment', 'Whenever one or more creatures you control and/or creature cards in your graveyard are put into exile, you may choose a creature card from among them. Until end of turn, target token you control becomes a copy of it, except it has flying.');
const CONJURE = card('Test Conjure', 'Sorcery', 'Create a 1/1 white Spirit creature token.');
const BANISH = card('Test Banish', 'Instant', 'Exile target creature.');
const EXHUME = card('Test Scour', 'Instant', 'Exile target card from a graveyard.');
const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['4', '5'] });
const KDEFS: CardDef[] = [JUDGE, CONJURE, BANISH, EXHUME, OX];

const tokenOf = (s: GameState): string => s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1')!;
/** The judge and a Spirit token on p1's side; `hand` holds the spells. */
function judged(o: { p1bf?: string[]; p2bf?: string[]; p1gy?: string[]; p2gy?: string[] } = {}): GameState {
  let s = scenario(['Plains'], { defs: KDEFS, p1: { hand: ['Test Conjure', 'Test Banish', 'Test Scour'], battlefield: ['Test Spirit Judge', ...(o.p1bf ?? [])], graveyard: o.p1gy ?? [] }, p2: { battlefield: o.p2bf ?? [], graveyard: o.p2gy ?? [] } });
  s = settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Conjure', 'hand', 'p1') })));
  return s;
}
/** Cast `spell` on `victim`; when the trigger asks, target the token, choose the card (or nothing), and let everything resolve. */
function exileWith(s0: GameState, spell: string, victim: string, pick: string | null): GameState {
  let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, spell, 'hand', 'p1') }), [target(victim)]);
  for (let i = 0; i < 60 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
    const d = s.pending!;
    if (d.kind === 'chooseTargets') s = drive(answer(s, target(tokenOf(s))));
    else if (d.kind === 'chooseObjects') {
      const ids = pick === null ? [] : s.zones.exile.filter((id) => s.defs[s.objects[id]!.defId]!.name === pick).slice(0, 1);
      s = drive(answer(s, { kind: 'chooseObjects', ids } as DecisionAnswer));
    } else if (d.kind === 'priority') s = next(s);
    else s = drive(s);
  }
  return s;
}

describe('the synthetic Kaya cards are automated', () => {
  it('every synthetic card plays fully', () => {
    for (const d of KDEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 603.2c, 603.10a, 707.2, 707.9a: "... are put into exile, you may choose a creature card from among them ... becomes a copy of it, except it has flying"', () => {
  it('CR 707.2, 707.9a: a creature you control exiled: the token becomes a copy of it with flying until end of turn', () => {
    const s0 = judged({ p1bf: ['Test Ox'] });
    const s = exileWith(s0, 'Test Banish', find(s0, 'Test Ox', 'battlefield', 'p1'), 'Test Ox');
    const c = getChars(s, tokenOf(s))!;
    expect(c.name).toBe('Test Ox');
    expect([Number(c.power), Number(c.toughness)]).toEqual([4, 5]);
    expect(c.keywords.some((k) => k.keyword === 'flying')).toBe(true);
  });
  it('CR 611.2a: at the end of the turn the token is itself again', () => {
    const s0 = judged({ p1bf: ['Test Ox'] });
    let s = exileWith(s0, 'Test Banish', find(s0, 'Test Ox', 'battlefield', 'p1'), 'Test Ox');
    s = mainOf(s, 'p2');
    expect(getChars(s, tokenOf(s))!.name).not.toBe('Test Ox');
  });
  it('CR 603.10a: a creature card of your graveyard exiled triggers it too', () => {
    const s0 = judged({ p1gy: ['Test Ox'] });
    const s = exileWith(s0, 'Test Scour', find(s0, 'Test Ox', 'graveyard', 'p1'), 'Test Ox');
    expect(getChars(s, tokenOf(s))!.name).toBe('Test Ox');
  });
  it('CR 608.2d: nothing chosen, the token is unchanged', () => {
    const s0 = judged({ p1bf: ['Test Ox'] });
    const s = exileWith(s0, 'Test Banish', find(s0, 'Test Ox', 'battlefield', 'p1'), null);
    expect(getChars(s, tokenOf(s))!.name).not.toBe('Test Ox');
  });
  it('CR 603.2: an opponent\'s creature or a creature card of an opponent\'s graveyard exiled does not trigger it', () => {
    let s0 = judged({ p2bf: ['Test Ox'] });
    let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Banish', 'hand', 'p1') }), [target(find(s0, 'Test Ox', 'battlefield', 'p2'))]);
    s = settle(s);
    expect(getChars(s, tokenOf(s))!.name).not.toBe('Test Ox');
    expect(s.log.some((l) => /Test Spirit Judge triggers/.test(String(l.text)))).toBe(false);
    s0 = judged({ p2gy: ['Test Ox'] });
    s = settle(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Scour', 'hand', 'p1') }), [target(find(s0, 'Test Ox', 'graveyard', 'p2'))]));
    expect(s.log.some((l) => /Test Spirit Judge triggers/.test(String(l.text)))).toBe(false);
  });
});
