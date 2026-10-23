/**
 * Cloud r4-repl (Standard round 4: replacement and prevention effects): the self-replacement shapes of spells (CR 614.15, 608.2c) this slice reads, played through
 * the engine with synthetic cards compiled by the game's default compiler (invented names, numbers and wordings, design 6.10). Each test is named after the rule
 * it checks.
 *
 *   CR 601.2a, 707.10, 614.15   "If ~ wasn't cast from your hand, draw two cards instead." (the negated cast-record zone)
 *   CR 702.33d, 707.2, 614.15   "Create a token that's a copy of target creature. If ~ was kicked, create three of those tokens instead."
 *   CR 107.3, 608.2h, 614.15    "Create two 1/1 tokens. If ~ was kicked, instead create X of those tokens, where X is ..."
 *   CR 406.1, 614.15            "Exile the top two cards of your library. If ~ was kicked, exile the top three cards instead. ... you may play those cards."
 *   CR 120.3, 614.15            "If ~ was kicked, the creature you control deals twice that much damage instead."
 *   CR 701.23a, 614.15          "If ~ was kicked, instead search your library for two basic land cards, put them onto the battlefield, then shuffle."
 *   CR 614.15, 608.2c           "..., reveal it, and put it into your hand. If ~ was kicked, put that card onto the battlefield instead. Then shuffle."
 *   CR 701.20e, 614.15          "Put one of them into your hand. If ~ was kicked, put two of them into your hand instead. Put the rest ..."
 *   CR 701.20e, 614.15          "Put each of those cards into your hand instead if ..." (every card of the group)
 *   CR 613.4b, 614.15           "If ~ was kicked, it has base power and toughness 1/1 until end of turn instead." (only the base P/T is replaced)
 *   CR 614.15, 119.3            "You draw two cards and lose 2 life. If C, instead you draw two cards and each opponent loses 2 life."
 *   CR 107.3, 601.2b, 614.15    "Draw X cards. If X is 5 or more, instead draw X cards and you gain X life."
 *   CR 608.2c, 404.1            "If there is an instant card and a sorcery card in your graveyard, draw two cards instead."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: PlayerId): string[] => s.zones[zone][p]!.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const tokensOf = (s: GameState, p: PlayerId): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === p);

type Targets = ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][];
/** Answer the decisions until priority: payments automatic, targets in order, yes/no by `yes`, a choice by `pick` (names in order) or else its first options. */
function drive(s0: GameState, o: { targets?: Targets; yes?: boolean; pick?: string[]; x?: number } = {}): GameState {
  let s = s0;
  const q = [...(o.targets ?? [])];
  const picks = [...(o.pick ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: o.x ?? p.min });
    else if (p.kind === 'chooseObjects') {
      const want: ObjectId[] = [];
      while (picks.length > 0 && want.length < p.max) {
        const id = p.options.find((x) => !want.includes(x) && s.defs[s.objects[x]!.defId]!.name === picks[0]);
        if (id === undefined) break;
        want.push(id);
        picks.shift();
      }
      s = answer(s, { kind: 'chooseObjects', ids: want.length > 0 ? want : p.options.slice(0, p.min === 0 ? p.max : p.min) });
    } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}, zone: 'hand' | 'graveyard' = 'hand', method?: string): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, zone, 'p1'), ...(method ? { method } : {}) }), o), o);
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '5'] });

describe('Cloud r4-repl: "Draw a card. If ~ wasn\'t cast from your hand, draw two cards instead." (CR 601.2a, 614.15)', () => {
  const VISION = card('Test Vision', 'Instant', 'Draw a card. If this spell wasn\'t cast from your hand, draw two cards instead.\nFlashback {1}');
  it('is understood', () => expect(noManual(VISION)).toBe(true));
  it('CR 614.15: cast from the hand, one card is drawn', () => {
    const s0 = scenario([], { defs: [VISION], p1: { hand: ['Test Vision'], battlefield: ['Plains'] } });
    const s = cast(s0, 'Test Vision');
    expect(s.zones.hand.p1).toHaveLength(1);
  });
  it('CR 601.2a, 702.34a: cast from the graveyard (flashback), two cards are drawn instead', () => {
    const s0 = scenario([], { defs: [VISION], p1: { graveyard: ['Test Vision'], battlefield: ['Plains'] } });
    const s = cast(s0, 'Test Vision', {}, 'graveyard', 'flashback');
    expect(s.zones.hand.p1).toHaveLength(2);
  });
});

describe('Cloud r4-repl: "Create a token that\'s a copy of target creature. If ~ was kicked, create three of those tokens instead." (CR 702.33d, 707.2)', () => {
  const RITE = card('Test Rite', 'Sorcery', 'Kicker {1}\nCreate a token that\'s a copy of target creature. If this spell was kicked, create three of those tokens instead.');
  it('is understood', () => expect(noManual(RITE)).toBe(true));
  it('CR 702.33d, 614.15: kicked, three copies are created', () => {
    const s0 = scenario([], { defs: [RITE, BEAR], p1: { hand: ['Test Rite'], battlefield: ['Plains', 'Test Bear'] } });
    const s = cast(s0, 'Test Rite', { yes: true, targets: [[obj(find(s0, 'Test Bear', 'battlefield'))]] });
    expect(tokensOf(s, 'p1')).toHaveLength(3);
    expect(tokensOf(s, 'p1').every((id) => getChars(s, id)!.name === 'Test Bear')).toBe(true);
  });
  it('CR 608.2c: not kicked, one copy', () => {
    const s0 = scenario([], { defs: [RITE, BEAR], p1: { hand: ['Test Rite'], battlefield: ['Plains', 'Test Bear'] } });
    const s = cast(s0, 'Test Rite', { yes: false, targets: [[obj(find(s0, 'Test Bear', 'battlefield'))]] });
    expect(tokensOf(s, 'p1')).toHaveLength(1);
  });
});

describe('Cloud r4-repl: "Create two tapped 1/1 tokens. If ~ was kicked, instead create X of those tokens, where X is the number of creature cards in your graveyard." (CR 107.3)', () => {
  const DAYS = card('Test Days', 'Sorcery', 'Kicker {1}\nCreate two tapped 1/1 black Rat creature tokens. If this spell was kicked, instead create X of those tokens, where X is the number of creature cards in your graveyard.');
  it('is understood', () => expect(noManual(DAYS)).toBe(true));
  it('CR 107.3, 608.2h: kicked, as many tapped tokens as creature cards in the graveyard', () => {
    const s0 = scenario([], { defs: [DAYS, BEAR, OGRE], p1: { hand: ['Test Days'], battlefield: ['Plains'], graveyard: ['Test Bear', 'Test Ogre', 'Test Bear'] } });
    const s = cast(s0, 'Test Days', { yes: true });
    expect(tokensOf(s, 'p1')).toHaveLength(3);
    expect(tokensOf(s, 'p1').every((id) => s.objects[id]!.tapped)).toBe(true);
  });
  it('CR 608.2c: not kicked, two tokens', () => {
    const s0 = scenario([], { defs: [DAYS, BEAR], p1: { hand: ['Test Days'], battlefield: ['Plains'], graveyard: ['Test Bear'] } });
    expect(tokensOf(cast(s0, 'Test Days', { yes: false }), 'p1')).toHaveLength(2);
  });
});

describe('Cloud r4-repl: "Exile the top two cards of your library. If ~ was kicked, exile the top three cards instead. Until the end of your next turn, you may play those cards." (CR 406.1)', () => {
  const PEEK = card('Test Curiosity', 'Sorcery', 'Kicker {1}\nExile the top two cards of your library. If this spell was kicked, exile the top three cards instead. Until the end of your next turn, you may play those cards.');
  it('is understood', () => expect(noManual(PEEK)).toBe(true));
  it('CR 614.15, 611.2a: kicked, three cards are exiled, and each may be played', () => {
    const s0 = scenario([], { defs: [PEEK], p1: { hand: ['Test Curiosity'], battlefield: ['Plains'] } });
    const s = cast(s0, 'Test Curiosity', { yes: true });
    expect(s.zones.exile).toHaveLength(3);
  });
  it('CR 608.2c: not kicked, two', () => {
    const s0 = scenario([], { defs: [PEEK], p1: { hand: ['Test Curiosity'], battlefield: ['Plains'] } });
    expect(cast(s0, 'Test Curiosity', { yes: false }).zones.exile).toHaveLength(2);
  });
});

describe('Cloud r4-repl: "Target creature you control deals damage equal to its power to target creature an opponent controls. If ~ was kicked, the creature you control deals twice that much damage instead." (CR 120.3)', () => {
  const KICK = card('Test Kick', 'Sorcery', 'Kicker {1}\nTarget creature you control deals damage equal to its power to target creature an opponent controls. If this spell was kicked, the creature you control deals twice that much damage instead.');
  it('is understood', () => expect(noManual(KICK)).toBe(true));
  it('CR 120.3, 614.15: kicked, a 2-power creature deals 4 damage', () => {
    const s0 = scenario([], { defs: [KICK, BEAR, OGRE], p1: { hand: ['Test Kick'], battlefield: ['Plains', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const s = cast(s0, 'Test Kick', { yes: true, targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))], [obj(ogre)]] });
    expect(s.objects[ogre]?.damage).toBe(4);
  });
  it('CR 608.2c: not kicked, 2 damage', () => {
    const s0 = scenario([], { defs: [KICK, BEAR, OGRE], p1: { hand: ['Test Kick'], battlefield: ['Plains', 'Test Bear'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const s = cast(s0, 'Test Kick', { yes: false, targets: [[obj(find(s0, 'Test Bear', 'battlefield', 'p1'))], [obj(ogre)]] });
    expect(s.objects[ogre]?.damage).toBe(2);
  });
});

describe('Cloud r4-repl: "Search your library for a basic land card, put it onto the battlefield, then shuffle. If ~ was kicked, instead search your library for two basic land cards, put them onto the battlefield, then shuffle." (CR 701.23a)', () => {
  const ASHES = card('Test Ashes', 'Sorcery', 'Kicker {1}\nSearch your library for a basic land card, put it onto the battlefield, then shuffle. If this spell was kicked, instead search your library for two basic land cards, put them onto the battlefield, then shuffle.');
  it('is understood', () => expect(noManual(ASHES)).toBe(true));
  it('CR 701.23a, 614.15: kicked, two basic lands enter untapped', () => {
    const s0 = scenario(['Forest'], { defs: [ASHES], p1: { hand: ['Test Ashes'], battlefield: ['Plains'], library: ['Forest', 'Forest'] } });
    const s = cast(s0, 'Test Ashes', { yes: true, pick: ['Forest', 'Forest'] });
    const forests = findAll(s, 'Forest', 'battlefield', 'p1');
    expect(forests).toHaveLength(2);
    expect(forests.every((id) => !s.objects[id]!.tapped)).toBe(true);
  });
  it('CR 608.2c: not kicked, one', () => {
    const s0 = scenario(['Forest'], { defs: [ASHES], p1: { hand: ['Test Ashes'], battlefield: ['Plains'], library: ['Forest', 'Forest'] } });
    expect(findAll(cast(s0, 'Test Ashes', { yes: false, pick: ['Forest'] }), 'Forest', 'battlefield', 'p1')).toHaveLength(1);
  });
});

describe('Cloud r4-repl: "Search your library for a Vehicle card, reveal it, and put it into your hand. If ~ was kicked, put that card onto the battlefield instead. Then shuffle." (CR 614.15, 608.2c)', () => {
  const SEARCH = card('Test Bequest', 'Sorcery', 'Kicker {1}\nSearch your library for an artifact card, reveal it, and put it into your hand. If this spell was kicked, put that card onto the battlefield instead. Then shuffle.');
  const RELIC = card('Test Relic', 'Artifact', '');
  it('is understood', () => expect(noManual(SEARCH)).toBe(true));
  it('CR 614.15: kicked, the card found is put onto the battlefield, not into the hand (the search and the reveal are done either way)', () => {
    const s0 = scenario([], { defs: [SEARCH, RELIC], p1: { hand: ['Test Bequest'], battlefield: ['Plains'], library: ['Test Relic'] } });
    const s = cast(s0, 'Test Bequest', { yes: true, pick: ['Test Relic'] });
    expect(findAll(s, 'Test Relic', 'battlefield', 'p1')).toHaveLength(1);
    expect(names(s, 'hand', 'p1')).toEqual([]);
  });
  it('CR 608.2c: not kicked, the card goes to the hand', () => {
    const s0 = scenario([], { defs: [SEARCH, RELIC], p1: { hand: ['Test Bequest'], battlefield: ['Plains'], library: ['Test Relic'] } });
    expect(names(cast(s0, 'Test Bequest', { yes: false, pick: ['Test Relic'] }), 'hand', 'p1')).toEqual(['Test Relic']);
  });
});

describe('Cloud r4-repl: "Look at the top four cards. Put one of those cards into your hand. If ~ was kicked, put two of those cards into your hand instead. Put the rest on the bottom ..." (CR 701.20e)', () => {
  const CHARTS = card('Test Charts', 'Instant', 'Kicker {1}\nLook at the top four cards of your library. Put one of those cards into your hand. If this spell was kicked, put two of those cards into your hand instead. Put the rest on the bottom of your library in a random order.');
  it('is understood', () => expect(noManual(CHARTS)).toBe(true));
  it('CR 614.15: kicked, two cards go to the hand and two to the bottom', () => {
    const s0 = scenario([], { defs: [CHARTS], p1: { hand: ['Test Charts'], battlefield: ['Plains'] } });
    const s = cast(s0, 'Test Charts', { yes: true });
    expect(s.zones.hand.p1).toHaveLength(2);
    expect(s.zones.library.p1).toHaveLength(18); // 20 cards: two to the hand, the other two back on the bottom
  });
  it('CR 608.2c: not kicked, one card', () => {
    const s0 = scenario([], { defs: [CHARTS], p1: { hand: ['Test Charts'], battlefield: ['Plains'] } });
    expect(cast(s0, 'Test Charts', { yes: false }).zones.hand.p1).toHaveLength(1);
  });
});

describe('Cloud r4-repl: "Put one of them into your hand and the rest on the bottom ... Put each of those cards into your hand instead if ..." (CR 701.20e, 614.15)', () => {
  const WISDOM = card('Test Wisdom', 'Instant', 'Look at the top three cards of your library. Put one of those cards into your hand and the rest on the bottom of your library in any order. Put each of those cards into your hand instead if there are two or more creature cards in your graveyard.');
  it('is understood', () => expect(noManual(WISDOM)).toBe(true));
  it('CR 614.15: with the condition, every card looked at goes to the hand', () => {
    const s0 = scenario([], { defs: [WISDOM, BEAR], p1: { hand: ['Test Wisdom'], battlefield: ['Plains'], graveyard: ['Test Bear', 'Test Bear'] } });
    expect(cast(s0, 'Test Wisdom').zones.hand.p1).toHaveLength(3);
  });
  it('CR 608.2c: without it, one card', () => {
    const s0 = scenario([], { defs: [WISDOM], p1: { hand: ['Test Wisdom'], battlefield: ['Plains'] } });
    expect(cast(s0, 'Test Wisdom').zones.hand.p1).toHaveLength(1);
  });
});

describe('Cloud r4-repl: "Until end of turn, target creature becomes an artifact creature with base power and toughness 4/3. If ~ was kicked, it has base power and toughness 1/1 until end of turn instead." (CR 613.4b)', () => {
  const MASK = card('Test Mask', 'Instant', 'Kicker {1}\nUntil end of turn, target artifact or creature becomes an artifact creature with base power and toughness 4/3. If this spell was kicked, it has base power and toughness 1/1 until end of turn instead.');
  it('is understood', () => expect(noManual(MASK)).toBe(true));
  it('CR 614.15, 613.4b: kicked, the creature is a 1/1 ARTIFACT creature (only the base P/T is replaced, the type change stays)', () => {
    const s0 = scenario([], { defs: [MASK, OGRE], p1: { hand: ['Test Mask'], battlefield: ['Plains'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    const s = cast(s0, 'Test Mask', { yes: true, targets: [[obj(ogre)]] });
    expect(ptOf(s, ogre)).toBe('1/1');
    expect(getChars(s, ogre)!.types).toContain('Artifact');
  });
  it('CR 608.2c: not kicked, a 4/3 artifact creature', () => {
    const s0 = scenario([], { defs: [MASK, OGRE], p1: { hand: ['Test Mask'], battlefield: ['Plains'] }, p2: { battlefield: ['Test Ogre'] } });
    const ogre = find(s0, 'Test Ogre', 'battlefield', 'p2');
    expect(ptOf(cast(s0, 'Test Mask', { yes: false, targets: [[obj(ogre)]] }), ogre)).toBe('4/3');
  });
});

describe('Cloud r4-repl: "You draw two cards and lose 2 life. If C, instead you draw two cards and each opponent loses 2 life." (CR 614.15, 119.3)', () => {
  const DECODE = card('Test Decode', 'Sorcery', 'Kicker {1}\nYou draw two cards and lose 2 life. If this spell was kicked, instead you draw two cards and each opponent loses 2 life.');
  it('is understood', () => expect(noManual(DECODE)).toBe(true));
  it('CR 614.15: kicked, you draw two and each opponent loses 2 (you lose none)', () => {
    const s0 = scenario([], { defs: [DECODE], p1: { hand: ['Test Decode'], battlefield: ['Plains'] } });
    const s = cast(s0, 'Test Decode', { yes: true });
    expect([s.zones.hand.p1!.length, life(s, 'p1'), life(s, 'p2')]).toEqual([2, 20, 18]);
  });
  it('CR 608.2c: not kicked, you draw two and lose 2', () => {
    const s0 = scenario([], { defs: [DECODE], p1: { hand: ['Test Decode'], battlefield: ['Plains'] } });
    const s = cast(s0, 'Test Decode', { yes: false });
    expect([s.zones.hand.p1!.length, life(s, 'p1'), life(s, 'p2')]).toEqual([2, 18, 20]);
  });
});

describe('Cloud r4-repl: "Draw X cards. If X is 3 or more, instead draw X cards and you gain X life." (CR 107.3, 601.2b, 614.15)', () => {
  const FINALE = card('Test Finale', 'Sorcery', 'Draw X cards. If X is 3 or more, instead draw X cards and you gain X life.', { cost: '{X}' });
  it('is understood', () => expect(noManual(FINALE)).toBe(true));
  it('CR 107.3, 614.15: X = 3, three cards and 3 life', () => {
    const s0 = scenario([], { defs: [FINALE], p1: { hand: ['Test Finale'], battlefield: ['Plains', 'Plains', 'Plains'] } });
    const s = cast(s0, 'Test Finale', { x: 3 });
    expect([s.zones.hand.p1!.length, life(s, 'p1')]).toEqual([3, 23]);
  });
  it('CR 608.2c: X = 2, two cards and no life', () => {
    const s0 = scenario([], { defs: [FINALE], p1: { hand: ['Test Finale'], battlefield: ['Plains', 'Plains'] } });
    const s = cast(s0, 'Test Finale', { x: 2 });
    expect([s.zones.hand.p1!.length, life(s, 'p1')]).toEqual([2, 20]);
  });
});

describe('Cloud r4-repl: "Draw a card. If there is an instant card and a sorcery card in your graveyard, draw two cards instead." (CR 608.2c, 404.1)', () => {
  const STATE = card('Test Flow', 'Sorcery', 'Draw a card. If there is an instant card and a sorcery card in your graveyard, draw two cards instead.');
  const BOLT = card('Test Zap', 'Instant', 'Draw a card.');
  const RITE = card('Test Rite Two', 'Sorcery', 'Draw a card.');
  it('is understood', () => expect(noManual(STATE)).toBe(true));
  it('CR 608.2c: an instant card and a sorcery card in the graveyard, two cards', () => {
    const s0 = scenario([], { defs: [STATE, BOLT, RITE], p1: { hand: ['Test Flow'], battlefield: ['Plains'], graveyard: ['Test Zap', 'Test Rite Two'] } });
    expect(cast(s0, 'Test Flow').zones.hand.p1).toHaveLength(2);
  });
  it('CR 608.2c: only an instant card, one card', () => {
    const s0 = scenario([], { defs: [STATE, BOLT], p1: { hand: ['Test Flow'], battlefield: ['Plains'], graveyard: ['Test Zap', 'Test Zap'] } });
    expect(cast(s0, 'Test Flow').zones.hand.p1).toHaveLength(1);
  });
});
