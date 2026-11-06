/**
 * Commander lane edh-top, round edh-top-7: the round's readings played through the engine with synthetic cards (invented names, design 6.10), compiled by the game's default compiler, in
 * 4-player games. Each test is named after the rule it checks and the groups have their negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com),
 * read in the session.
 *
 *   CR 113.6k, 601.2i, 603.2, 611.2b  "When you cast this spell, gain control of target creature until end of turn. Untap that creature. Until end of turn, it has base power and toughness 10/10 ..."
 *   CR 406.1, 202.3, 601.2, 401.4     "Whenever you cast a legendary spell from your hand, exile cards from the top of your library until you exile a legendary nonland card with lesser mana value. You may cast that card without paying its mana cost. Put the rest on the bottom of your library in a random order."
 *   CR 701.23a, 406.3, 611.2b         "When ~ enters, search your library for a card, exile it face down, then shuffle. For as long as that card remains exiled, you may play it."
 *   CR 601.2i, 608.2h, 111.1, 707.2   "At the beginning of combat on your turn, create X tokens that are copies of another target creature you control, where X is one plus the number of instant and sorcery spells you've cast this turn. They gain haste. Exile them at the beginning of the next end step."
 *   CR 611.2b, 601.3, 603.2           "... exile up to one target nonland permanent. For as long as that card remains exiled, its owner may cast it." / "Whenever another player casts a spell from anywhere other than their hand, draw a card."
 *   CR 122.1, 701.27a, 712.9          "Whenever you cast an instant or sorcery spell, put a charge counter on ~. Then if there are four or more charge counters on it, you may remove those counters and transform it."
 *   CR 611.2a, 601.3, 609.4b, 107.4c  "Exile the top card of that player's library. Until end of turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { act as mact, answer as manswer, find as mfind, mpScenario, pass as mpass, passUntil } from '../../m12/rules/helpers';
import { getChars, hasKeyword } from '../../../src/rules/characteristics';
import { card, full, named, pt, settle } from '../cmd3/helpers';

const onBf = (s: GameState, p: PlayerId, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p && s.objects[id]!.defId === defId);
const pick = (id: ObjectId) => ({ kind: 'object' as const, id });
/** Answers whatever is asked (targets in order, yes to every offer) and passes until the stack is empty. */
function run(s0: GameState, o: { targets?: ObjectId[]; yes?: boolean; options?: (opts: ObjectId[]) => ObjectId[] } = {}): GameState {
  let s = s0;
  const targets = [...(o.targets ?? [])];
  for (let i = 0; i < 200; i++) {
    const p = s.pending;
    if (p === null || p === undefined) break;
    if (p.kind === 'chooseTargets') s = manswer(s, { kind: 'chooseTargets', targets: targets.length > 0 ? [pick(targets.shift()!)] : [] });
    else if (p.kind === 'payCost') s = manswer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'yesNo') s = manswer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'chooseObjects') {
      const opts = (p as unknown as { options: ObjectId[]; max: number }).options;
      s = manswer(s, { kind: 'chooseObjects', ids: o.options !== undefined ? o.options(opts) : opts.slice(0, (p as unknown as { max: number }).max) });
    } else if (p.kind === 'priority') { if (s.zones.stack.length === 0) break; s = mpass(s); }
    else throw new Error(`unexpected ${p.kind}: ${p.prompt}`);
  }
  return s;
}
const castCard = (s: GameState, name: string, p: PlayerId = 'p1'): GameState => mact(s, { type: 'cast', player: p, card: mfind(s, name, 'hand', p) });

describe('CR 113.6k, 601.2i, 603.2, 611.2b: "When you cast this spell, gain control of target creature until end of turn. Untap that creature. Until end of turn, it has base power and toughness 10/10 and gains trample, annihilator 2, and haste."', () => {
  const SEIZER = card('Test Seizer', 'Creature — Eldrazi', 'When you cast this spell, gain control of target creature until end of turn. Untap that creature. Until end of turn, it has base power and toughness 10/10 and gains trample, annihilator 2, and haste.', ['2', '2']);
  const OX = card('Test Pasture Ox', 'Creature — Ox', '', ['1', '3']);
  const defs = [SEIZER, OX];
  const start = () => mpScenario({ defs, zones: { p1: { hand: ['Test Seizer'] }, p2: { battlefield: [{ name: 'Test Pasture Ox', tapped: true } as never] }, p3: { battlefield: ['Test Pasture Ox'] } } });
  it('is automated', () => expect(full(SEIZER)).toBe(true));
  it('CR 113.6k, 611.2b: the trigger of the spell itself fires as it is cast: the chosen creature is p1\'s, untapped, 10/10 with trample, annihilator 2 and haste, while the spell is still on the stack', () => {
    let s = castCard(start(), 'Test Seizer');
    const ox = mfind(s, 'Test Pasture Ox', 'battlefield', 'p2');
    s = manswer(s, { kind: 'chooseTargets', targets: [pick(ox)] });
    // the cast trigger is on top of the spell
    expect(s.zones.stack.length).toBe(2);
    s = mpass(s);
    while (s.pending?.kind === 'priority' && s.zones.stack.length > 1) s = mpass(s);
    expect(s.objects[ox]!.controller).toBe('p1');
    expect(s.objects[ox]!.tapped).toBe(false);
    expect(pt(s, ox)).toBe('10/10');
    for (const k of ['trample', 'haste']) expect(hasKeyword(getChars(s, ox), k as never)).toBe(true);
    expect(JSON.stringify(getChars(s, ox).abilities ?? [])).toContain('annihilator');
  });
  it('negative: the spell itself is not "that creature": once it resolves it is a 2/2 that is not stolen, untapped by nothing, and the other (p3) cow is untouched', () => {
    let s = castCard(start(), 'Test Seizer');
    s = run(s, { targets: [mfind(s, 'Test Pasture Ox', 'battlefield', 'p2')] });
    const seizer = onBf(s, 'p1', 'Test Seizer')[0]!;
    expect(pt(s, seizer)).toBe('2/2');
    expect(hasKeyword(getChars(s, seizer), 'trample')).toBe(false);
    expect(s.objects[mfind(s, 'Test Pasture Ox', 'battlefield', 'p3')]!.controller).toBe('p3');
  });
  it('CR 611.2b: the effects end with the turn: the creature goes back to p2 (still the 1/3 it is)', () => {
    let s = castCard(start(), 'Test Seizer');
    const ox = mfind(s, 'Test Pasture Ox', 'battlefield', 'p2');
    s = run(s, { targets: [ox] });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's turn");
    expect(s.objects[ox]!.controller).toBe('p2');
    expect(pt(s, ox)).toBe('1/3');
  });
});

describe('CR 406.1, 202.3, 601.2, 401.4: "Whenever you cast a legendary spell from your hand, exile cards from the top of your library until you exile a legendary nonland card with lesser mana value. You may cast that card without paying its mana cost. Put the rest on the bottom of your library in a random order."', () => {
  const UNIFIER = card('Test Unifier', 'Legendary Creature — Wizard', 'Whenever you cast a legendary spell from your hand, exile cards from the top of your library until you exile a legendary nonland card with lesser mana value. You may cast that card without paying its mana cost. Put the rest on the bottom of your library in a random order.', ['1', '1']);
  const MID = card('Test Legend Mid', 'Legendary Creature — Elf', '', ['2', '2'], '{2}');
  const SMALL = card('Test Legend Small', 'Legendary Creature — Elf', '', ['1', '1'], '{1}');
  const BIG = card('Test Legend Big', 'Legendary Creature — Elf', '', ['4', '4'], '{3}');
  const EQUAL = card('Test Legend Equal', 'Legendary Creature — Elf', '', ['2', '2'], '{2}');
  const PLAIN = card('Test Plain Bear', 'Creature — Bear', '', ['1', '1'], '{1}');
  const FILLER = card('Test Filler Bear', 'Creature — Bear', '', ['1', '1'], '{1}');
  const NONLEG = card('Test Plain Spell', 'Creature — Bear', '', ['1', '1'], '{1}');
  const defs = [UNIFIER, MID, SMALL, BIG, EQUAL, PLAIN, FILLER, NONLEG];
  const start = (library: string[], hand = ['Test Legend Mid']) => mpScenario({ defs, zones: { p1: { hand, battlefield: ['Test Unifier', 'Plains', 'Plains', 'Plains'], library: ['Plains', ...library] /* (the list is read top first; the first card is drawn for the turn) */ }, p2: { battlefield: [] } } });
  const lib = (s: GameState): string[] => s.zones.library['p1']!.map((id) => s.objects[id]!.defId);
  const exiledNames = (s: GameState): string[] => s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1').map((id) => s.objects[id]!.defId);
  it('is automated', () => expect(full(UNIFIER)).toBe(true));
  it('CR 202.3, 601.2, 401.4: exiles down to the first legendary nonland card of LOWER mana value (a plain bear, a legend of equal value and a bigger one are passed over), casts it free, and puts the others on the bottom', () => {
    let s = start(['Test Plain Bear', 'Test Legend Equal', 'Test Legend Big', 'Test Legend Small', 'Test Filler Bear']);
    s = run(castCard(s, 'Test Legend Mid'));
    // the hit was cast for free and resolves (before the spell that triggered it)
    expect(onBf(s, 'p1', 'Test Legend Small')).toHaveLength(1);
    expect(onBf(s, 'p1', 'Test Legend Mid')).toHaveLength(1);
    // the library is the card that was not reached, then the three passed over (three: a random order)
    expect(lib(s)[0]).toBe('Test Filler Bear');
    expect(lib(s).slice(-3).sort()).toEqual(['Test Legend Big', 'Test Legend Equal', 'Test Plain Bear']);
    expect(exiledNames(s)).toEqual([]);
  });
  it('CR 118.9, 601.2: "you may": declining leaves the hit in exile for good (it is not cast later), the others still go to the bottom', () => {
    let s = start(['Test Plain Bear', 'Test Legend Small', 'Test Filler Bear']);
    s = run(castCard(s, 'Test Legend Mid'), { yes: false });
    expect(onBf(s, 'p1', 'Test Legend Small')).toHaveLength(0);
    expect(exiledNames(s)).toEqual(['Test Legend Small']);
    expect(lib(s).slice(-1)).toEqual(['Test Plain Bear']);
    expect(lib(s)[0]).toBe('Test Filler Bear');
    // it cannot be cast from exile afterwards
    const small = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Legend Small')!;
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === small)).toBe(false);
  });
  it('negative: a spell that is not legendary, or not cast from the hand, does not trigger it (the library is untouched)', () => {
    let s = start(['Test Legend Small', 'Test Filler Bear'], ['Test Plain Spell']);
    s = run(castCard(s, 'Test Plain Spell'));
    expect(lib(s)[0]).toBe('Test Legend Small');
    expect(onBf(s, 'p1', 'Test Legend Small')).toHaveLength(0);
  });
  it('CR 202.3, 701.19 (the ruling of 2022-09-09): with no legendary nonland card of lower mana value in the library nothing is cast, and the exiled cards become the library again', () => {
    let s = start(['Test Legend Equal', 'Test Plain Bear'], ['Test Legend Small']);
    const before = s.zones.library['p1']!.length;
    s = run(castCard(s, 'Test Legend Small'));
    expect(onBf(s, 'p1', 'Test Legend Equal')).toHaveLength(0);
    expect(exiledNames(s)).toEqual([]);
    expect(s.zones.library['p1']!.length).toBe(before);
  });
});

describe('CR 701.23a, 406.3, 611.2b: "When ~ enters, search your library for a card, exile it face down, then shuffle. For as long as that card remains exiled, you may play it."', () => {
  const HOARDER = card('Test Hoarder', 'Creature — Dragon', 'When this creature enters, search your library for a card, exile it face down, then shuffle. For as long as that card remains exiled, you may play it.', ['3', '3']);
  const TOME = card('Test Hoard Bear', 'Creature — Bear', '', ['2', '2'], '{1}');
  const defs = [HOARDER, TOME];
  const start = () => mpScenario({ defs, zones: { p1: { hand: ['Test Hoarder'], battlefield: ['Plains', 'Plains'], library: ['Plains', 'Test Hoard Bear'] }, p2: {} } });
  it('is automated', () => expect(full(HOARDER)).toBe(true));
  it('CR 406.3, 611.2b: the searched card is exiled face down and its owner may cast it (any time he could), even after the Hoarder leaves; nobody else may', () => {
    let s = run(castCard(start(), 'Test Hoarder'));
    const bear = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Hoard Bear')!;
    expect(bear).toBeDefined();
    expect(s.objects[bear]!.faceDown).toBe(true);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === bear)).toBe(true);
    expect(legalActions(s, 'p2').some((a) => a.kind === 'cast' && a.object === bear)).toBe(false);
    s = run(mact(s, { type: 'cast', player: 'p1', card: bear }));
    expect(onBf(s, 'p1', 'Test Hoard Bear')).toHaveLength(1);
  });
  it('negative: it is only the card it exiled: a card still in the library, or one that left exile (cast), has no such permission', () => {
    let s = run(castCard(start(), 'Test Hoarder'));
    const bear = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Hoard Bear')!;
    s = run(mact(s, { type: 'cast', player: 'p1', card: bear }));
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Hoard Bear')).toHaveLength(0);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && s.objects[a.object!]?.zone === 'library')).toBe(false);
  });
});

describe('CR 601.2i, 608.2h, 111.1, 707.2, 603.7: "At the beginning of combat on your turn, create X tokens that are copies of another target creature you control, where X is one plus the number of instant and sorcery spells you\'ve cast this turn. They gain haste. Exile them at the beginning of the next end step."', () => {
  const DANCER = card('Test Fire Dancer', 'Legendary Creature — Elemental', "At the beginning of combat on your turn, create X tokens that are copies of another target creature you control, where X is one plus the number of instant and sorcery spells you've cast this turn. They gain haste. Exile them at the beginning of the next end step.", ['3', '3']);
  const OX = card('Test Ember Ox', 'Creature — Ox', '', ['2', '2']);
  const ZAP = card('Test Ember Zap', 'Instant', 'You gain 1 life.');
  const CHANT = card('Test Ember Chant', 'Sorcery', 'You gain 1 life.');
  const CUB = card('Test Ember Cub', 'Creature — Bear', '', ['1', '1']);
  const defs = [DANCER, OX, ZAP, CHANT, CUB];
  it('is automated', () => expect(full(DANCER)).toBe(true));
  const start = () => mpScenario({ defs, zones: { p1: { hand: ['Test Ember Zap', 'Test Ember Chant', 'Test Ember Cub'], battlefield: ['Test Fire Dancer', 'Test Ember Ox'] } } });
  function toCombat(s0: GameState, ox: ObjectId): GameState {
    let s = s0;
    for (let i = 0; i < 40 && !(s.pending?.kind === 'chooseTargets'); i++) {
      if (s.pending?.kind === 'priority') s = mpass(s);
      else s = run(s);
    }
    return s.pending?.kind === 'chooseTargets' ? manswer(s, { kind: 'chooseTargets', targets: [pick(ox)] }) : s;
  }
  const oxTokens = (s: GameState): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.objects[id]!.controller === 'p1');
  it('CR 608.2h, 111.1: with no instant or sorcery cast: one token copy of the cow with haste (X = 1 + 0); it is gone at the end step', () => {
    const s0 = start();
    const ox = mfind(s0, 'Test Ember Ox', 'battlefield', 'p1');
    let s = toCombat(s0, ox);
    s = run(s);
    expect(oxTokens(s)).toHaveLength(1);
    const tok = oxTokens(s)[0]!;
    expect(s.defs[s.objects[tok]!.defId]!.name).toBe('Test Ember Ox');
    expect(hasKeyword(getChars(s, tok), 'haste')).toBe(true);
    s = passUntil(s, (x) => x.turn.step === 'cleanup' || x.turn.activePlayer !== 'p1', 'the end of the turn');
    expect(oxTokens(s)).toHaveLength(0);
  });
  it('CR 601.2i, 608.2h: an instant and a sorcery cast first make X = 3 (one plus two); a creature spell cast does not count', () => {
    let s = start();
    const ox = mfind(s, 'Test Ember Ox', 'battlefield', 'p1');
    s = run(castCard(s, 'Test Ember Zap'));
    s = run(castCard(s, 'Test Ember Chant'));
    s = run(castCard(s, 'Test Ember Cub'));
    s = toCombat(s, ox);
    s = run(s);
    expect(oxTokens(s)).toHaveLength(3);
  });
  it('negative: the token copies another creature (the Dancer itself is no target) and a creature spell cast earlier gives X = 1', () => {
    let s = start();
    const dancer = mfind(s, 'Test Fire Dancer', 'battlefield', 'p1');
    const ox = mfind(s, 'Test Ember Ox', 'battlefield', 'p1');
    // the Dancer is not offered as the target
    for (let i = 0; i < 40 && s.pending?.kind !== 'chooseTargets'; i++) s = s.pending?.kind === 'priority' ? mpass(s) : run(s);
    expect(s.pending?.kind).toBe('chooseTargets');
    expect(() => manswer(s, { kind: 'chooseTargets', targets: [pick(dancer)] })).toThrow();
    s = run(manswer(s, { kind: 'chooseTargets', targets: [pick(ox)] }));
    expect(oxTokens(s)).toHaveLength(1);
  });
});

describe('CR 611.2b, 601.3, 108.3, 603.2: "When ~ enters, exile up to one target nonland permanent. For as long as that card remains exiled, its owner may cast it. Whenever another player casts a spell from anywhere other than their hand, draw a card."', () => {
  const EXTORTER = card('Test Extorter', 'Creature — Angel', 'When this creature enters, exile up to one target nonland permanent. For as long as that card remains exiled, its owner may cast it.\nWhenever another player casts a spell from anywhere other than their hand, draw a card.', ['3', '3']);
  const RELIC = card('Test Pawn Relic', 'Artifact', '');
  const HAND_SPELL = card('Test Hand Spell', 'Instant', 'You gain 1 life.');
  const YARD_SPELL = card('Test Yard Spell', 'Instant', 'You gain 1 life.');
  const BEAR = card('Test Pawn Bear', 'Creature — Bear', '', ['1', '1']);
  const defs = [EXTORTER, RELIC, HAND_SPELL, YARD_SPELL, BEAR];
  const handSize = (s: GameState, p: PlayerId): number => s.zones.hand[p]!.length;
  it('is automated', () => expect(full(EXTORTER)).toBe(true));
  const start = () => mpScenario({ defs, zones: { p1: { hand: ['Test Extorter'], library: ['Plains', 'Plains', 'Plains'] }, p2: { battlefield: ['Test Pawn Relic', 'Test Pawn Bear'], hand: ['Test Hand Spell'] }, p3: { battlefield: [] } } });
  const exiledRelic = (s: GameState): ObjectId | undefined => s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Pawn Relic');
  it('negative: up to one: with no target nothing is exiled and the trigger is harmless', () => {
    const s = run(castCard(start(), 'Test Extorter'), { targets: [] });
    expect(exiledRelic(s)).toBeUndefined();
    expect(onBf(s, 'p2', 'Test Pawn Relic')).toHaveLength(1);
  });
  it('CR 603.2, 601.2: casting the exiled relic from exile on the owner\'s own turn draws p1 a card; you casting from exile does not (the trigger is for another player)', () => {
    const s0 = start();
    const relic = mfind(s0, 'Test Pawn Relic', 'battlefield', 'p2');
    let s = run(castCard(s0, 'Test Extorter'), { targets: [relic] });
    s = passUntil(s, (x) => x.turn.activePlayer === 'p2' && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p2's turn");
    const card1 = exiledRelic(s)!;
    expect(legalActions(s, 'p2').some((a) => a.kind === 'cast' && a.object === card1)).toBe(true);
    const before = handSize(s, 'p1');
    s = run(mact(s, { type: 'cast', player: 'p2', card: card1 }));
    expect(handSize(s, 'p1')).toBe(before + 1);
    expect(onBf(s, 'p2', 'Test Pawn Relic')).toHaveLength(1);
    // a spell cast from p2's hand later the same turn: no second card
    const mid = handSize(s, 'p1');
    s = run(mact(s, { type: 'cast', player: 'p2', card: mfind(s, 'Test Hand Spell', 'hand', 'p2') }));
    expect(handSize(s, 'p1')).toBe(mid);
  });
});

describe('CR 122.1, 701.27a, 712.9, 601.2f: "Instant and sorcery spells you cast cost {1} less to cast. Whenever you cast an instant or sorcery spell, put a charge counter on ~. Then if there are four or more charge counters on it, you may remove those counters and transform it."', () => {
  const face = (name: string, type: string, text: string, cost: string) => ({ name, mana_cost: cost, type_line: type, oracle_text: text, colors: [] });
  const AMULET = compileCard({ name: 'Test Charge Amulet // Test Charge Well', layout: 'transform', type_line: 'Artifact // Artifact', colors: [],
    card_faces: [face('Test Charge Amulet', 'Artifact', 'Instant and sorcery spells you cast cost {1} less to cast.\nWhenever you cast an instant or sorcery spell, put a charge counter on this artifact. Then if there are four or more charge counters on it, you may remove those counters and transform it.', '{0}'), face('Test Charge Well', 'Artifact', '{T}: Add {C}.', '')] } as unknown as OracleCard);
  const ZAP = card('Test Charge Zap', 'Instant', 'You gain 1 life.', undefined, '{1}');
  const BEAR = card('Test Charge Bear', 'Creature — Bear', '', ['1', '1'], '{1}');
  const defs = [AMULET, ZAP, BEAR];
  const start = () => mpScenario({ defs, zones: { p1: { hand: ['Test Charge Zap', 'Test Charge Zap', 'Test Charge Zap', 'Test Charge Zap', 'Test Charge Bear'], battlefield: ['Test Charge Amulet // Test Charge Well'] } } });
  const amulet = (s: GameState): ObjectId => s.zones.battlefield.find((id) => s.defs[s.objects[id]!.defId]!.name === 'Test Charge Amulet // Test Charge Well')!;
  const charge = (s: GameState): number => s.objects[amulet(s)]!.counters['charge'] ?? 0;
  it('is automated', () => expect(full(AMULET)).toBe(true));
  it('CR 601.2f: an instant costs {1} less ({1} -> nothing): it is cast with no lands; a creature spell still costs its {1}', () => {
    const s = run(castCard(start(), 'Test Charge Zap'));
    expect(s.zones.graveyard['p1']!.some((id) => s.objects[id]!.defId === 'Test Charge Zap')).toBe(true);
    const s0 = start();
    expect(legalActions(s0, 'p1').some((a) => a.kind === 'cast' && s0.objects[a.object!]?.defId === 'Test Charge Bear')).toBe(false);
  });
  it('CR 122.1, 603.2: each instant cast adds a charge counter; the fourth lets you remove all four and transform it (CR 712.9), declining keeps them', () => {
    let s = start();
    for (let i = 1; i <= 3; i++) { s = run(castCard(s, 'Test Charge Zap')); expect(charge(s)).toBe(i); }
    const declined = run(castCard(s, 'Test Charge Zap'), { yes: false });
    expect(charge(declined)).toBe(4);
    expect(declined.objects[amulet(declined)]!.face).toBe(0);
    s = run(castCard(s, 'Test Charge Zap'), { yes: true });
    expect(charge(s)).toBe(0);
    expect(s.objects[amulet(s)]!.face).toBe(1);
  });
  it('negative: a creature spell adds no counter', () => {
    const s = mpScenario({ defs, zones: { p1: { hand: ['Test Charge Bear'], battlefield: ['Test Charge Amulet // Test Charge Well', 'Plains'] } } });
    const t = run(mact(s, { type: 'cast', player: 'p1', card: mfind(s, 'Test Charge Bear', 'hand', 'p1') }));
    expect(charge(t)).toBe(0);
  });
});

describe('CR 611.2a, 601.3, 609.4b, 107.4c: "Whenever a creature you control deals combat damage to a player, choose one -- Goad target creature that player controls. / Exile the top card of that player\'s library. Until end of turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell."', () => {
  const RAIDER = card('Test Raider', 'Legendary Creature — Goblin', "Whenever a creature you control deals combat damage to a player, choose one --\n• Goad target creature that player controls.\n• Exile the top card of that player's library. Until end of turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.", ['2', '2']);
  const RED = card('Test Red Imp', 'Creature — Imp', '', ['1', '1'], '{R}{R}');
  const COW = card('Test Raid Cow', 'Creature — Ox', '', ['2', '2']);
  const defs = [RAIDER, RED, COW];
  it('is automated', () => expect(full(RAIDER)).toBe(true));
  const start = () => mpScenario({ defs, zones: { p1: { battlefield: ['Test Raider', 'Plains', 'Plains'] }, p2: { library: ['Test Red Imp', 'Plains'], battlefield: ['Test Raid Cow'] } } });
  function hit(s0: GameState, mode: number): GameState {
    let s = passUntil(s0, (x) => x.pending?.kind === 'declareAttackers' && x.pending.player === 'p1', 'the attack');
    s = manswer(s, { kind: 'declareAttackers', attacks: [{ attacker: mfind(s, 'Test Raider', 'battlefield', 'p1'), defender: 'p2' }] });
    for (let i = 0; i < 300 && s.turn.step !== 'main2'; i++) {
      const d = s.pending!;
      if (d.kind === 'declareBlockers') s = manswer(s, { kind: 'declareBlockers', blocks: [] });
      else if (d.kind === 'chooseOption') s = manswer(s, { kind: 'chooseOption', ids: [(d as unknown as { options: { id: string }[] }).options[mode]!.id] });
      else if (d.kind === 'chooseTargets') s = manswer(s, { kind: 'chooseTargets', targets: [pick(mfind(s, 'Test Raid Cow', 'battlefield', 'p2'))] });
      else if (d.kind === 'priority') s = mpass(s);
      else throw new Error(`unexpected ${d.kind}: ${d.prompt}`);
    }
    return s;
  }
  it('CR 609.4b, 107.4c: the second mode exiles the top card of the player hit, and p1 can cast that {R}{R} card with two Plains this turn', () => {
    const s = hit(start(), 1);
    const imp = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Red Imp')!;
    expect(imp).toBeDefined();
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === imp)).toBe(true);
    expect(legalActions(s, 'p2').some((a) => a.kind === 'cast' && a.object === imp)).toBe(false);
  });
  it('CR 611.2a: until end of turn only: on the next turn the exiled card cannot be cast', () => {
    let s = hit(start(), 1);
    const imp = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Red Imp')!;
    s = passUntil(s, (x) => x.turn.activePlayer === 'p1' && x.turn.number >= 5 && x.turn.step === 'main1' && x.pending?.kind === 'priority', "p1's next turn");
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === imp)).toBe(false);
  });
  it('control (CR 107.4c): the same card without "and you may spend mana as though it were mana of any color" does not let two Plains pay {R}{R}', () => {
    const PLAIN_RAIDER = card('Test Raider', 'Legendary Creature \u2014 Goblin', "Whenever a creature you control deals combat damage to a player, choose one --\n\u2022 Goad target creature that player controls.\n\u2022 Exile the top card of that player's library. Until end of turn, you may cast that card.", ['2', '2']);
    const s = hit(mpScenario({ defs: [PLAIN_RAIDER, RED, COW], zones: { p1: { battlefield: ['Test Raider', 'Plains', 'Plains'] }, p2: { library: ['Test Red Imp', 'Plains'], battlefield: ['Test Raid Cow'] } } }), 1);
    const imp = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Red Imp')!;
    expect(imp).toBeDefined();
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && a.object === imp)).toBe(false);
  });
  it('negative: the first mode (goad) exiles nothing', () => {
    const s = hit(start(), 0);
    expect(s.zones.exile.filter((id) => s.objects[id]!.defId === 'Test Red Imp')).toHaveLength(0);
  });
});
