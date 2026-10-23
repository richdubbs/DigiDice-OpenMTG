/**
 * audit-fix-2: three cards the 2026-10-21 audit found automated wrong (archive docs/coordination/audit-2026-10-21.md), each reproduced with synthetic cards
 * (wordings invented, design 6.10) played through the engine, then fixed in the general cause. Each test is named after the rule it checks, with its negative
 * case. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 *
 *   CR 702.62a, 400.7         the haste of a creature cast with suspend comes from the suspend cast trigger's effect, so a card that only GAINED suspend in
 *                             exile (Taigam, Master Opportunist) has haste too once cast; it ends when its caster loses control of it
 *   CR 113.2c, 702.167c, 602.5b  "~ has each activated ability of the exiled cards used to craft it. You may activate each of those abilities only once each
 *                             turn." (The Enigma Jewel): two copies of one card give two instances, each activated once each turn
 *   CR 500.7, 611.2a          "Take an extra turn after this one. During that turn, power-up abilities can't be activated." (Kang the Conqueror): the ban is
 *                             tied to the extra turn this ability created, not to whichever turn comes next; a skipped turn ends it unused
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type DecisionAnswer, type GameState, type OracleCard } from '../../../src/index';
import { charsOfObject } from '../../../src/rules/characteristics';
import { answer, cast, drive, find, lands, next, scenario } from '../../m6/dfc/support';
import * as m3 from '../../m3/scenario';
import * as cmd3 from '../cmd3/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');
const hasKw = (s: GameState, id: string, kw: string): boolean => charsOfObject(s, s.objects[id]!).keywords.some((k) => k.keyword === kw);

/** Step forward (passing priority, declaring nothing) until `done` holds or a yes/no question is asked. */
function upTo(s: GameState, done: (t: GameState) => boolean, max = 400): GameState {
  let t = s;
  for (let i = 0; i < max && !done(t) && t.pending?.kind !== 'yesNo'; i++) {
    t = t.pending && t.pending.kind !== 'priority' && t.pending.kind !== 'declareAttackers' && t.pending.kind !== 'declareBlockers' ? drive(t) : next(t);
  }
  return t;
}
const mainOf = (s: GameState, player: 'p1' | 'p2'): GameState => upTo(s, (t) => t.turn.activePlayer === player && t.turn.step === 'main1' && t.pending?.kind === 'priority' && t.zones.stack.length === 0);
const yes = (s: GameState, y: boolean): GameState => drive(answer(s, { kind: 'yesNo', yes: y } as DecisionAnswer));
const settle = (s: GameState): GameState => upTo(s, (t) => t.zones.stack.length === 0 && t.pending?.kind === 'priority');

describe('CR 702.62a, 400.7: a creature cast from suspend has haste even when the card only gained suspend in exile', () => {
  const MONK = card('Test Patient Abbot', 'Legendary Creature — Human Monk', "Whenever you cast your second spell each turn, copy it, then exile the spell you cast with two time counters on it. If it doesn't have suspend, it gains suspend.", { pt: ['2', '2'] });
  const SIP = card('Test Small Sip', 'Instant', 'You gain 1 life.');
  const CUB = card('Test Plain Cub', 'Creature — Bear', '', { pt: ['2', '2'] });
  const DEFS = [MONK, SIP, CUB];
  const board = (): GameState => scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Small Sip', 'Test Plain Cub'], battlefield: ['Test Patient Abbot', ...lands('Forest', 2)] } });
  /** The second spell is exiled with two time counters; two upkeeps later the last one is removed and p1 is asked whether to cast it. */
  const toCast = (): GameState => {
    let s = settle(cast(settle(cast(board(), 'Test Small Sip')), 'Test Plain Cub'));
    s = mainOf(mainOf(s, 'p2'), 'p1');
    return upTo(mainOf(s, 'p2'), () => false);
  };

  it('the synthetic cards are automated', () => {
    for (const d of DEFS) expect(full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('CR 702.62a: cast as the last time counter is removed, the creature has haste on the stack and on the battlefield', () => {
    let s = toCast();
    expect(s.pending?.kind).toBe('yesNo');
    s = yes(s, true);
    const spell = s.zones.stack.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Plain Cub');
    if (spell !== undefined) expect(hasKw(s, spell, 'haste')).toBe(true);
    s = settle(s);
    const cubs = s.zones.battlefield.filter((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Plain Cub' && s.objects[x]!.kind === 'card');
    expect(cubs).toHaveLength(1);
    expect(hasKw(s, cubs[0]!, 'haste')).toBe(true);
    expect(hasKw(s, cubs[0]!, 'suspend')).toBe(false); // the granted suspend stayed with the card in exile (CR 400.7); the haste does not need it
  });
  it('negative: the token copy (never cast with suspend) and the same creature cast from the hand have no haste', () => {
    const s = settle(cast(settle(cast(board(), 'Test Small Sip')), 'Test Plain Cub'));
    const token = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Plain Cub');
    expect(token).toBeDefined();
    expect(hasKw(s, token!, 'haste')).toBe(false);
    const plain = settle(cast(scenario(['Forest'], { defs: DEFS, p1: { hand: ['Test Plain Cub'] } }), 'Test Plain Cub'));
    expect(hasKw(plain, find(plain, 'Test Plain Cub', 'battlefield', 'p1'), 'haste')).toBe(false);
  });
  it('negative (CR 702.62a "until you lose control"): once its controller changed, the haste is gone', () => {
    const s = settle(yes(toCast(), true));
    const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === 'Test Plain Cub' && s.objects[x]!.kind === 'card')!;
    const lost = structuredClone(s);
    lost.objects[id]!.cast = { ...lost.objects[id]!.cast!, controlLost: true };
    expect(hasKw(lost, id, 'haste')).toBe(false);
  });
});

describe('CR 113.2c, 702.167c, 602.5b: two copies of one card used to craft give two instances of its ability, each once each turn', () => {
  const JEWEL = compileCard({
    name: 'Test Geode // Test Facet', layout: 'transform', mana_cost: '', type_line: 'Legendary Artifact // Legendary Artifact', oracle_text: '', colors: [], keywords: [],
    card_faces: [
      { name: 'Test Geode', mana_cost: '{U}', type_line: 'Legendary Artifact', oracle_text: "Craft with two or more nonlands with activated abilities {0} ({0}, Exile this artifact, Exile the two or more from among other permanents you control and/or cards in your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)" },
      { name: 'Test Facet', mana_cost: '', type_line: 'Legendary Artifact', oracle_text: 'Test Facet has each activated ability of the exiled cards used to craft it. You may activate each of those abilities only once each turn.' },
    ],
  } as unknown as OracleCard);
  const BELL = card('Test Chime Bell', 'Artifact', '{0}: You gain 1 life.', { cost: '{1}' });
  const KNOT = card('Test Lucky Knot', 'Artifact', '{0}: You gain 2 life.', { cost: '{1}' });
  const DEFS = [JEWEL, BELL, KNOT];
  /** Answer the decisions of an activation or a resolution (materials in order, payment automatic); stop at the next priority. */
  const answerAll = (s0: GameState, materials: string[] = []): GameState => {
    let s = s0;
    for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
      const p = s.pending;
      if (p.kind === 'chooseNumber') s = m3.answer(s, { kind: 'chooseNumber', n: materials.length > 0 ? materials.length : p.min });
      else if (p.kind === 'chooseObjects') s = m3.answer(s, { kind: 'chooseObjects', ids: materials.length > 0 ? materials.filter((id) => p.options.includes(id)) : p.options.slice(0, p.min) });
      else if (p.kind === 'payCost') s = m3.answer(s, { kind: 'payCost', auto: true });
      else if (p.kind === 'yesNo') s = m3.answer(s, { kind: 'yesNo', yes: false });
      else if (p.kind === 'order') s = m3.answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
      else throw new Error(`unexpected decision ${p.kind}`);
    }
    return s;
  };
  const resolveAll = (s0: GameState): GameState => {
    let s = s0;
    for (let i = 0; i < 12 && s.zones.stack.length > 0; i++) s = answerAll(m3.passBoth(s));
    return s;
  };
  const geode = (s: GameState): string => m3.find(s, 'Test Geode // Test Facet', 'battlefield', 'p1');
  const abilities = (s: GameState) => m3.legal(s, 'p1', 'activate').filter((a) => a.object === geode(s) && !a.isMana);
  const crafted = (graveyard: string[]): GameState => {
    const s0 = m3.scenario([], { defs: DEFS, p1: { battlefield: ['Test Geode // Test Facet'], graveyard } });
    const ids = s0.zones.graveyard['p1']!.slice();
    return resolveAll(answerAll(m3.act(s0, abilities(s0)[0]!.action), ids));
  };
  const activate = (s: GameState, label: RegExp): GameState => resolveAll(answerAll(m3.act(s, abilities(s).find((a) => label.test(a.label))!.action)));

  it('the synthetic jewel is automated on both faces', () => expect(full(JEWEL)).toBe(true));
  it('CR 113.2c: crafted from two copies of one card, it has two instances of the ability; each is activated once this turn (2 life)', () => {
    let s = crafted(['Test Chime Bell', 'Test Chime Bell']);
    expect(s.objects[geode(s)]!.face).toBe(1);
    expect(abilities(s).filter((a) => /1 life/.test(a.label))).toHaveLength(2);
    const before = m3.life(s, 'p1');
    s = activate(s, /1 life/);
    expect(abilities(s).filter((a) => /1 life/.test(a.label))).toHaveLength(1);
    s = activate(s, /1 life/);
    expect(m3.life(s, 'p1')).toBe(before + 2);
    expect(abilities(s).filter((a) => /1 life/.test(a.label))).toHaveLength(0); // CR 602.5b: each instance once each turn
  });
  it('negative: from two different cards, one instance each; the once-each-turn limit still holds per ability', () => {
    let s = crafted(['Test Chime Bell', 'Test Lucky Knot']);
    expect(abilities(s).filter((a) => /1 life/.test(a.label))).toHaveLength(1);
    expect(abilities(s).filter((a) => /2 life/.test(a.label))).toHaveLength(1);
    s = activate(s, /1 life/);
    expect(abilities(s).filter((a) => /1 life/.test(a.label))).toHaveLength(0);
    expect(abilities(s).filter((a) => /2 life/.test(a.label))).toHaveLength(1);
  });
});

describe('CR 500.7, 611.2a: "During that turn" is the extra turn the ability created, also when another extra turn is created later', () => {
  const ARCHON = cmd3.card('Test Hour Archon', 'Creature — Human Villain', 'Power-up — {1}: Draw a card. Take an extra turn after this one. During that turn, power-up abilities can\'t be activated.', ['2', '2'], '{3}');
  const GADGET = cmd3.card('Test Gadget', 'Creature — Robot', 'Power-up — {1}: Put a +1/+1 counter on this creature.\n{1}: This creature gets +1/+0 until end of turn.', ['1', '1'], '{2}');
  const WARP = cmd3.card('Test Time Fold', 'Sorcery', 'Take an extra turn after this one.', undefined, '{0}');
  const NAP = cmd3.card('Test Long Nap', 'Instant', 'You gain 1 life. You skip your next turn.', undefined, '{0}');
  const DEFS: CardDef[] = [ARCHON, GADGET, WARP, NAP];
  const PLAINS = ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'];
  const canActivate = (s: GameState, source: string, i: number): boolean => {
    try {
      m3.act(s, { type: 'activate', player: 'p1', source, ability: `p:0:${i}` });
      return true;
    } catch {
      return false;
    }
  };
  const activate = (s: GameState, source: string, i: number): GameState => cmd3.resolveAll(cmd3.settle(m3.act(s, { type: 'activate', player: 'p1', source, ability: `p:0:${i}` })));
  /** On to the first main phase of the next turn: priority passed, no attackers or blockers declared, the cleanup discard answered. */
  const nextMain = (s0: GameState): GameState => {
    const turn = s0.turn.number;
    let s = s0;
    for (let i = 0; i < 300; i++) {
      if (s.turn.number > turn && s.turn.step === 'main1' && s.pending?.kind === 'priority' && s.zones.stack.length === 0) return s;
      const d = s.pending!;
      if (d.kind === 'priority') s = m3.act(s, { type: 'pass', player: d.player });
      else if (d.kind === 'declareAttackers') s = m3.answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (d.kind === 'declareBlockers') s = m3.answer(s, { kind: 'declareBlockers', blocks: [] });
      else s = cmd3.settle(s);
    }
    throw new Error('never reached the next main phase');
  };
  const board = (hand: string[]): GameState => m3.scenario([], { p1: { battlefield: ['Test Hour Archon', 'Test Gadget', ...PLAINS], hand, library: ['Plains', 'Plains', 'Plains', 'Plains', 'Plains', 'Plains'] }, defs: DEFS });
  /** p1 activates the Archon's power-up (extra turn A), then casts the extra-turn sorcery (extra turn B, taken first, CR 500.7). */
  const twoExtra = (): { s: GameState; gadget: string } => {
    let s = board(['Test Time Fold', 'Test Long Nap']);
    const archon = m3.find(s, 'Test Hour Archon', 'battlefield', 'p1');
    const gadget = m3.find(s, 'Test Gadget', 'battlefield', 'p1');
    s = activate(s, archon, 0);
    s = cmd3.resolveAll(cmd3.cast(s, 'Test Time Fold'));
    expect(s.turn.extraTurns).toEqual(['p1', 'p1']);
    return { s, gadget };
  };

  it('the synthetic cards are automated', () => {
    for (const d of DEFS) expect(cmd3.full(d), `${d.name}: ${JSON.stringify(d.automation)}`).toBe(true);
  });
  it('CR 500.7: the later extra turn (the sorcery\'s) is taken first: power-up abilities CAN be activated in it; in the Archon\'s turn after it they cannot', () => {
    const { s: s0, gadget } = twoExtra();
    let s = nextMain(s0);
    expect(s.turn.activePlayer).toBe('p1');
    expect(canActivate(s, gadget, 0)).toBe(true); // the sorcery's extra turn: no ban
    s = nextMain(s);
    expect(s.turn.activePlayer).toBe('p1'); // the Archon's extra turn
    expect(canActivate(s, gadget, 0)).toBe(false);
    expect(canActivate(s, gadget, 1)).toBe(true); // another activated ability still can
    s = nextMain(s);
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.continuousEffects.some((e) => e.duration.d === 'duringNextTurn')).toBe(false);
  });
  it('negative: with only the Archon\'s extra turn, the ban applies in the very next turn (the extra turn) and not after it', () => {
    let s = board([]);
    const archon = m3.find(s, 'Test Hour Archon', 'battlefield', 'p1');
    const gadget = m3.find(s, 'Test Gadget', 'battlefield', 'p1');
    s = activate(s, archon, 0);
    expect(canActivate(s, gadget, 0)).toBe(true); // the rest of this turn
    s = nextMain(s);
    expect(canActivate(s, gadget, 0)).toBe(false);
    s = nextMain(nextMain(s));
    expect(s.turn.activePlayer).toBe('p1');
    expect(canActivate(s, gadget, 0)).toBe(true);
  });
  it('CR 500.7, 614.10: when the Archon\'s extra turn is skipped, the ban ends unused: it never applies in a later turn', () => {
    const { s: s0, gadget } = twoExtra();
    let s = nextMain(s0); // the sorcery's extra turn
    s = cmd3.resolveAll(cmd3.cast(s, 'Test Long Nap')); // skips p1's next turn: the Archon's
    s = nextMain(s);
    expect(s.turn.activePlayer).toBe('p2');
    expect(s.continuousEffects.some((e) => e.duration.d === 'duringNextTurn')).toBe(false);
    s = nextMain(s);
    expect(s.turn.activePlayer).toBe('p1');
    expect(canActivate(s, gadget, 0)).toBe(true);
  });
});
