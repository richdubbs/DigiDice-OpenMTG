/**
 * edh-players-7 (Commander lane edh-players): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented names
 * and wordings, design 6.10). Each test is named after the rule it checks, with its negative case. The rulings of the cards were fetched from Scryfall in the cloud session;
 * the CR cites are from memory except where the review checked them (unverified).
 *
 *   CR 121.1, 400.7, 118.12, 119.4, 608.2c  "you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 3 life or put the card on top of your library."
 *   CR 119.3, 106.4                          "add {R} for each 1 life your opponents have lost this turn"
 *   CR 701.22a, 121.1                        "Target player scries 2, then draws a card."
 *   CR 603.7, 704.5f, 613.4c, 109.2         "Whenever a creature dies this turn, each creature other than ~ gets -1/-1 until end of turn."
 *   CR 508.1, 603.2, 205.3m, 109.2           "it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it"
 *   CR 601.2a, 603.4, 702.10a                "if you didn't cast it from your hand, it gains haste until your next turn"
 *   CR 611.2c, 613.1f, 702.11b, 702.18a      "Until end of turn, creatures your opponents control lose hexproof and shroud and can't have hexproof or shroud."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, viewFor, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, advanceTo, answer, find, findAll, life, pass, passBoth, pool, put, scenario } from '../../m3/scenario';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as unknown as OracleCard);
}
/** Every ability of the card automated (no manual ability, no manual step). */
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));

interface Script { yes?: boolean[]; objects?: (ObjectId[] | ((options: ObjectId[], s: GameState) => ObjectId[]))[]; order?: (ids: string[]) => string[]; targets?: TargetChoice[][]; attackers?: ObjectId[] }
/** Answer the decisions that come up until a player has priority; the decisions asked are listed in `asked`. */
function drive(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = s0;
  for (let guard = 0; guard < 80 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    asked.push(p.kind);
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: (script.order ?? ((x) => x))(p.items.map((i) => i.id)) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: (script.attackers ?? []).map((attacker) => ({ attacker, defender: 'p2' as const })) });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Pass priority (both players) until the stack is empty, answering decisions with the script. */
function settle(s0: GameState, script: Script = {}, asked: string[] = []): GameState {
  let s = drive(s0, script, asked);
  for (let i = 0; i < 30 && s.zones.stack.length > 0 && s.pending?.kind === 'priority'; i++) s = drive(passBoth(s), script, asked);
  return s;
}
const castFree = (s: GameState, name: string, script: Script = {}, asked: string[] = []): GameState => settle(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), script, asked), script, asked);
const names = (s: GameState, ids: readonly ObjectId[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const pt = (s: GameState, id: ObjectId): [number, number] => { const c = getChars(s, id); return [Number(c.power), Number(c.toughness)]; };
const player = (s: GameState, id: 'p1' | 'p2') => s.players.find((p) => p.id === id)!;

describe('CR 121.1, 400.7, 118.12, 119.4: Sylvan Library\'s shape - "you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 3 life or put the card on top of your library."', () => {
  const LIB = card('Test Whisper Library', 'Enchantment', 'At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 3 life or put the card on top of your library.');
  const filler = ['Test Card A', 'Test Card B', 'Test Card C'].map((n) => card(n, 'Sorcery', ''));
  const defs = [LIB, ...filler];
  const setup = (): GameState => advanceTo(scenario([], { defs, p1: { battlefield: ['Test Whisper Library'], hand: ['Test Card C'], library: ['Test Card A', 'Test Card B', 'Test Card A', 'Test Card B'] } }), 3, 'draw');
  const topTwo = (s: GameState): string[] => names(s, s.zones.library.p1!.slice(0, 2));
  it('is automated', () => expect(full(LIB)).toBe(true));
  it('may: declined, nothing more is drawn and nothing is chosen', () => {
    const asked: string[] = [];
    const s = settle(setup(), { yes: [false] }, asked);
    expect(s.zones.hand.p1!.length).toBe(2); // the card in hand and the draw step\'s own draw
    expect(asked).toEqual(['yesNo']);
    expect(life(s, 'p1')).toBe(20);
  });
  it('accepted: three cards were drawn this turn; only they (not the card already in hand) can be chosen, exactly two of them', () => {
    let offered: string[] = [];
    let min = -1;
    const s = settle(setup(), { yes: [true, false, false], objects: [(o, st) => { offered = names(st, o); min = (st.pending as { min: number }).min; return o.slice(0, 2); }] });
    expect(offered.sort()).toEqual(['Test Card A', 'Test Card A', 'Test Card B']);
    expect(min).toBe(2);
    expect(s.zones.hand.p1!.length).toBe(1 + 3 - 2); // the old card, three drawn, two put back
    expect(life(s, 'p1')).toBe(20);
  });
  it('pay for the first card, not for the second: 3 life lost and only the unpaid card goes on top', () => {
    const asked: string[] = [];
    const s = settle(setup(), { yes: [true, true, false], objects: [(o) => o.slice(0, 2)] }, asked);
    expect(asked).toEqual(['yesNo', 'chooseObjects', 'order', 'yesNo', 'yesNo']);
    expect(life(s, 'p1')).toBe(17);
    expect(s.zones.library.p1!.length).toBe(24 - 3 + 1);
    expect(s.zones.hand.p1!.length).toBe(1 + 3 - 1);
  });
  it('paying for neither: 6 life lost and the hand keeps all three drawn cards', () => {
    const s = settle(setup(), { yes: [true, true, true], objects: [(o) => o.slice(0, 2)] });
    expect(life(s, 'p1')).toBe(14);
    expect(s.zones.hand.p1!.length).toBe(4);
  });
  it('paying for neither card is not mandatory: declining both payments puts both chosen cards on top of the library (the last one put there is on top)', () => {
    let chosen: string[] = [];
    const s = settle(setup(), { yes: [true, false, false], objects: [(o, st) => { chosen = names(st, o.slice(0, 2)); return o.slice(0, 2); }] });
    expect(life(s, 'p1')).toBe(20);
    expect(s.zones.library.p1!.length).toBe(24 - 3 + 2);
    expect(s.zones.hand.p1!.length).toBe(1 + 3 - 2);
    const top = s.zones.library.p1!.slice(0, 2);
    expect(top.every((id) => s.objects[id]!.zone === 'library')).toBe(true);
    expect(names(s, top).sort()).toEqual([...chosen].sort());
  });
  it('CR 119.4: a player who cannot pay the life is not asked, and the card goes on top of the library (the payment is impossible, CR 118.12)', () => {
    const asked: string[] = [];
    const s0 = setup();
    s0.players.find((p) => p.id === 'p1')!.life = 2;
    const s = settle(s0, { yes: [true, true, true], objects: [(o) => o.slice(0, 2)] }, asked);
    expect(asked.filter((k) => k === 'yesNo').length).toBe(1); // only the "may" of the extra draw
    expect(life(s, 'p1')).toBe(2);
    expect(s.zones.hand.p1!.length).toBe(1 + 3 - 2);
  });
  it('CR 121.1: every card drawn is listed with the id it has in the hand, and the next turn forgets the list', () => {
    let s = setup();
    expect(player(s, 'p1').turnStats.drawn!.length).toBe(1); // the draw step's own draw, before the trigger resolves
    s = settle(s, { yes: [true, false, false], objects: [(o) => o.slice(0, 2)] });
    expect(player(s, 'p1').turnStats.drawn!.length).toBe(3);
    s = advanceTo(s, 4, 'upkeep');
    expect(player(s, 'p1').turnStats.drawn ?? []).toEqual([]);
  });
});

describe('CR 119.3, 106.4: "At the beginning of each of your postcombat main phases, add {R} for each 1 life your opponents have lost this turn."', () => {
  const TITAN = card('Test Ember Titan', 'Creature — Giant', 'At the beginning of each of your postcombat main phases, add {R} for each 1 life your opponents have lost this turn.', { pt: ['3', '3'] });
  const ZAP = card('Test Zap', 'Sorcery', 'Target opponent loses 3 life.');
  const STING = card('Test Sting', 'Sorcery', 'You lose 2 life.');
  const defs = [TITAN, ZAP, STING];
  const run = (...spells: string[]): GameState => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Ember Titan'], hand: spells } });
    for (const n of spells) s = castFree(s, n, { targets: [[{ kind: 'player', id: 'p2' }]] });
    return settle(advanceTo(s, 1, 'main2'));
  };
  it('is automated', () => expect(full(TITAN)).toBe(true));
  it('the life an opponent lost this turn is the red mana added', () => expect(pool(run('Test Zap'), 'p1')).toBe('RRR'));
  it('no life lost: no mana; life you lost yourself does not count', () => {
    expect(pool(run(), 'p1')).toBe('');
    expect(pool(run('Test Sting'), 'p1')).toBe('');
  });
});

describe('CR 701.22a, 121.1: "Target player scries 2, then draws a card."', () => {
  const FORESIGHT = card('Test Foresight', 'Sorcery', 'Target player scries 2, then draws a card.');
  const defs = [FORESIGHT];
  it('is automated', () => expect(full(FORESIGHT)).toBe(true));
  it('the target player (not the caster) scries, then draws one card', () => {
    const asked: string[] = [];
    const s0 = scenario([], { defs, p1: { hand: ['Test Foresight'] } });
    const s = castFree(s0, 'Test Foresight', { targets: [[{ kind: 'player', id: 'p2' }]] }, asked);
    expect(s.zones.hand.p2!.length).toBe(1);
    expect(s.zones.hand.p1!.length).toBe(0);
    expect(asked.filter((k) => k === 'chooseObjects' || k === 'order').length).toBeGreaterThan(0); // the scry decision of p2
  });
  it('the caster as the target draws too', () => {
    const s = castFree(scenario([], { defs, p1: { hand: ['Test Foresight'] } }), 'Test Foresight', { targets: [[{ kind: 'player', id: 'p1' }]] });
    expect(s.zones.hand.p1!.length).toBe(1);
    expect(s.zones.hand.p2!.length).toBe(0);
  });
});

describe('CR 603.7, 704.5f, 613.4c, 109.2: "When ~ enters, each other creature gets -1/-1 until end of turn. Whenever a creature dies this turn, each creature other than ~ gets -1/-1 until end of turn."', () => {
  const REAPER = card('Test Reaper Girl', 'Creature — Human', 'When ~ enters, each other creature gets -1/-1 until end of turn. Whenever a creature dies this turn, each creature other than ~ gets -1/-1 until end of turn.', { pt: ['4', '4'] });
  const mk = (n: string, p: string, t: string) => card(n, 'Creature — Beast', '', { pt: [p, t] });
  const defs = [REAPER, mk('Test Mouse', '1', '1'), mk('Test Bear', '2', '2'), mk('Test Ox', '4', '4')];
  it('is automated', () => expect(full(REAPER)).toBe(true));
  it('every death this turn shrinks everything except the source: it dies down the chain, the source itself is never shrunk', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Reaper Girl'] }, p2: { battlefield: ['Test Mouse', 'Test Bear', 'Test Ox'] } });
    const s = castFree(s0, 'Test Reaper Girl');
    const bf = (n: string): ObjectId[] => findAll(s, n, 'battlefield');
    expect(bf('Test Mouse')).toEqual([]); // died to the enters trigger
    expect(bf('Test Bear')).toEqual([]); // 2/2 -1/-1 (enters) -1/-1 (Mouse died) = 0/0
    expect(pt(s, bf('Test Reaper Girl')[0]!)).toEqual([4, 4]); // never shrunk
    expect(pt(s, bf('Test Ox')[0]!)).toEqual([1, 1]); // -1 (enters), -1 (Mouse), -1 (Bear)
  });
  it('the -1/-1 effects end with the turn (nothing is left on the next one)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Reaper Girl'] }, p2: { battlefield: ['Test Ox', 'Test Mouse'] } });
    let s = castFree(s0, 'Test Reaper Girl');
    s = advanceTo(s, 3, 'main1'); // p1's next turn; p2's turn passed
    expect(pt(s, findAll(s, 'Test Ox', 'battlefield')[0]!)).toEqual([4, 4]);
  });
});

describe('CR 508.1, 603.2, 205.3m, 109.2: "Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it."', () => {
  const HYMN = card('Test Pack Hymn', 'Enchantment', 'Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it.');
  const mk = (n: string, types: string, p: string, t: string) => card(n, `Creature — ${types}`, '', { pt: [p, t] });
  const defs = [HYMN, mk('Test Elf A', 'Elf Warrior', '2', '2'), mk('Test Elf B', 'Elf Druid', '1', '1'), mk('Test Elf C', 'Elf Scout', '1', '1'), mk('Test Gob', 'Goblin Shaman', '3', '3')];
  const attack = (attackers: string[]): GameState => {
    let s = scenario([], { defs, p1: { battlefield: ['Test Pack Hymn', 'Test Elf A', 'Test Elf B', 'Test Elf C', 'Test Gob'] } });
    for (let i = 0; i < 12 && s.pending?.kind !== 'declareAttackers'; i++) s = pass(s);
    const ids = attackers.map((n) => find(s, n, 'battlefield', 'p1'));
    return settle(drive(s, { attackers: ids }), {});
  };
  const power = (s: GameState, n: string): number => pt(s, find(s, n, 'battlefield', 'p1'))[0];
  it('is automated', () => expect(full(HYMN)).toBe(true));
  it('each attacker counts the OTHER attackers that share a creature type with it (two Elves: +1 each; the Goblin shares none: +0)', () => {
    const s = attack(['Test Elf A', 'Test Elf B', 'Test Gob']);
    expect(power(s, 'Test Elf A')).toBe(3);
    expect(power(s, 'Test Elf B')).toBe(2);
    expect(power(s, 'Test Gob')).toBe(3);
  });
  it('a creature that is not attacking is not counted, and an attacker never counts itself', () => {
    const s = attack(['Test Elf A']);
    expect(power(s, 'Test Elf A')).toBe(2); // Elf B and Elf C stay home
  });
  it('three Elves attacking: each gets +2', () => {
    const s = attack(['Test Elf A', 'Test Elf B', 'Test Elf C']);
    expect([power(s, 'Test Elf A'), power(s, 'Test Elf B'), power(s, 'Test Elf C')]).toEqual([4, 3, 3]);
  });
});

describe('CR 601.2a, 603.4, 702.10a: "Whenever a nontoken creature you control enters, if you didn\'t cast it from your hand, it gains haste until your next turn."', () => {
  const WARDEN = card('Test Crypt Warden', 'Creature — Human', "Whenever a nontoken creature you control enters, if you didn't cast it from your hand, it gains haste until your next turn.", { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const RAISE = card('Test Raise', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
  const defs = [WARDEN, BEAR, RAISE];
  const haste = (s: GameState, id: ObjectId): boolean => hasKeyword(getChars(s, id), 'haste');
  it('is automated', () => expect(full(WARDEN)).toBe(true));
  it('a creature cast from the hand does not get haste', () => {
    const s = castFree(scenario([], { defs, p1: { battlefield: ['Test Crypt Warden'], hand: ['Test Bear'] } }), 'Test Bear');
    expect(haste(s, find(s, 'Test Bear', 'battlefield', 'p1'))).toBe(false);
  });
  it('a creature put onto the battlefield from the graveyard gets haste until your next turn', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Crypt Warden'], hand: ['Test Raise'], graveyard: ['Test Bear'] } });
    const s = castFree(s0, 'Test Raise', { targets: [[{ kind: 'object', id: find(s0, 'Test Bear', 'graveyard', 'p1') }]] });
    const bear = find(s, 'Test Bear', 'battlefield', 'p1');
    expect(haste(s, bear)).toBe(true);
    const later = advanceTo(s, 3, 'upkeep'); // until YOUR next turn (p1's turn 3) begins
    expect(haste(later, find(later, 'Test Bear', 'battlefield', 'p1'))).toBe(false);
  });
  it('"you cast it": the caster is you - a creature an opponent cast from their own hand is not one you cast, whichever creature enters (CR 601.2a; the cast record\'s caster)', () => {
    const SEEN = card('Test Watcher', 'Enchantment', 'Whenever a creature enters, if you cast it from your hand, you gain 1 life.');
    const UNSEEN = card('Test Doubter', 'Enchantment', "Whenever a creature enters, if you didn't cast it from your hand, you gain 1 life.");
    const FLASH = card('Test Flash Bear', 'Creature — Bear', 'Flash', { pt: ['2', '2'] });
    const all = [...defs, SEEN, UNSEEN, FLASH];
    const life1 = (watcher: string, caster: 'p1' | 'p2'): number => {
      let s = scenario([], { defs: all, p1: { battlefield: [watcher], hand: caster === 'p1' ? ['Test Bear'] : [] }, p2: { hand: caster === 'p2' ? ['Test Flash Bear'] : [] } });
      if (caster === 'p2') s = pass(s);
      s = settle(drive(act(s, { type: 'cast', player: caster, card: find(s, caster === 'p1' ? 'Test Bear' : 'Test Flash Bear', 'hand', caster) })));
      return life(s, 'p1');
    };
    expect(life1('Test Watcher', 'p1')).toBe(21); // you cast it from your hand
    expect(life1('Test Watcher', 'p2')).toBe(20); // the opponent cast it: not "you cast it"
    expect(life1('Test Doubter', 'p1')).toBe(20);
    expect(life1('Test Doubter', 'p2')).toBe(21); // you did not cast it
  });
  it('a token is not "a nontoken creature": a token that was not cast does not get haste either', () => {
    const MINT = card('Test Mint', 'Sorcery', 'Create a 1/1 white Spirit creature token.');
    const s = castFree(scenario([], { defs: [...defs, MINT], p1: { battlefield: ['Test Crypt Warden'], hand: ['Test Mint'] } }), 'Test Mint');
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    expect(haste(s, token)).toBe(false);
  });
});

describe('CR 611.2c, 613.1f, 702.11b, 702.18a: "{T}: Until end of turn, creatures your opponents control lose hexproof and shroud and can\'t have hexproof or shroud."', () => {
  const WELL = card('Test Veil Well', 'Artifact', '{T}: Until end of turn, creatures your opponents control lose hexproof and shroud and can\'t have hexproof or shroud.');
  const OWL = card('Test Hexed Owl', 'Creature — Bird', 'Hexproof', { pt: ['1', '1'] });
  const MOLE = card('Test Shroud Mole', 'Creature — Mole', 'Shroud', { pt: ['1', '1'] });
  const OTHER = card('Test Hexed Ally', 'Creature — Bird', 'Hexproof', { pt: ['1', '1'] });
  const defs = [WELL, OWL, MOLE, OTHER];
  const keywords = (s: GameState, id: ObjectId): string[] => ['hexproof', 'shroud'].filter((k) => hasKeyword(getChars(s, id), k));
  const run = (): GameState => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Veil Well', 'Test Hexed Ally'] }, p2: { battlefield: ['Test Hexed Owl', 'Test Shroud Mole'] } });
    return settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Veil Well', 'battlefield', 'p1'), ability: 'p:0:0' }));
  };
  it('is automated', () => expect(full(WELL)).toBe(true));
  it('your opponents\' creatures lose hexproof and shroud this turn; yours keep theirs', () => {
    const s = run();
    expect(keywords(s, find(s, 'Test Hexed Owl', 'battlefield', 'p2'))).toEqual([]);
    expect(keywords(s, find(s, 'Test Shroud Mole', 'battlefield', 'p2'))).toEqual([]);
    expect(keywords(s, find(s, 'Test Hexed Ally', 'battlefield', 'p1'))).toEqual(['hexproof']);
  });
  it('"can\'t have": a spell that gives the affected creatures hexproof afterwards gives them none (Scryfall ruling of Arcane Lighthouse, 2014-11-07)', () => {
    const CHARM = card('Test Hex Charm', 'Instant', 'Creatures you control gain hexproof until end of turn.');
    const s0 = scenario([], { defs: [...defs, CHARM], p1: { battlefield: ['Test Veil Well'] }, p2: { battlefield: ['Test Shroud Mole'], hand: ['Test Hex Charm'] } });
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Veil Well', 'battlefield', 'p1'), ability: 'p:0:0' }));
    s = s.pending?.player === 'p1' ? pass(s) : s; // p2 gets priority
    s = settle(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Hex Charm', 'hand', 'p2') })));
    expect(keywords(s, find(s, 'Test Shroud Mole', 'battlefield', 'p2'))).toEqual([]);
  });
  it('control: without the Well the same spell gives hexproof', () => {
    const CHARM = card('Test Hex Charm', 'Instant', 'Creatures you control gain hexproof until end of turn.');
    let s = scenario([], { defs: [...defs, CHARM], p1: {}, p2: { battlefield: ['Test Shroud Mole'], hand: ['Test Hex Charm'] } });
    s = pass(s);
    s = settle(drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Hex Charm', 'hand', 'p2') })));
    expect(keywords(s, find(s, 'Test Shroud Mole', 'battlefield', 'p2'))).toEqual(['hexproof', 'shroud']);
  });
  it('only the creatures your opponents controlled as it resolved: a creature that comes along later keeps its keywords (CR 611.2c; ruling 2014-11-07)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Veil Well'] }, p2: { battlefield: ['Test Hexed Owl'] } });
    let s = settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Veil Well', 'battlefield', 'p1'), ability: 'p:0:0' }));
    // a creature of p2's that did not exist when the ability resolved (put onto the battlefield by the test)
    const late = (put as unknown as (s: GameState, owner: string, zone: string, spec: string) => ObjectId)(s, 'p2', 'battlefield', 'Test Hexed Ally');
    expect(keywords(s, late)).toEqual(['hexproof']);
  });
  it('the effect ends with the turn', () => {
    const s = advanceTo(run(), 2, 'upkeep');
    expect(keywords(s, find(s, 'Test Hexed Owl', 'battlefield', 'p2'))).toEqual(['hexproof']);
  });
});

describe('Scryfall ruling of Sylvan Library (2022-12-08): "If you choose to draw two cards, then replace one or more of those draws with some other effect, the rest of Sylvan Library\'s ability still happens."', () => {
  const LIB = card('Test Whisper Library', 'Enchantment', 'At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 3 life or put the card on top of your library.');
  const THIEF = card('Test Thief', 'Creature — Human Rogue', 'If an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.', { pt: ['1', '1'] });
  const FILL = card('Test Card A', 'Sorcery', '');
  it('both extra draws replaced by an opponent: the one card drawn is still chosen and paid for or put back', () => {
    const s0 = advanceTo(scenario([], { defs: [LIB, THIEF, FILL], p1: { battlefield: ['Test Whisper Library'], library: ['Test Card A', 'Test Card A', 'Test Card A'] }, p2: { battlefield: ['Test Thief'], library: ['Test Card A', 'Test Card A', 'Test Card A', 'Test Card A'] } }), 3, 'draw');
    const paid = settle(s0, { yes: [true, true] });
    expect(life(paid, 'p1')).toBe(17);
    expect(paid.zones.hand.p1!.length).toBe(1);
    const back = settle(s0, { yes: [true, false] });
    expect(life(back, 'p1')).toBe(20);
    expect(back.zones.hand.p1!.length).toBe(0); // put back on top of the library
  });
});

describe('CR 400.2, 121.1: the cards a player drew this turn are not shown to the other players (core/view.ts#blankUnshownIds blanks the ids of hidden hand cards)', () => {
  it('the opponent\'s view of turnStats.drawn holds no id of a card of the hand it can\'t see; the owner\'s own view keeps them', () => {
    const FILL = card('Test Card A', 'Sorcery', '');
    const s = advanceTo(scenario([], { defs: [FILL], p1: { library: ['Test Card A', 'Test Card A'] } }), 3, 'draw');
    expect(player(s, 'p1').turnStats.drawn!.length).toBe(1);
    expect(viewFor(s, 'p1').players.find((p) => p.id === 'p1')!.turnStats.drawn).toEqual(player(s, 'p1').turnStats.drawn);
    expect(viewFor(s, 'p2').players.find((p) => p.id === 'p1')!.turnStats.drawn).toEqual(['']);
  });
});

describe('Scryfall ruling of Sylvan Library (2022-12-08): "If you\'ve actually drawn only one card that turn, you must choose that card ... If you haven\'t actually drawn any cards that turn, the rest of the ability has no effect." (CR 608.2d)', () => {
  const QUILL = card('Test Quill', 'Artifact', '{0}: Draw a card. Choose two cards in your hand drawn this turn. For each of those cards, pay 3 life or put the card on top of your library.');
  const filler = card('Test Card A', 'Sorcery', '');
  const old = card('Test Card C', 'Sorcery', '');
  const defs = [QUILL, filler, old];
  const activate = (s: GameState, script: Script, asked: string[]): GameState => settle(act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Quill', 'battlefield', 'p1'), ability: 'p:0:0' }), script, asked);
  it('is automated', () => expect(full(QUILL)).toBe(true));
  it('one card drawn: it is the only card to choose (taken without asking though two were asked for) and the card already in hand is never one: one payment, not two', () => {
    const asked: string[] = [];
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Quill'], hand: ['Test Card C'], library: ['Test Card A'] } });
    const s = activate(s0, { yes: [true, true] }, asked);
    expect(asked.filter((k) => k === 'yesNo').length).toBe(1);
    expect(life(s, 'p1')).toBe(17);
    expect(s.zones.hand.p1!.length).toBe(2);
  });
  it('declined, the one card goes back on top of the library', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Quill'], hand: ['Test Card C'], library: ['Test Card A'] } });
    const s = activate(s0, { yes: [false], objects: [(o) => o] }, []);
    expect(life(s, 'p1')).toBe(20);
    expect(names(s, s.zones.library.p1!.slice(0, 1))).toEqual(['Test Card A']);
    expect(s.zones.hand.p1!.length).toBe(1);
  });
  it('no card drawn this turn: nothing to choose, nothing to pay (the rest of the ability has no effect)', () => {
    const NOOP = card('Test Quiet Quill', 'Artifact', '{0}: Choose two cards in your hand drawn this turn. For each of those cards, pay 3 life or put the card on top of your library.');
    const asked: string[] = [];
    const s0 = scenario([], { defs: [...defs, NOOP], p1: { battlefield: ['Test Quiet Quill'], hand: ['Test Card C'] } });
    const s = settle(act(s0, { type: 'activate', player: 'p1', source: find(s0, 'Test Quiet Quill', 'battlefield', 'p1'), ability: 'p:0:0' }), { yes: [true] }, asked);
    expect(life(s, 'p1')).toBe(20);
    expect(s.zones.hand.p1!.length).toBe(1);
    expect(asked.includes('yesNo')).toBe(false);
  });
});
