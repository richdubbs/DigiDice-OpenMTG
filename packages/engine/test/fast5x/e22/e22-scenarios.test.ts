/**
 * FAST5X E22: descend and the turn's history (II), played through the engine with synthetic cards compiled by the game's default compiler (the wordings are
 * invented, design 6.10).
 *
 *   CR 700.11    "you descended this turn": a permanent card was put into your graveyard from anywhere this turn; "the number of times you descended this
 *                turn" counts those cards (a token is no card, an instant or sorcery card is no permanent card, CR 110.4a)
 *   CR 207.2c    descend 4 / descend 8 / fathomless descent are ability words: the count of permanent cards in your graveyard
 *   CR 603.4     intervening "if": checked as the end step begins and again as the ability resolves
 *   CR 603.2c    "one or more cards leave your graveyard" triggers once per batch; "a card leaves" once per card
 *   CR 119.9-10  "you gained or lost life this turn" / "you gained and lost life this turn": events of gaining and losing life (not a net change)
 *   CR 701.21a   "you sacrificed one or more permanents this turn ... deals that much damage": the permanents sacrificed this turn
 *   CR 700.2     a condition that changes the number of modes ("If you descended this turn, you may choose both instead")
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type TargetChoice } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, legal, passBoth, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, cost = '{0}', pt?: [string, string]): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], keywords: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: ObjectId[][]; options?: string[][] }
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  const q = { yes: [...(script.yes ?? [])], targets: [...(script.targets ?? [])], objects: [...(script.objects ?? [])], options: [...(script.options ?? [])] };
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority' && s.pending.kind !== 'declareAttackers' && s.pending.kind !== 'declareBlockers'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: q.yes.shift() ?? false });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.targets.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: q.objects.shift() ?? p.options.slice(0, p.min) });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: q.options.shift() ?? ['0'] });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const cast = (s: GameState, name: string, script?: Script, player = 'p1'): GameState => drive(act(s, { type: 'cast', player, card: find(s, name, 'hand', player) }), script);
function resolveAll(s0: GameState, script?: Script): GameState {
  let s = s0;
  for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = drive(passBoth(s), script);
  return s;
}
/** To p1's end step of turn 1, with every "at the beginning of your end step" trigger resolved. */
const endStep = (s: GameState, script?: Script): GameState => resolveAll(drive(advanceTo(s, 1, 'end'), script), script);
const obj = (id: ObjectId): TargetChoice => ({ kind: 'object', id });
const counters = (s: GameState, id: ObjectId): number => s.objects[id]!.counters['+1/+1'] ?? 0;
const hand = (s: GameState, p = 'p1'): number => s.zones.hand[p]!.length;
const lifeOf = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.life;
const pt = (s: GameState, id: ObjectId): number[] => [Number(getChars(s, id)!.power), Number(getChars(s, id)!.toughness)];
const named = (s: GameState, name: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === name);
const descended = (s: GameState, p: string): number => s.players.find((x) => x.id === p)!.turnStats.descended ?? 0;

const BEAR = card('Test Bear', 'Creature — Bear', '', '{0}', ['2', '2']);
const SHOCK = card('Test Shock', 'Instant', 'Test Shock deals 1 damage to any target.');
const MILL1 = card('Test Sift', 'Sorcery', 'Mill a card.');
const MILL3 = card('Test Dredge', 'Sorcery', 'Mill three cards.');
const SWAT = card('Test Swat', 'Instant', 'Destroy target creature.');
const MUSTER = card('Test Muster', 'Sorcery', 'Create a 1/1 white Soldier creature token.');
const OPP_MILL = card('Test Leak', 'Sorcery', 'Target player mills two cards.');
const DELVER = card('Test Delver', 'Creature — Goblin', 'At the beginning of your end step, if you descended this turn, put a +1/+1 counter on this creature.', '{0}', ['1', '1']);
const SPORER = card('Test Sporer', 'Creature — Fungus', 'At the beginning of your end step, create X 1/1 black Fungus creature tokens, where X is the number of times you descended this turn.', '{0}', ['1', '1']);
const COLLAPSE = card('Test Collapse', 'Sorcery', 'Choose one. If you descended this turn, you may choose both instead.\n• You gain 2 life.\n• Draw a card.');
const WAIL = card('Test Wail', 'Sorcery', 'Choose one. If there are three or more permanent cards in your graveyard as you cast this spell, choose one or more instead.\n• You gain 1 life.\n• You gain 2 life.\n• Draw a card.');
const TOWER = card('Test Tower', 'Creature — Fungus', [
  'As long as there are two or more permanent cards in your graveyard, this creature gets +1/+1.',
  "As long as there are four or more permanent cards in your graveyard, this creature gets an additional +2/+2 and can't be blocked by more than one creature.",
].join('\n'), '{0}', ['1', '1']);
const DREAD = card('Test Dread', 'Creature — Horror', 'This creature gets -X/-0, where X is the number of permanent cards in your graveyard.', '{0}', ['5', '5']);
const SEER = card('Test Seer', 'Creature — Bat', 'At the beginning of your end step, if you gained or lost life this turn, draw a card.', '{0}', ['1', '1']);
const MOON = card('Test Moon', 'Enchantment', 'At the beginning of your end step, if you gained and lost life this turn, draw a card.');
const SALVE = card('Test Salve', 'Instant', 'You gain 1 life.');
const PRICK = card('Test Prick', 'Instant', 'You lose 1 life.');
const ARCHIVE = card('Test Archive', 'Enchantment', 'At the beginning of your end step, if a card left your graveyard this turn, draw a card.');
const SCRUB = card('Test Scrub', 'Instant', "Exile target player's graveyard.");
const EXHUME = card('Test Exhume', 'Sorcery', 'Return target creature card from your graveyard to your hand.');
const HUNTER = card('Test Hunter', 'Creature — Human', 'Whenever one or more cards leave your graveyard during your turn, put a +1/+1 counter on this creature.', '{0}', ['2', '2']);
const SKIMMER = card('Test Skimmer', 'Creature — Bird', 'Whenever a card leaves your graveyard during your turn, you gain 1 life.', '{0}', ['1', '1']);
const SKIMMER1 = card('Test Glider', 'Creature — Bird', 'Whenever a card leaves your graveyard during your turn, you gain 1 life. This ability triggers only once each turn.', '{0}', ['1', '1']);
const MODERATOR = card('Test Moderator', 'Creature — Human', 'At the beginning of your end step, if one or more cards were put into exile this turn, put a +1/+1 counter on this creature.', '{0}', ['2', '2']);
const SOVEREIGN = card('Test Sovereign', 'Creature — Werewolf', "At the beginning of your end step, if you didn't cast a spell this turn, put two +1/+1 counters on this creature.", '{0}', ['3', '3']);
const RIPPER = card('Test Ripper', 'Creature — Human', '{0}, Sacrifice another creature: You gain 1 life.\nAt the beginning of your end step, if you sacrificed one or more permanents this turn, this creature deals that much damage to any target.', '{0}', ['2', '2']);
const DEFS = [BEAR, SHOCK, MILL1, MILL3, SWAT, MUSTER, OPP_MILL, DELVER, SPORER, COLLAPSE, WAIL, TOWER, DREAD, SEER, MOON, SALVE, PRICK, ARCHIVE, SCRUB, EXHUME, HUNTER, SKIMMER, SKIMMER1, MODERATOR, SOVEREIGN, RIPPER];

describe('the synthetic cards are automated (FAST5X E22)', () => {
  it('every card plays fully', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
});

describe('CR 700.11: "you descended this turn"', () => {
  it('a creature card milled from your library is a permanent card put into your graveyard: the counter is put (CR 603.4)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Sift'], battlefield: ['Test Delver'], library: ['Test Bear'] } });
    const delver = find(s, 'Test Delver', 'battlefield');
    s = resolveAll(cast(s, 'Test Sift'));
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId)).toContain('Test Bear');
    s = endStep(s);
    expect(counters(s, delver)).toBe(1);
  });

  it('an instant card milled, and the sorcery that milled it, are not permanent cards: no descent (CR 110.4a)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Sift'], battlefield: ['Test Delver'], library: ['Test Shock'] } });
    const delver = find(s, 'Test Delver', 'battlefield');
    s = resolveAll(cast(s, 'Test Sift'));
    expect(s.zones.graveyard['p1']!.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Shock', 'Test Sift']);
    expect(descended(s, 'p1')).toBe(0);
    s = endStep(s);
    expect(counters(s, delver)).toBe(0);
  });

  it('a creature card that dies descends; a token that dies does not (a token is no card)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Muster', 'Test Swat'], battlefield: ['Test Delver'] } });
    const delver = find(s, 'Test Delver', 'battlefield');
    s = resolveAll(cast(s, 'Test Muster'));
    const token = s.zones.battlefield.find((id) => s.objects[id]!.kind === 'token')!;
    s = resolveAll(cast(s, 'Test Swat', { targets: [[obj(token)]] }));
    expect(s.objects[token]).toBeUndefined();
    s = endStep(s);
    expect(counters(s, delver)).toBe(0);

    let t = scenario([], { defs: DEFS, p1: { hand: ['Test Swat'], battlefield: ['Test Delver', 'Test Bear'] } });
    const delver2 = find(t, 'Test Delver', 'battlefield');
    t = resolveAll(cast(t, 'Test Swat', { targets: [[obj(find(t, 'Test Bear', 'battlefield'))]] }));
    t = endStep(t);
    expect(counters(t, delver2)).toBe(1);
  });

  it("cards put into an opponent's graveyard are their descent, not yours (CR 400.3: a card goes to its owner's graveyard)", () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Leak'], battlefield: ['Test Delver'] } });
    const delver = find(s, 'Test Delver', 'battlefield');
    s = resolveAll(cast(s, 'Test Leak', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    expect(s.zones.graveyard['p2']!.length).toBe(2);
    expect(descended(s, 'p2')).toBe(2);
    s = endStep(s);
    expect(counters(s, delver)).toBe(0);
  });

  it('"the number of times you descended this turn" counts each permanent card (three lands milled: three tokens)', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Dredge'], battlefield: ['Test Sporer'] } });
    s = resolveAll(cast(s, 'Test Dredge'));
    s = endStep(s);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token').length).toBe(3);
  });

  it('the count is of this turn: it starts again at 0 when the next turn begins', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Dredge'] } });
    s = resolveAll(cast(s, 'Test Dredge'));
    expect(descended(s, 'p1')).toBe(3);
    s = advanceTo(s, 2, 'upkeep');
    expect(descended(s, 'p1')).toBe(0);
  });
});

describe('CR 700.2, 601.2b: a condition that changes the number of modes', () => {
  it('"If you descended this turn, you may choose both instead": one mode before, one or both after', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Collapse', 'Test Sift'], library: ['Test Bear'] } });
    let t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Collapse', 'hand') });
    expect(t.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 1 });
    s = resolveAll(cast(s, 'Test Sift'));
    t = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Collapse', 'hand') });
    expect(t.pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 2 });
    const h = hand(t);
    t = resolveAll(drive(t, { options: [['0', '1']] }));
    expect(lifeOf(t, 'p1')).toBe(22);
    expect(hand(t)).toBe(h + 1);
  });

  it('"If there are three or more permanent cards in your graveyard as you cast this spell, choose one or more instead" (descend, CR 207.2c)', () => {
    const few = scenario([], { defs: DEFS, p1: { hand: ['Test Wail'], graveyard: ['Test Bear', 'Test Bear', 'Test Shock'] } });
    expect(act(few, { type: 'cast', player: 'p1', card: find(few, 'Test Wail', 'hand') }).pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 1 });
    const many = scenario([], { defs: DEFS, p1: { hand: ['Test Wail'], graveyard: ['Test Bear', 'Test Bear', 'Test Delver'] } });
    expect(act(many, { type: 'cast', player: 'p1', card: find(many, 'Test Wail', 'hand') }).pending).toMatchObject({ kind: 'chooseOption', min: 1, max: 3 });
  });
});

describe('CR 207.2c, 611.3a: descend 4 / descend 8 and fathomless descent statics', () => {
  it('"gets +1/+1" at two permanent cards, "an additional +2/+2" at four (an instant card does not count)', () => {
    const two = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tower'], graveyard: ['Test Bear', 'Test Bear', 'Test Shock', 'Test Shock'] } });
    expect(pt(two, find(two, 'Test Tower', 'battlefield'))).toEqual([2, 2]);
    const four = scenario([], { defs: DEFS, p1: { battlefield: ['Test Tower'], graveyard: ['Test Bear', 'Test Bear', 'Test Delver', 'Test Sporer'] } });
    expect(pt(four, find(four, 'Test Tower', 'battlefield'))).toEqual([4, 4]);
  });

  it('"gets -X/-0, where X is the number of permanent cards in your graveyard"', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Dread'], graveyard: ['Test Bear', 'Test Bear', 'Test Shock'] } });
    expect(pt(s, find(s, 'Test Dread', 'battlefield'))).toEqual([3, 5]);
  });
});

describe('CR 119.9, 119.10, 603.4: "you gained or lost life" / "you gained and lost life" this turn', () => {
  it('nothing happened: no draw; a gain alone draws for "or" but not for "and"; both draw for both', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Seer', 'Test Moon'] } });
    const h0 = hand(s);
    s = endStep(s);
    expect(hand(s)).toBe(h0);

    let g = scenario([], { defs: DEFS, p1: { hand: ['Test Salve'], battlefield: ['Test Seer', 'Test Moon'] } });
    g = resolveAll(cast(g, 'Test Salve'));
    const hg = hand(g);
    g = endStep(g);
    expect(hand(g)).toBe(hg + 1);

    let b = scenario([], { defs: DEFS, p1: { hand: ['Test Salve', 'Test Prick'], battlefield: ['Test Seer', 'Test Moon'] } });
    b = resolveAll(cast(b, 'Test Salve'));
    b = resolveAll(cast(b, 'Test Prick'));
    expect(lifeOf(b, 'p1')).toBe(20); // a net change of 0 is still a gain and a loss (not a net total)
    const hb = hand(b);
    b = endStep(b);
    expect(hand(b)).toBe(hb + 2);
  });
});

describe('CR 603.2c, 603.10a, 400.3: cards leaving your graveyard', () => {
  it('"if a card left your graveyard this turn": a card returned to your hand counts', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Exhume'], battlefield: ['Test Archive'], graveyard: ['Test Bear'] } });
    s = resolveAll(cast(s, 'Test Exhume', { targets: [[obj(find(s, 'Test Bear', 'graveyard'))]] }));
    const h = hand(s);
    s = endStep(s);
    expect(hand(s)).toBe(h + 1);
    let n = scenario([], { defs: DEFS, p1: { battlefield: ['Test Archive'], graveyard: ['Test Bear'] } });
    const hn = hand(n);
    n = endStep(n);
    expect(hand(n)).toBe(hn);
  });

  it('"one or more cards leave" triggers once for the batch; "a card leaves" once per card; "only once each turn" once', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Scrub'], battlefield: ['Test Hunter', 'Test Skimmer', 'Test Glider'], graveyard: ['Test Bear', 'Test Bear', 'Test Shock'] } });
    const hunter = find(s, 'Test Hunter', 'battlefield');
    s = resolveAll(cast(s, 'Test Scrub', { targets: [[{ kind: 'player', id: 'p1' }]] }));
    expect(s.zones.graveyard['p1']!.length).toBe(1); // only the instant that exiled them
    expect(counters(s, hunter)).toBe(1);
    expect(lifeOf(s, 'p1')).toBe(20 + 3 + 1);
  });

  it("during an opponent's turn the graveyard triggers do not trigger (CR 500.1)", () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Hunter'], graveyard: ['Test Bear'] }, p2: { hand: ['Test Scrub'] } });
    const hunter = find(s, 'Test Hunter', 'battlefield');
    s = advanceTo(s, 2, 'main1');
    s = resolveAll(cast(s, 'Test Scrub', { targets: [[{ kind: 'player', id: 'p1' }]] }, 'p2'));
    expect(s.zones.graveyard['p1']!.length).toBe(0);
    expect(counters(s, hunter)).toBe(0);
  });
});

describe('CR 406, 603.4: "if one or more cards were put into exile this turn"', () => {
  it('cards of any graveyard put into exile count; nothing exiled, no counter', () => {
    let s = scenario([], { defs: DEFS, p1: { hand: ['Test Scrub'], battlefield: ['Test Moderator'] }, p2: { graveyard: ['Test Bear'] } });
    const mod = find(s, 'Test Moderator', 'battlefield');
    s = resolveAll(cast(s, 'Test Scrub', { targets: [[{ kind: 'player', id: 'p2' }]] }));
    s = endStep(s);
    expect(counters(s, mod)).toBe(1);
    let n = scenario([], { defs: DEFS, p1: { battlefield: ['Test Moderator'] } });
    n = endStep(n);
    expect(counters(n, find(n, 'Test Moderator', 'battlefield'))).toBe(0);
  });
});

describe('CR 601.2i, 603.4: "if you didn\'t cast a spell this turn"', () => {
  it('no spell cast: two counters; a spell cast: none', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Sovereign'] } });
    s = endStep(s);
    expect(counters(s, find(s, 'Test Sovereign', 'battlefield'))).toBe(2);
    let c = scenario([], { defs: DEFS, p1: { hand: ['Test Salve'], battlefield: ['Test Sovereign'] } });
    c = resolveAll(cast(c, 'Test Salve'));
    c = endStep(c);
    expect(counters(c, find(c, 'Test Sovereign', 'battlefield'))).toBe(0);
  });
});

describe('CR 701.21a, 603.4: "if you sacrificed one or more permanents this turn, ... deals that much damage"', () => {
  it('two creatures sacrificed (as a cost, CR 118.3): 2 damage to the target; none sacrificed: no trigger', () => {
    let s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ripper', 'Test Bear', 'Test Delver'] } });
    const ripper = find(s, 'Test Ripper', 'battlefield');
    for (const victim of [find(s, 'Test Bear', 'battlefield'), find(s, 'Test Delver', 'battlefield')]) {
      const la = legal(s, 'p1', 'activate').filter((a) => a.object === ripper && !a.isMana)[0]!;
      s = resolveAll(drive(act(s, la.action), { objects: [[victim]] }));
    }
    expect(named(s, 'Test Bear')).toEqual([]);
    expect(lifeOf(s, 'p1')).toBe(22);
    s = endStep(s, { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(lifeOf(s, 'p2')).toBe(18);
    let n = scenario([], { defs: DEFS, p1: { battlefield: ['Test Ripper'] } });
    n = endStep(n, { targets: [[{ kind: 'player', id: 'p2' }]] });
    expect(lifeOf(n, 'p2')).toBe(20);
  });
});
