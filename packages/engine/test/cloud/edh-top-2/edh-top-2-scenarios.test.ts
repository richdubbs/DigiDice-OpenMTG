/**
 * Commander lane edh-top, round edh-top-2: scenarios with synthetic cards (invented names, design 6.10), compiled by the default compiler.
 * CR cites are from the Comprehensive Rules 2026-09-25 (media.wizards.com text read in the session unless a test says otherwise).
 *
 *   CR 605.3b, 118.3, 400.7j, 608.2h   a mana ability whose cost exiles a creature and whose amount reads the exiled creature's mana value (Food Chain)
 *   CR 702.95                         soulbond: pairing as either creature enters, "as long as ~ is paired with another creature, each of those creatures has ...", the pair ending
 */
import { describe, expect, it } from 'vitest';
import { compileCard, createToken, type CardDef, type Color, type GameState, type OracleCard, type PlayerId } from '../../../src/index';
import { Game } from '../../../src/core/game';
import { hasKeyword, charsOfObject } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, castAuto, find, legal, pass, pool, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string; colors?: Color[] } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}

const CHAIN = card('Test Link Chain', 'Enchantment', 'Exile a creature you control: Add X mana of any one color, where X is 1 plus the exiled creature\'s mana value. Spend this mana only to cast creature spells.', { cost: '{1}{G}', colors: ['G'] });
const THREE = card('Test Threedrop', 'Creature — Elf', '', { cost: '{2}{G}', colors: ['G'], pt: ['2', '2'] });
const ZERO = card('Test Zerodrop', 'Creature — Elf', '', { cost: '{0}', pt: ['0', '1'] });
const BEAST = card('Test Beast', 'Creature — Beast', '', { cost: '{4}{G}', colors: ['G'], pt: ['5', '5'] });
const DRAW = card('Test Dream', 'Sorcery', 'Draw a card.', { cost: '{1}{U}', colors: ['U'] });
const DEFS = [CHAIN, THREE, ZERO, BEAST, DRAW];

describe('CR 605.3b, 400.7j: Food Chain style mana ability reads the exiled creature', () => {
  it('is automated', () => {
    expect(CHAIN.automation.level).toBe('full');
  });
  /** Activate the chain's mana ability, exiling `victim` and choosing `color`: the state afterwards. */
  const chain = (s: GameState, victim: string, color: 'G' | 'U' = 'G'): GameState => {
    const a = legal(s, 'p1', 'activate').find((x) => x.object === find(s, 'Test Link Chain', 'battlefield', 'p1') && x.isMana === true);
    if (a === undefined) throw new Error('not offered');
    const t = act(s, a.action);
    const u = t.pending?.kind === 'chooseObjects' ? answer(t, { kind: 'chooseObjects', ids: [find(s, victim, 'battlefield', 'p1')] }) : t; // one candidate: nothing to choose
    expect(u.pending?.kind).toBe('chooseColor');
    return answer(u, { kind: 'chooseColor', color });
  };
  it('exiling a creature with mana value 3 adds 1 + 3 = 4 mana of the chosen color, and the creature is in exile', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Link Chain', 'Test Threedrop'] } });
    const t = chain(s, 'Test Threedrop');
    expect(pool(t, 'p1')).toBe('GGGG');
    expect(t.zones.exile.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Threedrop')).toBe(true);
    expect(t.zones.battlefield.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Threedrop')).toBe(false);
  });
  it('a creature with mana value 0 adds 1 mana (the "1 plus" part)', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Link Chain', 'Test Zerodrop'] } });
    expect(pool(chain(s, 'Test Zerodrop', 'U'), 'p1')).toBe('U');
  });
  it('with two creatures the exiled one decides the amount: the mana value 5 creature adds 6, the other stays', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Link Chain', 'Test Threedrop', 'Test Beast'] } });
    const t = chain(s, 'Test Beast');
    expect(pool(t, 'p1')).toBe('GGGGGG');
    expect(t.zones.battlefield.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Threedrop')).toBe(true);
  });
  it('negative: no creature you control, no activation (the cost can\'t be paid, CR 118.3)', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Link Chain'] } });
    expect(legal(s, 'p1', 'activate').some((x) => x.isMana === true)).toBe(false);
  });
  it('negative: an opponent\'s creature is not a creature you control, so it can\'t be exiled for the cost', () => {
    const s = scenario([], { defs: DEFS, p1: { battlefield: ['Test Link Chain'] }, p2: { battlefield: ['Test Threedrop'] } });
    expect(legal(s, 'p1', 'activate').some((x) => x.isMana === true)).toBe(false);
  });
  it('the mana is for creature spells only: it pays a creature spell and not a sorcery', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Dream', 'Test Beast'], battlefield: ['Test Link Chain', 'Test Threedrop'] } });
    const t = chain(s, 'Test Threedrop', 'G');
    expect(pool(t, 'p1')).toBe('GGGG');
    // {1}{U}: the pool holds only creature-only G mana, so the sorcery can't be cast with it
    expect(legal(t, 'p1', 'cast').some((x) => x.object === find(t, 'Test Dream', 'hand', 'p1'))).toBe(false);
  });
  it('CR 605.3b, 106.6: the floating mana pays a creature spell cast afterwards, the exiled creature stays in exile', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Threedrop'], battlefield: ['Test Link Chain', 'Test Beast'] } });
    const floating = chain(s, 'Test Beast');
    expect(pool(floating, 'p1')).toBe('GGGGGG');
    const pay = act(floating, { type: 'cast', player: 'p1', card: find(floating, 'Test Threedrop', 'hand', 'p1') });
    const t = answer(pay, { kind: 'payCost', auto: true });
    expect(t.zones.stack.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Threedrop')).toBe(true);
    expect(pool(t, 'p1')).toBe('GGG');
    expect(t.zones.exile.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Beast')).toBe(true);
  });
  it('CR 605.3a (castability): a spell the player could pay for only by exiling a creature to the Chain is not offered: the Chain is activated by hand first', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Threedrop'], battlefield: ['Test Link Chain', 'Test Beast'] } });
    expect(legal(s, 'p1', 'cast').some((x) => x.object === find(s, 'Test Threedrop', 'hand', 'p1'))).toBe(false);
  });
  it('negative: the mana can\'t pay for a sorcery cast afterwards', () => {
    const s = scenario([], { defs: DEFS, p1: { hand: ['Test Dream'], battlefield: ['Test Link Chain', 'Test Beast'] } });
    const t = chain(s, 'Test Beast', 'U');
    expect(pool(t, 'p1')).toBe('UUUUUU');
    expect(legal(t, 'p1', 'cast').some((x) => x.object === find(t, 'Test Dream', 'hand', 'p1'))).toBe(false);
  });
  it('CR 111.7, 608.2h: a token that ceases to exist in exile still counts by its mana value (a copy token of a mana value 3 card adds 4; a plain token adds 1)', () => {
    const copy = compileCard({ name: 'Test Copy Token', layout: 'token', mana_cost: '{2}{G}', type_line: 'Token Creature — Elf', oracle_text: '', colors: ['G'], power: '2', toughness: '2' } as OracleCard);
    const plain = compileCard({ name: 'Test Plain Token', layout: 'token', type_line: 'Token Creature — Golem', oracle_text: '', colors: [], power: '1', toughness: '1' } as OracleCard);
    const amount = (tok: typeof copy): string => {
      const s0 = scenario([], { defs: DEFS, p1: { battlefield: ['Test Link Chain'] } });
      const g = new Game(structuredClone(s0));
      createToken(g, tok, 'p1');
      const s = g.s;
      return pool(chain(s, tok.name), 'p1');
    };
    expect(amount(copy)).toBe('GGGG');
    expect(amount(plain)).toBe('G');
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* CR 702.95: soulbond                                                                                                                                      */

const SOUL = 'Soulbond (You may pair this creature with another unpaired creature when either enters. They remain paired for as long as you control both of them.)';
const BONDER = card('Test Bonder', 'Creature — Human', `${SOUL}\nAs long as Test Bonder is paired with another creature, each of those creatures has flying.`, { pt: ['2', '2'] });
const SECOND = card('Test Second Bonder', 'Creature — Human', `${SOUL}\nAs long as this creature is paired with another creature, each of those creatures has \"{T}: You gain 1 life.\"`, { pt: ['1', '1'] });
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const WOLF = card('Test Wolf', 'Creature — Wolf', '', { pt: ['3', '3'] });
const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.', { colors: ['R'] });
const STEAL = card('Test Steal', 'Instant', 'Gain control of target creature.', { colors: ['U'] });
const MASS_STEAL = card('Test Mass Steal', 'Sorcery', 'Gain control of all creatures until end of turn.', { colors: ['R'] });
const CLUE = card('Test Clue Aura', 'Enchantment — Aura', 'Enchant creature\nEnchanted permanent is a colorless Clue artifact with \"{2}, Sacrifice this artifact: Draw a card\" and loses all other card types and abilities.', { colors: ['U'] });
const objectNamed = (s: GameState, name: string, owner?: 'p1' | 'p2') => s.objects[find(s, name, 'battlefield', owner)]!;
const SB_DEFS = [BONDER, SECOND, BEAR, WOLF, SMITE, STEAL, MASS_STEAL, CLUE];

describe('CR 702.95: soulbond', () => {
  const objectNamed = (s: GameState, name: string, owner?: 'p1' | 'p2') => s.objects[find(s, name, 'battlefield', owner)]!;
  const partnerName = (s: GameState, name: string): string | undefined => {
    const o = objectNamed(s, name);
    return o.pairedWith === undefined ? undefined : s.defs[s.objects[o.pairedWith]!.defId]!.name;
  };
  const flies = (s: GameState, name: string): boolean => hasKeyword(charsOfObject(s, objectNamed(s, name)), 'flying');
  /** Pass until the stack is empty and the priority player is p1 (p2 passes whenever it holds priority). */
  const settle = (s: GameState): GameState => {
    let t = s;
    for (let i = 0; i < 12 && (t.zones.stack.length > 0 || t.pending?.kind !== 'priority'); i++) {
      if (t.pending?.kind === 'priority') t = pass(t);
      else break;
    }
    return t;
  };
  const castBonder = (s: GameState, name = 'Test Bonder'): GameState => settle(castAuto(s, name));
  /** Test setup: two creatures of p1 already paired (as the pair op leaves them, CR 702.95b). */
  const pairUp = (s: GameState, a: string, b: string): GameState => {
    const t = structuredClone(s);
    const x = t.objects[find(t, a, 'battlefield', 'p1')]!;
    const y = t.objects[find(t, b, 'battlefield', 'p1')]!;
    x.pairedWith = y.id; y.pairedWith = x.id; x.pairedBy = y.pairedBy = 'p1';
    return t;
  };

  it('is automated: the keyword and the static ability of both cards', () => {
    expect(BONDER.automation.level).toBe('full');
    expect(SECOND.automation.level).toBe('full');
  });
  it('CR 702.95a: when it enters with an unpaired creature of yours, you may pair it; both then have flying (the grant is "each of those creatures")', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Bonder'], battlefield: ['Test Bear'] } });
    let t = castAuto(s, 'Test Bonder');
    while (t.pending?.kind === 'priority') t = pass(t);
    expect(t.pending?.kind).toBe('chooseObjects');
    t = answer(t, { kind: 'chooseObjects', ids: [find(t, 'Test Bear', 'battlefield')] });
    t = settle(t);
    expect(partnerName(t, 'Test Bonder')).toBe('Test Bear');
    expect(partnerName(t, 'Test Bear')).toBe('Test Bonder');
    expect(flies(t, 'Test Bonder')).toBe(true);
    expect(flies(t, 'Test Bear')).toBe(true);
  });
  it('CR 702.95a: "you may": choosing no creature leaves both unpaired and nobody flies', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Bonder'], battlefield: ['Test Bear'] } });
    let t = castAuto(s, 'Test Bonder');
    while (t.pending?.kind === 'priority') t = pass(t);
    t = settle(answer(t, { kind: 'chooseObjects', ids: [] }));
    expect(partnerName(t, 'Test Bonder')).toBeUndefined();
    expect(flies(t, 'Test Bonder')).toBe(false);
    expect(flies(t, 'Test Bear')).toBe(false);
  });
  it('CR 702.95a (intervening if): with no other creature there is nothing to pair and the ability does not trigger', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Bonder'] } });
    const t = castBonder(s);
    expect(t.pending?.kind).toBe('priority');
    expect(partnerName(t, 'Test Bonder')).toBeUndefined();
  });
  it('CR 702.95a: only another creature YOU control: an opponent\'s creature is not a candidate, so there is no trigger', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Bonder'] }, p2: { battlefield: ['Test Bear'] } });
    const t = castBonder(s);
    expect(t.pending?.kind).toBe('priority');
    expect(partnerName(t, 'Test Bonder')).toBeUndefined();
  });
  it('CR 702.95a: the second soulbond trigger: a creature of yours that enters later may be paired with the unpaired soulbond creature', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Wolf'], battlefield: ['Test Bonder'] } });
    let t = castAuto(s, 'Test Wolf');
    while (t.pending?.kind === 'priority') t = pass(t);
    expect(t.pending?.kind).toBe('yesNo');
    t = settle(answer(t, { kind: 'yesNo', yes: true }));
    expect(partnerName(t, 'Test Bonder')).toBe('Test Wolf');
    expect(flies(t, 'Test Wolf')).toBe(true);
  });
  it('CR 702.95a: "you may" for the second trigger: declining leaves both unpaired', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Wolf'], battlefield: ['Test Bonder'] } });
    let t = castAuto(s, 'Test Wolf');
    while (t.pending?.kind === 'priority') t = pass(t);
    t = settle(answer(t, { kind: 'yesNo', yes: false }));
    expect(partnerName(t, 'Test Bonder')).toBeUndefined();
    expect(flies(t, 'Test Wolf')).toBe(false);
  });
  it('CR 702.95d: a paired creature is not paired again: a third creature entering does not trigger the paired Bonder (intervening if: both unpaired)', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Wolf'], battlefield: ['Test Bonder', 'Test Bear'] } });
    const paired = pairUp(s, 'Test Bonder', 'Test Bear');
    const t = settle(castAuto(paired, 'Test Wolf'));
    expect(t.pending?.kind).toBe('priority'); // no yes/no question
    expect(partnerName(t, 'Test Bonder')).toBe('Test Bear');
    expect(partnerName(t, 'Test Wolf')).toBeUndefined();
  });
  it('CR 702.95a: an unpaired soulbond creature of yours still pairs with the creature that enters while another one is paired', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Wolf'], battlefield: ['Test Bonder', 'Test Bear', 'Test Second Bonder'] } });
    const paired = pairUp(s, 'Test Bonder', 'Test Bear');
    let t = castAuto(paired, 'Test Wolf');
    while (t.pending?.kind === 'priority') t = pass(t);
    expect(t.pending?.kind).toBe('yesNo');
    t = settle(answer(t, { kind: 'yesNo', yes: true }));
    expect(partnerName(t, 'Test Second Bonder')).toBe('Test Wolf');
    expect(partnerName(t, 'Test Bonder')).toBe('Test Bear');
  });
  it('CR 702.95e: the pair ends when its partner leaves the battlefield: the other creature stops flying', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Smite'], battlefield: ['Test Bonder', 'Test Bear'] } });
    const paired = pairUp(s, 'Test Bonder', 'Test Bear');
    expect(flies(paired, 'Test Bonder')).toBe(true);
    let t = castAuto(paired, 'Test Smite', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(paired, 'Test Bear', 'battlefield') }] }] });
    t = settle(t);
    expect(t.zones.battlefield.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Bear')).toBe(false);
    expect(partnerName(t, 'Test Bonder')).toBeUndefined();
    expect(flies(t, 'Test Bonder')).toBe(false);
  });
  it('CR 702.95e: the pair ends when another player gains control of the partner (and the Bonder stops flying, the stolen Bear stops too)', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { battlefield: ['Test Bonder', 'Test Bear'] }, p2: { hand: ['Test Steal'] } });
    const paired = pairUp(s, 'Test Bonder', 'Test Bear');
    let t = pass(paired); // p2 gets priority
    t = castAuto(t, 'Test Steal', { player: 'p2', answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(paired, 'Test Bear', 'battlefield') }] }] });
    t = settle(t);
    expect(objectNamed(t, 'Test Bear').controller).toBe('p2');
    expect(partnerName(t, 'Test Bonder')).toBeUndefined();
    expect(partnerName(t, 'Test Bear')).toBeUndefined();
    expect(flies(t, 'Test Bonder')).toBe(false);
    expect(flies(t, 'Test Bear')).toBe(false);
  });
  it('CR 702.95e: another player gaining control of BOTH creatures also ends the pair (they are not paired for that player, who did not pair them)', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { battlefield: ['Test Bonder', 'Test Bear'] }, p2: { hand: ['Test Mass Steal'] } });
    const paired = pairUp(s, 'Test Bonder', 'Test Bear');
    // a sorcery: cast it in p2's own turn
    let t = advanceTo(paired, 2, 'main1');
    t = castAuto(t, 'Test Mass Steal', { player: 'p2' });
    t = settle(t);
    expect(objectNamed(t, 'Test Bonder').controller).toBe('p2');
    expect(objectNamed(t, 'Test Bear').controller).toBe('p2');
    expect(partnerName(t, 'Test Bonder')).toBeUndefined();
    expect(flies(t, 'Test Bear')).toBe(false);
  });
  it('CR 702.95e: the pair ends when the partner stops being a creature', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Clue Aura'], battlefield: ['Test Bonder', 'Test Bear'] } });
    const paired = pairUp(s, 'Test Bonder', 'Test Bear');
    let t = castAuto(paired, 'Test Clue Aura', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(paired, 'Test Bear', 'battlefield') }] }] });
    t = settle(t);
    expect(partnerName(t, 'Test Bonder')).toBeUndefined();
    expect(flies(t, 'Test Bonder')).toBe(false);
  });
  it('CR 702.95a: after the pair ended a new one can be made when a creature enters', () => {
    const s = scenario([], { defs: SB_DEFS, p1: { hand: ['Test Smite', 'Test Wolf'], battlefield: ['Test Bonder', 'Test Bear'] } });
    const paired = pairUp(s, 'Test Bonder', 'Test Bear');
    let t = settle(castAuto(paired, 'Test Smite', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(paired, 'Test Bear', 'battlefield') }] }] }));
    t = castAuto(t, 'Test Wolf');
    while (t.pending?.kind === 'priority') t = pass(t);
    t = settle(answer(t, { kind: 'yesNo', yes: true }));
    expect(partnerName(t, 'Test Bonder')).toBe('Test Wolf');
  });
});

describe('CR 702.95: the granted abilities (Deadeye Navigator, Tandem Lookout)', () => {
  const NAVIGATOR = card('Test Navigator', 'Creature — Human', `${SOUL}\nAs long as Test Navigator is paired with another creature, each of those creatures has \"{1}{U}: Exile this creature, then return it to the battlefield under your control.\"`, { pt: ['2', '2'], colors: ['U'] });
  const LOOKOUT = card('Test Lookout', 'Creature — Human', `${SOUL}\nAs long as Test Lookout is paired with another creature, each of those creatures has \"Whenever this creature deals damage to an opponent, draw a card.\"`, { pt: ['1', '1'] });
  const DEFS2 = [NAVIGATOR, LOOKOUT, BEAR, WOLF];
  const named = (s: GameState, name: string) => s.objects[find(s, name, 'battlefield', 'p1')]!;
  const pairNow = (s: GameState, a: string, b: string): GameState => {
    const t = structuredClone(s);
    const x = t.objects[find(t, a, 'battlefield', 'p1')]!;
    const y = t.objects[find(t, b, 'battlefield', 'p1')]!;
    x.pairedWith = y.id; y.pairedWith = x.id; x.pairedBy = y.pairedBy = 'p1';
    return t;
  };
  it('is automated', () => {
    expect(NAVIGATOR.automation.level).toBe('full');
    expect(LOOKOUT.automation.level).toBe('full');
  });
  it('CR 702.95b, 613.1f (Deadeye Navigator): both creatures, the partner too, can be flickered for {1}{U}; the partner returns unpaired; the Navigator\'s second trigger reunites them', () => {
    const s = scenario(['Island', 'Island'], { defs: DEFS2, p1: { battlefield: ['Test Navigator', 'Test Bear', 'Island', 'Island'] } });
    const paired = pairNow(s, 'Test Navigator', 'Test Bear');
    const bearActs = legal(paired, 'p1', 'activate').filter((a) => a.object === find(paired, 'Test Bear', 'battlefield', 'p1') && a.isMana !== true);
    expect(bearActs.length).toBe(1);
    let t = act(paired, bearActs[0]!.action);
    while (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
    // the ability resolves: the Bear is exiled and returns under p1's control; the pair is broken at once
    while (t.zones.stack.length > 0 && t.pending?.kind === 'priority') t = pass(t);
    // the Bear entering triggers the Navigator's soulbond: "you may pair that creature with this creature"
    while (t.pending?.kind === 'priority') t = pass(t);
    expect(t.pending?.kind).toBe('yesNo');
    t = answer(t, { kind: 'yesNo', yes: true });
    while (t.pending?.kind === 'priority' && t.zones.stack.length > 0) t = pass(t);
    expect(named(t, 'Test Navigator').pairedWith).toBe(named(t, 'Test Bear').id);
  });
  it('CR 702.95e (the second Deadeye Navigator ruling): once the Bear is exiled the Navigator no longer has the ability', () => {
    const s = scenario(['Island', 'Island'], { defs: DEFS2, p1: { battlefield: ['Test Navigator', 'Test Bear', 'Island', 'Island'] } });
    const paired = pairNow(s, 'Test Navigator', 'Test Bear');
    expect(legal(paired, 'p1', 'activate').filter((a) => a.object === find(paired, 'Test Navigator', 'battlefield', 'p1') && a.isMana !== true).length).toBe(1);
    const unpaired = scenario(['Island', 'Island'], { defs: DEFS2, p1: { battlefield: ['Test Navigator', 'Test Bear', 'Island', 'Island'] } });
    expect(legal(unpaired, 'p1', 'activate').filter((a) => a.object === find(unpaired, 'Test Navigator', 'battlefield', 'p1') && a.isMana !== true).length).toBe(0);
    expect(legal(unpaired, 'p1', 'activate').filter((a) => a.object === find(unpaired, 'Test Bear', 'battlefield', 'p1') && a.isMana !== true).length).toBe(0);
  });
  it('CR 702.95b (Tandem Lookout): the partner has "whenever this creature deals damage to an opponent, draw a card"; an unpaired creature does not', () => {
    const attack = (s: GameState, who: string): GameState => {
      let t = advanceTo(s, 1, 'declareAttackers');
      t = answer(t, { kind: 'declareAttackers', attacks: [{ attacker: find(t, who, 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
      for (let i = 0; i < 40 && t.turn.step !== 'end' && t.turn.number === 1; i++) t = t.pending?.kind === 'declareBlockers' ? answer(t, { kind: 'declareBlockers', blocks: [] }) : act(t, { type: 'pass', player: t.pending!.player });
      return t;
    };
    const base = scenario([], { defs: DEFS2, p1: { battlefield: ['Test Lookout', 'Test Bear'] } });
    const handSize = (t: GameState): number => t.zones.hand['p1']!.length;
    const before = handSize(base);
    const paired = attack(pairNow(base, 'Test Lookout', 'Test Bear'), 'Test Bear');
    expect(handSize(paired) - before).toBe(1);
    const unpaired = attack(base, 'Test Bear');
    expect(handSize(unpaired) - before).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* CR 702.150: compleated, and Vraska's two loyalty abilities                                                                                               */

describe('CR 702.150a: compleated', () => {
  const COMPLEATED = 'Compleated ({B/P} can be paid with {B} or 2 life. If life was paid, this planeswalker enters with two fewer loyalty counters.)';
  const WALKER = (name: string, cost: string, loyalty: string): CardDef => compileCard({
    name, layout: 'normal', mana_cost: cost, type_line: 'Legendary Planeswalker — Test', oracle_text: `${COMPLEATED}\n+1: You gain 1 life.`, colors: ['B'], loyalty,
  } as OracleCard);
  const ONE = WALKER('Test Compleat One', '{2}{B/P}', '5');
  const TWO = WALKER('Test Compleat Two', '{1}{B/P}{B/P}', '5');
  const FRAIL = WALKER('Test Compleat Frail', '{B/P}{B/P}', '4');
  const loyaltyOf = (s: GameState, name: string): number | undefined => {
    const id = s.zones.battlefield.find((x) => s.defs[s.objects[x]!.defId]!.name === name);
    return id === undefined ? undefined : s.objects[id]!.counters['loyalty'] ?? 0;
  };
  const resolve = (s: GameState): GameState => {
    let t = s;
    while (t.pending?.kind === 'priority' && t.zones.stack.length > 0) t = pass(t);
    return t;
  };
  it('is automated', () => {
    expect(ONE.automation.level).toBe('full');
  });
  it('paying 2 life for the Phyrexian symbol: it enters with 5 - 2 = 3 loyalty counters', () => {
    const s = scenario(['Plains'], { defs: [ONE], p1: { hand: ['Test Compleat One'], battlefield: ['Plains', 'Plains'] } });
    const t = resolve(castAuto(s, 'Test Compleat One'));
    expect(t.players[0]!.life).toBe(18);
    expect(loyaltyOf(t, 'Test Compleat One')).toBe(3);
  });
  it('negative: paying {B} instead of life: it enters with all 5 loyalty counters', () => {
    const s = scenario(['Swamp', 'Plains'], { defs: [ONE], p1: { hand: ['Test Compleat One'], battlefield: ['Swamp', 'Plains', 'Plains'] } });
    const t = resolve(castAuto(s, 'Test Compleat One'));
    expect(t.players[0]!.life).toBe(20);
    expect(loyaltyOf(t, 'Test Compleat One')).toBe(5);
  });
  it('two symbols paid with life: minus two for each of them (5 - 4 = 1); one paid with {B}: minus two (3)', () => {
    const s = scenario(['Plains'], { defs: [TWO], p1: { hand: ['Test Compleat Two'], battlefield: ['Plains'] } });
    expect(loyaltyOf(resolve(castAuto(s, 'Test Compleat Two')), 'Test Compleat Two')).toBe(1);
    const s2 = scenario(['Swamp', 'Plains'], { defs: [TWO], p1: { hand: ['Test Compleat Two'], battlefield: ['Swamp', 'Plains'] } });
    const t = castAuto(s2, 'Test Compleat Two');
    expect(loyaltyOf(resolve(t), 'Test Compleat Two')).toBe(3);
  });
  it('a walker that would enter with no counters left is put into the graveyard (4 - 4 = 0)', () => {
    const s = scenario([], { defs: [FRAIL], p1: { hand: ['Test Compleat Frail'] } });
    const t = resolve(castAuto(s, 'Test Compleat Frail'));
    expect(loyaltyOf(t, 'Test Compleat Frail')).toBeUndefined();
    expect(t.zones.graveyard['p1']!.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Test Compleat Frail')).toBe(true);
  });
  it('negative: a planeswalker without compleated that is cast with life for a Phyrexian symbol keeps its loyalty', () => {
    const PLAIN = compileCard({ name: 'Test Plain Walker', layout: 'normal', mana_cost: '{2}{B/P}', type_line: 'Legendary Planeswalker — Test', oracle_text: '+1: You gain 1 life.', colors: ['B'], loyalty: '5' } as OracleCard);
    const s = scenario(['Plains'], { defs: [PLAIN], p1: { hand: ['Test Plain Walker'], battlefield: ['Plains', 'Plains'] } });
    const t = resolve(castAuto(s, 'Test Plain Walker'));
    expect(t.players[0]!.life).toBe(18);
    expect(loyaltyOf(t, 'Test Plain Walker')).toBe(5);
  });
});

describe('CR 205.1a, 611.2a, 613.1d, 122.1f: the two loyalty abilities of a Phyrexian planeswalker (becomes a Treasure artifact; poison up to nine)', () => {
  const BETRAYER = compileCard({
    name: 'Test Betrayer', layout: 'normal', mana_cost: '{4}{B}', type_line: 'Legendary Planeswalker — Test', loyalty: '9', colors: ['B'],
    oracle_text: '-2: Target creature becomes a Treasure artifact with "{T}, Sacrifice this artifact: Add one mana of any color" and loses all other card types and abilities.\n-9: If target player has fewer than nine poison counters, they get a number of poison counters equal to the difference.',
  } as OracleCard);
  const FLIER = card('Test Red Flier', 'Legendary Creature — Dragon', 'Flying\n{R}: This creature gets +1/+0 until end of turn.', { pt: ['3', '3'], colors: ['R'] });
  const activate = (s: GameState, ability: number, target: { kind: 'object' | 'player'; id: string }): GameState => {
    const a = legal(s, 'p1', 'activate').filter((x) => x.object === find(s, 'Test Betrayer', 'battlefield', 'p1'));
    const chosen = a.find((x) => x.label.includes(ability === 0 ? ': -2:' : ': -9:'));
    expect(chosen).toBeDefined();
    let t = act(s, chosen!.action);
    if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [target] });
    while (t.pending?.kind === 'priority' && t.zones.stack.length > 0) t = pass(t);
    return t;
  };
  it('is automated', () => {
    expect(BETRAYER.automation.level).toBe('full');
  });
  it('the -2: the creature is only a Treasure artifact (no creature type, no creature subtypes, no abilities of its own), keeps its color and supertype, and has only the Treasure mana ability', () => {
    const s = scenario([], { defs: [BETRAYER, FLIER], p1: { battlefield: [{ name: 'Test Betrayer', counters: { loyalty: 9 } }] }, p2: { battlefield: ['Test Red Flier'] } });
    const t = activate(s, 0, { kind: 'object', id: find(s, 'Test Red Flier', 'battlefield', 'p2') });
    const c = charsOfObject(t, objectNamed(t, 'Test Red Flier', 'p2'));
    expect(c.types).toEqual(['Artifact']);
    expect(c.subtypes).toEqual(['Treasure']);
    expect(c.supertypes).toContain('Legendary');
    expect(c.colors).toEqual(['R']);
    expect(hasKeyword(c, 'flying')).toBe(false);
    expect(c.abilities.length).toBe(1); // no flying, no pump ability of its own: only the granted mana ability of the Treasure
    expect(c.abilities[0]!.def.kind).toBe('activated');
    expect(t.objects[find(t, 'Test Betrayer', 'battlefield', 'p1')]!.counters['loyalty']).toBe(7);
  });
  it('negative: the -2 only changes the target, not the other creatures', () => {
    const s = scenario([], { defs: [BETRAYER, FLIER, BEAR], p1: { battlefield: [{ name: 'Test Betrayer', counters: { loyalty: 9 } }, 'Test Bear'] }, p2: { battlefield: ['Test Red Flier'] } });
    const t = activate(s, 0, { kind: 'object', id: find(s, 'Test Red Flier', 'battlefield', 'p2') });
    expect(charsOfObject(t, objectNamed(t, 'Test Bear', 'p1')).types).toEqual(['Creature']);
  });
  const poisonAfter = (poison: number): number => {
    const s0 = scenario([], { defs: [BETRAYER], p1: { battlefield: [{ name: 'Test Betrayer', counters: { loyalty: 9 } }] } });
    const s = structuredClone(s0);
    s.players[1]!.poison = poison;
    return activate(s, 1, { kind: 'player', id: 'p2' }).players[1]!.poison;
  };
  it('the -9: a player with 3 poison counters gets the difference, 6, and ends with nine', () => {
    expect(poisonAfter(3)).toBe(9);
    expect(poisonAfter(0)).toBe(9);
    expect(poisonAfter(8)).toBe(9);
  });
  it('the -9 negative: a player with nine or more poison counters gets none', () => {
    expect(poisonAfter(9)).toBe(9);
    expect(poisonAfter(9 + 1)).toBe(10);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* CR 702.99: cipher                                                                                                                                        */

describe('CR 702.99: cipher', () => {
  const CIPHER = 'Cipher (Then you may exile this spell card encoded on a creature you control. Whenever that creature deals combat damage to a player, its controller may cast a copy of the encoded card without paying its mana cost.)';
  const RITE = card('Test Cipher Rite', 'Sorcery', `You gain 1 life.\n${CIPHER}`, { cost: '{0}', colors: ['W'] });
  const HEX = card('Test Cipher Hex', 'Instant', `Target player loses 1 life.\n${CIPHER}`, { cost: '{0}', colors: ['B'] });
  const NO = card('Test Negate', 'Instant', 'Counter target spell.', { cost: '{0}', colors: ['U'] });
  const DEFS3 = [RITE, HEX, NO, BEAR, WOLF, SMITE, STEAL];
  const life1 = (s: GameState): number => s.players[0]!.life;
  const inZone = (s: GameState, zone: 'exile' | 'graveyard' | 'stack', name: string, owner?: 'p1' | 'p2'): boolean => {
    const ids = zone === 'graveyard' ? Object.values(s.zones.graveyard).flat() : s.zones[zone];
    return ids.some((id) => s.defs[s.objects[id]!.defId]!.name === name && (owner === undefined || s.objects[id]!.owner === owner));
  };
  const resolveTop = (s: GameState): GameState => {
    let t = s;
    for (let i = 0; i < 20 && t.zones.stack.length > 0; i++) {
      if (t.pending?.kind === 'priority') t = pass(t);
      else break;
    }
    return t;
  };
  /** Cast the Rite and, as it resolves, choose `host` (undefined: nobody) for the encoding. */
  const castRite = (s: GameState, host: string | undefined, name = 'Test Cipher Rite'): GameState => {
    let t = castAuto(s, name);
    while (t.pending?.kind === 'priority' && t.zones.stack.length > 0) t = pass(t);
    expect(t.pending?.kind).toBe('chooseObjects');
    return answer(t, { kind: 'chooseObjects', ids: host === undefined ? [] : [find(s, host, 'battlefield', 'p1')] });
  };
  /** p1 attacks p2 with `who` and, after combat damage, accepts the cast of the copy. */
  const attackAndCast = (s: GameState, who: string, accept = true): GameState => {
    let t = advanceTo(s, 1, 'declareAttackers');
    t = answer(t, { kind: 'declareAttackers', attacks: [{ attacker: find(t, who, 'battlefield', 'p1'), defender: 'p2' as PlayerId }] });
    for (let i = 0; i < 60 && t.turn.number === 1 && t.turn.step !== 'end'; i++) {
      if (t.pending?.kind === 'declareBlockers') t = answer(t, { kind: 'declareBlockers', blocks: [] });
      else if (t.pending?.kind === 'yesNo') t = answer(t, { kind: 'yesNo', yes: accept });
      else if (t.pending?.kind === 'chooseTargets') t = answer(t, { kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] });
      else if (t.pending?.kind === 'payCost') t = answer(t, { kind: 'payCost', auto: true });
      else if (t.pending?.kind === 'priority') t = pass(t);
      else break;
    }
    return t;
  };
  it('is automated', () => {
    expect(RITE.automation.level).toBe('full');
  });
  it('CR 702.99a: as the spell resolves its controller chooses a creature they control: the card goes to exile, never the graveyard, and the spell\'s own effect happened', () => {
    const s = scenario([], { defs: DEFS3, p1: { hand: ['Test Cipher Rite'], battlefield: ['Test Bear'] } });
    const t = resolveTop(castRite(s, 'Test Bear'));
    expect(life1(t)).toBe(21);
    expect(inZone(t, 'exile', 'Test Cipher Rite')).toBe(true);
    expect(inZone(t, 'graveyard', 'Test Cipher Rite')).toBe(false);
  });
  it('CR 702.99a: "you may": choosing no creature puts the card into the graveyard as an ordinary spell would', () => {
    const s = scenario([], { defs: DEFS3, p1: { hand: ['Test Cipher Rite'], battlefield: ['Test Bear'] } });
    const t = resolveTop(castRite(s, undefined));
    expect(inZone(t, 'graveyard', 'Test Cipher Rite')).toBe(true);
    expect(inZone(t, 'exile', 'Test Cipher Rite')).toBe(false);
  });
  it('CR 702.99a: with no creature you control there is nothing to encode it on: graveyard (a creature of an opponent does not count)', () => {
    const s = scenario([], { defs: DEFS3, p1: { hand: ['Test Cipher Rite'] }, p2: { battlefield: ['Test Bear'] } });
    let t = castAuto(s, 'Test Cipher Rite');
    t = resolveTop(t);
    expect(t.pending?.kind).toBe('priority'); // not asked to choose
    expect(inZone(t, 'graveyard', 'Test Cipher Rite')).toBe(true);
    expect(life1(t)).toBe(21);
  });
  it('CR 608.2b, 702.99a (ruling 2013-04-15): a countered cipher spell never resolves: no encoding, the card goes to the graveyard', () => {
    const s = scenario([], { defs: DEFS3, p1: { hand: ['Test Cipher Rite'], battlefield: ['Test Bear'] }, p2: { hand: ['Test Negate'] } });
    let t = pass(castAuto(s, 'Test Cipher Rite')); // p1 passes priority: p2 may respond
    t = castAuto(t, 'Test Negate', { player: 'p2', answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Test Cipher Rite', 'stack') }] }] });
    t = resolveTop(t);
    expect(t.pending?.kind).toBe('priority');
    expect(inZone(t, 'graveyard', 'Test Cipher Rite')).toBe(true);
    expect(inZone(t, 'exile', 'Test Cipher Rite')).toBe(false);
    expect(life1(t)).toBe(20);
  });
  it('CR 702.99a: the encoded creature has "whenever this creature deals combat damage to a player, you may cast a copy of the card without paying its mana cost": each hit gains 1 life more, the card stays in exile', () => {
    const s = scenario([], { defs: DEFS3, p1: { hand: ['Test Cipher Rite'], battlefield: ['Test Bear'] } });
    const encoded = resolveTop(castRite(s, 'Test Bear'));
    expect(life1(encoded)).toBe(21);
    const t = attackAndCast(encoded, 'Test Bear');
    // the copy was cast and resolved: +1 life; it is not represented by a card, so it is not exiled encoded on a creature itself (CR 702.99a, 707.10)
    expect(life1(t)).toBe(22);
    expect(inZone(t, 'exile', 'Test Cipher Rite')).toBe(true);
    expect(inZone(t, 'stack', 'Test Cipher Rite')).toBe(false);
    expect(life1(t)).toBe(22);
  });
  it('CR 702.99a: "you may": declining to cast the copy does nothing (and the card stays encoded)', () => {
    const s = scenario([], { defs: DEFS3, p1: { hand: ['Test Cipher Rite'], battlefield: ['Test Bear'] } });
    const encoded = resolveTop(castRite(s, 'Test Bear'));
    const t = attackAndCast(encoded, 'Test Bear', false);
    expect(life1(t)).toBe(21);
    expect(inZone(t, 'exile', 'Test Cipher Rite')).toBe(true);
  });
  it('CR 702.99b, 702.99c: only the encoded creature has the ability: another creature that deals combat damage does not trigger it', () => {
    const s = scenario([], { defs: DEFS3, p1: { hand: ['Test Cipher Rite'], battlefield: ['Test Bear', 'Test Wolf'] } });
    const encoded = resolveTop(castRite(s, 'Test Bear'));
    const t = attackAndCast(encoded, 'Test Wolf');
    expect(life1(t)).toBe(21);
  });
  it('CR 702.99a (ruling 2013-04-15: the card goes directly from the stack to exile): a "put into a graveyard, exile it instead" effect does not compete with the encoding', () => {
    const HATE = card('Test Void Ring', 'Enchantment', 'If a card would be put into a graveyard from anywhere, exile it instead.', { cost: '{0}' });
    const s = scenario([], { defs: [...DEFS3, HATE], p1: { hand: ['Test Cipher Rite'], battlefield: ['Test Bear', 'Test Void Ring'] } });
    const t = resolveTop(castRite(s, 'Test Bear'));
    const exiled = t.zones.exile.map((id) => t.objects[id]!).find((o) => t.defs[o.defId]!.name === 'Test Cipher Rite');
    expect(exiled?.links?.['encoded']).toBeDefined();
  });
  it('CR 702.99c (ruling): when the creature leaves the battlefield the card is no longer encoded (it stays exiled); a creature that returns does not have the ability', () => {
    const s = scenario([], { defs: DEFS3, p1: { hand: ['Test Cipher Rite', 'Test Smite'], battlefield: ['Test Bear', 'Test Wolf'] } });
    let t = resolveTop(castRite(s, 'Test Bear'));
    t = resolveTop(castAuto(t, 'Test Smite', { answers: [{ kind: 'chooseTargets', targets: [{ kind: 'object', id: find(t, 'Test Bear', 'battlefield') }] }] }));
    expect(inZone(t, 'exile', 'Test Cipher Rite')).toBe(true);
    const u = attackAndCast(t, 'Test Wolf');
    expect(life1(u)).toBe(21); // the Wolf was never encoded
  });
});

