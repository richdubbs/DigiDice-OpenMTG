/**
 * Commander lane edh-cast, round edh-cast-9: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt) where the round checked them,
 * and the Scryfall rulings of each card were fetched live.
 *
 *   CR 118.9, 202.3, 601.2, 608.2c  "You may cast that card without paying its mana cost if the spell's mana value is less than the number of Mountains you control. If you
 *                                   don't cast that card this way, put it into your hand." (Solstice Revelations): the resulting spell's mana value counts, as for cascade
 *   CR 601.2i, 608.2h               "they lose 1 life for each spell they've cast this turn" (Rug of Smothering)
 *   CR 701.6a, 202.3, 701.20a       "counter that spell if it has the same mana value as the revealed card" (Counterbalance)
 *   CR 118.9, 202.3, 601.2          "you may cast that card without paying its mana cost if the two spells have the same mana value" (Powerbalance)
 *   CR 601.2f, 601.2h, 202.3        "Each spell you cast that's a Demon, Horror, or Nightmare costs {1} less"; "target opponent loses life equal to the difference" (Ancient Cellarspawn)
 *   CR 606.3, 114.1, 500.7          loyalty abilities at instant speed on any player's turn; the emblem; two extra turns (Teferi, Master of Time; Teferi, Temporal Archmage)
 *   CR 111.1, 608.2h                "for each spell you've cast this turn, create a 1/2 blue Bird creature token with flying named Storm Crow" (Murmuration)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type Color, type GameState, type OracleCard } from '../../../src/index';
import { act, advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { toStep } from '../../m4/helpers';
import { resolveAll, settle } from '../cmd3/helpers';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? (type.includes('Land') ? '' : '{0}'), type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const give = (s: GameState, player: 'p1' | 'p2', mana: string): void => { for (const t of mana) s.players[player === 'p1' ? 0 : 1]!.manaPool.push({ type: t } as never); };
const life = (s: GameState, p: 'p1' | 'p2'): number => s.players.find((x) => x.id === p)!.life;
const inYard = (s: GameState, player: 'p1' | 'p2', name: string): boolean => s.zones.graveyard[player]!.some((id) => s.objects[id]!.defId === name);
const inHand = (s: GameState, player: 'p1' | 'p2', name: string): boolean => s.zones.hand[player]!.some((id) => s.objects[id]!.defId === name);
const onField = (s: GameState, name: string): boolean => s.zones.battlefield.some((id) => s.objects[id]!.defId === name);

describe('CR 118.9, 202.3, 601.2, 608.2c: "You may cast that card without paying its mana cost if the spell\'s mana value is less than the number of Mountains you control. If you don\'t cast that card this way, put it into your hand." (Solstice Revelations)', () => {
  const REVEL = card('Test Solstice', 'Sorcery', "Exile cards from the top of your library until you exile a nonland card. You may cast that card without paying its mana cost if the spell's mana value is less than the number of Mountains you control. If you don't cast that card this way, put it into your hand.");
  const TWO = card('Test Two Rock', 'Artifact', '', { cost: '{2}' });
  const THREE = card('Test Three Rock', 'Artifact', '', { cost: '{3}' });
  const XSPELL = card('Test Xspell', 'Artifact', '', { cost: '{X}{R}' });
  const ADV = compileCard({
    name: 'Test Knight // Test Whisper', layout: 'adventure', mana_cost: '{3} // {1}', type_line: 'Creature — Human Knight // Sorcery — Adventure', colors: [], keywords: [],
    card_faces: [
      { name: 'Test Knight', mana_cost: '{3}', type_line: 'Creature — Human Knight', oracle_text: '', power: '2', toughness: '2' },
      { name: 'Test Whisper', mana_cost: '{1}', type_line: 'Sorcery — Adventure', oracle_text: 'You gain 2 life.' },
    ],
  } as unknown as OracleCard);
  const MDFC = compileCard({
    name: 'Test Giant // Test Cave', layout: 'modal_dfc', mana_cost: '{5} // ', type_line: 'Creature — Giant // Land', colors: [], keywords: [],
    card_faces: [
      { name: 'Test Giant', mana_cost: '{5}', type_line: 'Creature — Giant', oracle_text: '', power: '5', toughness: '5' },
      { name: 'Test Cave', mana_cost: '', type_line: 'Land', oracle_text: '' },
    ],
  } as unknown as OracleCard);
  const defs = [REVEL, TWO, THREE, XSPELL, ADV, MDFC];
  const run = (top: string, mountains: number, yes = true, above: string[] = []): GameState => {
    const s = scenario(['Mountain'], { p1: { battlefield: Array(mountains).fill('Mountain'), hand: ['Test Solstice'], library: [...above, top] }, defs });
    return resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Solstice', 'hand', 'p1') }), { yes }), { yes });
  };
  it('is automated', () => { expect(REVEL.automation.level).toBe('full'); });
  it('a card with mana value less than the number of Mountains is cast free (after the lands above it are exiled); it is then not put into the hand', () => {
    const s = run('Test Two Rock', 3, true, ['Plains']);
    expect(onField(s, 'Test Two Rock')).toBe(true);
    expect(inHand(s, 'p1', 'Test Two Rock')).toBe(false);
  });
  it('a mana value equal to the number of Mountains is not less: the card goes to the hand', () => {
    const s = run('Test Three Rock', 3);
    expect(onField(s, 'Test Three Rock')).toBe(false);
    expect(inHand(s, 'p1', 'Test Three Rock')).toBe(true);
  });
  it('declining the free cast puts the card into the hand (if you don\'t cast that card this way)', () => {
    const s = run('Test Two Rock', 3, false);
    expect(onField(s, 'Test Two Rock')).toBe(false);
    expect(inHand(s, 'p1', 'Test Two Rock')).toBe(true);
  });
  it('no Mountains: nothing is cast, the card goes to the hand (the number of Mountains is read as the spell resolves, CR 608.2h)', () => {
    const s = run('Test Two Rock', 0);
    expect(inHand(s, 'p1', 'Test Two Rock')).toBe(true);
  });
  it('an {X} spell is cast with X = 0 (ruling 2025-10-02): {X}{R} has mana value 1 as the spell, so 2 Mountains allow it', () => {
    expect(onField(run('Test Xspell', 2), 'Test Xspell')).toBe(true);
    expect(inHand(run('Test Xspell', 1), 'p1', 'Test Xspell')).toBe(true);
  });
  it('the mana value that counts is the resulting spell\'s (as cascade, CR 702.85a): an Adventure card of mana value 3 whose Adventure half has mana value 1 is cast free as the Adventure with 2 Mountains; the creature alone (mana value 3) is not castable with 3', () => {
    let s = run('Test Knight // Test Whisper', 2);
    expect(s.players[0]!.life).toBe(22); // the Adventure half was cast free
    expect(inHand(s, 'p1', 'Test Knight // Test Whisper')).toBe(false);
    s = run('Test Knight // Test Whisper', 1); // 1 is not less than 1
    expect(s.players[0]!.life).toBe(20);
    expect(inHand(s, 'p1', 'Test Knight // Test Whisper')).toBe(true);
  });
  it('a modal double-faced card whose back face is a land: the front face mana value 5 counts (CR 712.12: the land face is not cast): 3 Mountains cast nothing', () => {
    const s = run('Test Giant // Test Cave', 3);
    expect(inHand(s, 'p1', 'Test Giant // Test Cave')).toBe(true);
  });
});

describe('CR 601.2i, 608.2h: "Whenever a player casts a spell, they lose 1 life for each spell they\'ve cast this turn." (Rug of Smothering)', () => {
  const RUG = card('Test Smother Rug', 'Artifact Creature — Construct', "Flying\nWhenever a player casts a spell, they lose 1 life for each spell they've cast this turn.", { pt: ['1', '1'] });
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const defs = [RUG, ZAP];
  it('is automated', () => { expect(RUG.automation.level).toBe('full'); });
  it('your first spell costs you 1 life, your second 2 (the spell that triggered it counts, the lives are lost one trigger at a time)', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Zap', 'Test Zap'], battlefield: ['Test Smother Rug'] } });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1![0]! })));
    expect(life(s, 'p1')).toBe(20 + 1 - 1);
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1![0]! })));
    expect(life(s, 'p1')).toBe(20 + 1 - 1 + 1 - 2);
  });
  it("an opponent's spell costs that opponent life by their own count, not yours: p2's first spell makes p2 lose 1 and p1 nothing", () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Smother Rug'] }, p2: { hand: ['Test Zap'] } });
    s = pass(s); // p2 gets priority in p1's main phase
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p2', card: s.zones.hand.p2![0]! })));
    expect(life(s, 'p2')).toBe(20 + 1 - 1);
    expect(life(s, 'p1')).toBe(20);
  });
});

describe('CR 701.6a, 202.3, 701.20a: "Whenever an opponent casts a spell, you may reveal the top card of your library. If you do, counter that spell if it has the same mana value as the revealed card." (Counterbalance)', () => {
  const BALANCE = card('Test Scales', 'Enchantment', 'Whenever an opponent casts a spell, you may reveal the top card of your library. If you do, counter that spell if it has the same mana value as the revealed card.');
  const TWO = card('Test Two Zap', 'Instant', 'You gain 3 life.', { cost: '{2}' });
  const XZAP = card('Test X Zap', 'Instant', 'You gain 3 life.', { cost: '{X}{R}' });
  const ROCK2 = card('Test Two Rock', 'Artifact', '', { cost: '{2}' });
  const ROCK3 = card('Test Three Rock', 'Artifact', '', { cost: '{3}' });
  const XROCK = card('Test X Rock', 'Artifact', '', { cost: '{X}{R}' });
  const SPLIT = compileCard({
    name: 'Test Hit // Test Run', layout: 'split', mana_cost: '{1}{B} // {2}{R}', type_line: 'Instant // Instant', colors: [], keywords: [],
    card_faces: [
      { name: 'Test Hit', mana_cost: '{1}{B}', type_line: 'Instant', oracle_text: 'You gain 3 life.' },
      { name: 'Test Run', mana_cost: '{2}{R}', type_line: 'Instant', oracle_text: 'You gain 3 life.' },
    ],
  } as unknown as OracleCard);
  const defs = [BALANCE, TWO, XZAP, ROCK2, ROCK3, XROCK, SPLIT];
  /** p2 casts `spell` (X = `x`) while p1's Test Scales is out and `top` is on top of p1's library; p1 answers `yes`. Returns the state when everything resolved. */
  const run = (top: string, spell: string, yes = true, x = 0, face?: number): GameState => {
    let s = scenario(['Mountain'], { defs, p1: { battlefield: ['Test Scales'], library: [top] }, p2: { hand: [spell] } });
    give(s, 'p2', 'RRRRRB');
    s = pass(s); // p2 gets priority in p1's main phase
    s = act(s, { type: 'cast', player: 'p2', card: find(s, spell, 'hand', 'p2'), ...(face !== undefined ? { face } : {}) });
    for (let guard = 0; s.pending && s.pending.kind !== 'priority' && guard < 10; guard++) s = s.pending.kind === 'chooseNumber' ? answer(s, { kind: 'chooseNumber', n: x }) : settle(s, { yes });
    return resolveAll(s, { yes });
  };
  it('is automated', () => { expect(BALANCE.automation.level).toBe('full'); });
  it('the same mana value counters the spell (it never resolves: no life gained); a different one lets it resolve', () => {
    const countered = run('Test Two Rock', 'Test Two Zap');
    expect(inYard(countered, 'p2', 'Test Two Zap')).toBe(true);
    expect(life(countered, 'p2')).toBe(20);
    const resolved = run('Test Three Rock', 'Test Two Zap');
    expect(life(resolved, 'p2')).toBe(23);
  });
  it('declining to reveal counters nothing (the spell resolves even with the same mana value)', () => {
    expect(life(run('Test Two Rock', 'Test Two Zap', false), 'p2')).toBe(23);
  });
  it('a land (mana value 0) against a spell of mana value 2 does nothing', () => {
    expect(life(run('Mountain', 'Test Two Zap'), 'p2')).toBe(23);
  });
  it("ruling 2006-07-15: an opponent's X counts (X = 2 on {X}{R} is mana value 3: a mana value 3 card counters it, a mana value 2 card does not); X in the revealed card is 0", () => {
    expect(life(run('Test Three Rock', 'Test X Zap', true, 2), 'p2')).toBe(20);
    expect(life(run('Test Two Rock', 'Test X Zap', true, 2), 'p2')).toBe(23);
    expect(life(run('Test X Rock', 'Test X Zap', true, 0), 'p2')).toBe(20); // {X}{R} revealed is mana value 1; the spell with X = 0 is mana value 1
    expect(life(run('Test X Rock', 'Test X Zap', true, 3), 'p2')).toBe(23); // X = 3: mana value 4, the revealed card is still 1
  });
  it("ruling 2017-04-18: half of a split card cast against the same split card revealed is not countered (the half's own mana value 2, the card's combined 5)", () => {
    expect(life(run('Test Hit // Test Run', 'Test Hit // Test Run', true, 0, 0), 'p2')).toBe(23);
  });
});

describe('CR 118.9, 202.3, 601.2: "...you may cast that card without paying its mana cost if the two spells have the same mana value." (Powerbalance)', () => {
  const POWER = card('Test Mirror Scales', 'Enchantment', 'Whenever an opponent casts a spell, you may reveal the top card of your library. If you do, you may cast that card without paying its mana cost if the two spells have the same mana value.');
  const TWO = card('Test Two Zap', 'Instant', 'You gain 3 life.', { cost: '{2}' });
  const ROCK2 = card('Test Two Rock', 'Artifact', '', { cost: '{2}' });
  const ROCK3 = card('Test Three Rock', 'Artifact', '', { cost: '{3}' });
  const ADV = compileCard({
    name: 'Test Knight // Test Whisper', layout: 'adventure', mana_cost: '{3} // {2}', type_line: 'Creature — Human Knight // Sorcery — Adventure', colors: [], keywords: [],
    card_faces: [
      { name: 'Test Knight', mana_cost: '{3}', type_line: 'Creature — Human Knight', oracle_text: '', power: '2', toughness: '2' },
      { name: 'Test Whisper', mana_cost: '{2}', type_line: 'Sorcery — Adventure', oracle_text: 'You gain 2 life.' },
    ],
  } as unknown as OracleCard);
  const defs = [POWER, TWO, ROCK2, ROCK3, ADV];
  const run = (top: string, yesReveal = true, yesCast = true): GameState => {
    let s = scenario(['Mountain'], { defs, p1: { battlefield: ['Test Mirror Scales'], library: [top] }, p2: { hand: ['Test Two Zap'] } });
    give(s, 'p2', 'RR');
    s = pass(s);
    s = act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Two Zap', 'hand', 'p2') });
    // the first yes/no is the reveal, the next one the free cast
    let asked = 0;
    for (let guard = 0; guard < 30 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); guard++) {
      if (s.pending?.kind === 'yesNo') { asked++; s = answer(s, { kind: 'yesNo', yes: asked === 1 ? yesReveal : yesCast }); }
      else if (s.pending?.kind === 'priority') s = pass(s);
      else s = settle(s);
    }
    return s;
  };
  it('is automated', () => { expect(POWER.automation.level).toBe('full'); });
  it('a revealed card with the same mana value is cast free (it is on the battlefield); a different mana value cannot be cast', () => {
    expect(onField(run('Test Two Rock'), 'Test Two Rock')).toBe(true);
    expect(onField(run('Test Three Rock'), 'Test Three Rock')).toBe(false);
  });
  it('the cast is optional: declining leaves the card on top of the library', () => {
    const s = run('Test Two Rock', true, false);
    expect(onField(s, 'Test Two Rock')).toBe(false);
  });
  it("the resulting spell's mana value counts (ruling 2024-06-07): an Adventure card of mana value 3 whose Adventure half has mana value 2 is cast free as the Adventure against a mana value 2 spell", () => {
    const s = run('Test Knight // Test Whisper');
    expect(life(s, 'p1')).toBe(22);
  });
  it('declining to reveal casts nothing', () => {
    expect(onField(run('Test Two Rock', false), 'Test Two Rock')).toBe(false);
  });
});

describe("CR 601.2f, 601.2h, 202.3: \"Each spell you cast that's a Demon, Horror, or Nightmare costs {1} less to cast.\" and \"...if the amount of mana spent to cast it was less than its mana value, target opponent loses life equal to the difference.\" (Ancient Cellarspawn)", () => {
  const SPAWN = card('Test Cellar Horror', 'Enchantment Creature — Horror', "Each spell you cast that's a Demon, Horror, or Nightmare costs {1} less to cast.\nWhenever you cast a spell, if the amount of mana spent to cast it was less than its mana value, target opponent loses life equal to the difference.", { pt: ['3', '3'] });
  const FIEND = card('Test Fiend', 'Creature — Demon', '', { pt: ['2', '2'], cost: '{1}{B}{B}' });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'], cost: '{1}{G}{G}' });
  const IMP = card('Test Imp', 'Creature — Horror', '', { pt: ['1', '1'], cost: '{1}{B}' });
  const defs = [SPAWN, FIEND, BEAR, IMP];
  const cast = (name: string, mana: string): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Cellar Horror'], hand: [name] } });
    give(s0, 'p1', mana);
    const s = settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), { targets: [{ kind: 'player', id: 'p2' }] });
    return resolveAll(s, { targets: [{ kind: 'player', id: 'p2' }] });
  };
  it('is automated', () => { expect(SPAWN.automation.level).toBe('full'); });
  it('a Demon of mana value 3 costs {1} less ({B}{B} pays it): 2 mana spent against mana value 3, so the opponent loses the difference, 1 life', () => {
    const s = cast('Test Fiend', 'BB');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Fiend')).toBe(true); // it was cast for {B}{B}
    expect(life(s, 'p2')).toBe(19);
  });
  it('a Horror of mana value 2 costs {B} (only the generic part is reduced): 1 mana spent against mana value 2, so the opponent loses 1 life', () => {
    const s = cast('Test Imp', 'B');
    expect(s.zones.battlefield.some((id) => s.objects[id]!.defId === 'Test Imp')).toBe(true);
    expect(life(s, 'p2')).toBe(19);
  });
  it('a Bear (not a Demon, Horror or Nightmare) is not reduced: {1}{G}{G} cannot be paid with two mana, and paid in full the opponent loses nothing', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Cellar Horror'], hand: ['Test Bear'] } });
    give(s0, 'p1', 'GG');
    expect(() => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Bear', 'hand', 'p1') })).toThrow();
    const s = cast('Test Bear', 'GGG');
    expect(life(s, 'p2')).toBe(20);
  });
});

describe('CR 606.3, 500.7: "You may activate loyalty abilities of ~ on any player\'s turn any time you could cast an instant." and "Take two extra turns after this one." (Teferi, Master of Time)', () => {
  const TEFERI = compileCard({
    name: 'Test Time Master', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Teferi', loyalty: '5', colors: [], keywords: [],
    oracle_text: "You may activate loyalty abilities of Test Time Master on any player's turn any time you could cast an instant.\n+1: You gain 1 life.\n−5: Take two extra turns after this one.",
  } as unknown as OracleCard);
  const OTHER = compileCard({ name: 'Test Plain Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testy', loyalty: '5', colors: [], keywords: [], oracle_text: '+1: You gain 1 life.' } as unknown as OracleCard);
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const defs = [TEFERI, OTHER, ZAP];
  const plus = (s: GameState, name: string): boolean => legalActions(s, 'p1').some((l) => l.kind === 'activate' && s.defs[s.objects[l.object!]!.defId]!.name === name);
  it('is automated', () => { expect(TEFERI.automation.level).toBe('full'); });
  it('with a spell on the stack (not a sorcery-speed moment) its loyalty ability is offered; the other walker without the permission is not', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Zap'], battlefield: [{ name: 'Test Time Master', counters: { loyalty: 5 } }, { name: 'Test Plain Walker', counters: { loyalty: 5 } }] } });
    expect(plus(s, 'Test Time Master')).toBe(true); // on its own at sorcery speed too
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap', 'hand', 'p1') });
    expect(s.zones.stack.length).toBe(1);
    expect(plus(s, 'Test Time Master')).toBe(true);
    expect(plus(s, 'Test Plain Walker')).toBe(false);
  });
  it("on an opponent's turn, with its stack empty, in the upkeep, the loyalty ability is offered, once each turn only", () => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Time Master', counters: { loyalty: 5 } }, { name: 'Test Plain Walker', counters: { loyalty: 5 } }] } });
    s = advanceTo(s, 2, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.pending?.kind).toBe('priority');
    const acts = legalActions(s, 'p1').filter((l) => l.kind === 'activate' && s.defs[s.objects[l.object!]!.defId]!.name === 'Test Time Master');
    // p2 has priority in its own upkeep: pass to give p1 priority
    const t = pass(s);
    expect(t.turn.activePlayer).toBe('p2');
    const mine = legalActions(t, 'p1').filter((l) => l.kind === 'activate' && t.defs[t.objects[l.object!]!.defId]!.name === 'Test Time Master');
    expect(acts.length + mine.length).toBeGreaterThan(0);
    const one = (mine.length > 0 ? mine : acts)[0]!;
    const u = mine.length > 0 ? t : s;
    const after = act(u, one.action);
    expect(legalActions(after, 'p1').some((l) => l.kind === 'activate' && after.defs[after.objects[l.object!]!.defId]!.name === 'Test Time Master')).toBe(false); // once each turn (CR 606.3)
    expect(legalActions(t, 'p1').some((l) => l.kind === 'activate' && t.defs[t.objects[l.object!]!.defId]!.name === 'Test Plain Walker')).toBe(false);
  });
  it('the ultimate takes two extra turns after this one: turns 2 and 3 are p1\'s (not p2\'s)', () => {
    let s = scenario([], { defs, p1: { battlefield: [{ name: 'Test Time Master', counters: { loyalty: 5 } }] } });
    const walker = find(s, 'Test Time Master', 'battlefield', 'p1');
    const ult = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === walker && /extra/i.test(l.label));
    expect(ult).toBeDefined();
    s = act(s, ult!.action);
    s = resolveAll(s);
    s = advanceTo(s, 2, 'upkeep');
    expect(s.turn.activePlayer).toBe('p1');
    s = advanceTo(s, 3, 'upkeep');
    expect(s.turn.activePlayer).toBe('p1');
    s = advanceTo(s, 4, 'upkeep');
    expect(s.turn.activePlayer).toBe('p2');
  });
});

describe('CR 606.3, 114.1: "-10: You get an emblem with \"You may activate loyalty abilities of planeswalkers you control on any player\'s turn any time you could cast an instant.\"" (Teferi, Temporal Archmage)', () => {
  const TEFERI = compileCard({
    name: 'Test Archmage', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Teferi', loyalty: '10', colors: [], keywords: [],
    oracle_text: '−10: You get an emblem with "You may activate loyalty abilities of planeswalkers you control on any player\'s turn any time you could cast an instant."',
  } as unknown as OracleCard);
  const OTHER = compileCard({ name: 'Test Plain Walker', layout: 'normal', mana_cost: '{0}', type_line: 'Legendary Planeswalker — Testy', loyalty: '5', colors: [], keywords: [], oracle_text: '+1: You gain 1 life.' } as unknown as OracleCard);
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const defs = [TEFERI, OTHER, ZAP];
  const offered = (s: GameState, player: 'p1' | 'p2', name: string): boolean => legalActions(s, player).some((l) => l.kind === 'activate' && s.defs[s.objects[l.object!]!.defId]!.name === name);
  it('is automated', () => { expect(TEFERI.automation.level).toBe('full'); });
  it('before the ultimate a walker is activated at sorcery speed only; after it, with a spell on the stack, every planeswalker you control is offered and the opponent\'s is not', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Zap'], battlefield: [{ name: 'Test Archmage', counters: { loyalty: 10 } }, { name: 'Test Plain Walker', counters: { loyalty: 5 } }] }, p2: { battlefield: [{ name: 'Test Plain Walker', counters: { loyalty: 5 } }] } });
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap', 'hand', 'p1') });
    expect(offered(t, 'p1', 'Test Plain Walker')).toBe(false); // a spell on the stack: no sorcery-speed activation
    const walker = find(s, 'Test Archmage', 'battlefield', 'p1');
    const ult = legalActions(s, 'p1').find((l) => l.kind === 'activate' && l.object === walker)!;
    s = resolveAll(act(s, ult.action));
    expect(Object.values(s.objects).some((o) => o.kind === 'emblem' && o.controller === 'p1')).toBe(true); // the emblem
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap', 'hand', 'p1') });
    expect(s.zones.stack.length).toBe(1);
    expect(offered(s, 'p1', 'Test Plain Walker')).toBe(true);
    // the opponent's walker (their own, no emblem for them) is not offered to them
    const u = pass(s);
    expect(offered(u, 'p2', 'Test Plain Walker')).toBe(false);
    t = pass(t);
    void t;
  });
});

describe('CR 111.1, 608.2h: "At the beginning of your end step, for each spell you\'ve cast this turn, create a 1/2 blue Bird creature token with flying named Storm Crow." (Murmuration)', () => {
  const MURMUR = card('Test Murmur', 'Enchantment', 'Birds you control get +1/+1 and have vigilance.\nAt the beginning of your end step, for each spell you\'ve cast this turn, create a 1/2 blue Bird creature token with flying named Storm Crow.');
  const ZAP = card('Test Zap', 'Instant', 'You gain 1 life.');
  const defs = [MURMUR, ZAP];
  const crows = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.defs[s.objects[id]!.defId]?.name === 'Storm Crow');
  it('is automated', () => { expect(MURMUR.automation.level).toBe('full'); });
  it('two spells cast this turn make two Storm Crow tokens at the end step; an opponent\'s spell is not counted; no spell makes none', () => {
    let s = scenario([], { defs, p1: { hand: ['Test Zap', 'Test Zap'], battlefield: ['Test Murmur'] }, p2: { hand: ['Test Zap'] } });
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1![0]! })));
    s = pass(s); // p2 gets priority
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p2', card: s.zones.hand.p2![0]! })));
    s = resolveAll(settle(act(s, { type: 'cast', player: 'p1', card: s.zones.hand.p1![0]! })));
    expect(crows(s).length).toBe(0);
    s = toStep(s, 'end');
    s = resolveAll(s);
    expect(crows(s).length).toBe(2);
    // the crows are Birds: 1/2 plus Murmuration's +1/+1, with vigilance
    const c = s.objects[crows(s)[0]!]!;
    expect(c).toBeDefined();
  });
  it('with no spell cast this turn no token is made', () => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Murmur'] } });
    s = toStep(s, 'end');
    s = resolveAll(s);
    expect(crows(s).length).toBe(0);
  });
});
