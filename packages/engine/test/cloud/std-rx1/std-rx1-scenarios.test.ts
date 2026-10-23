/**
 * Standard round rx1 (std-rx1, wave 2 slice s26): the round's readings played through the engine with synthetic cards compiled by the game's default compiler
 * (invented names and wordings, design 6.10). Each test is named after the rule it checks (CR cites from memory, unverified: rules/cr/ is not in the cloud
 * checkout).
 *
 *   CR 604.1, 601.3, 602.5, 605.1a, 506.1   "During combat, players can't cast spells or activate abilities that aren't mana abilities"
 *                                           (sta.stdrx1.combat.cantCastOrActivate.nonMana): in the combat phase no spell and no non-mana activation, for
 *                                           every player; a mana ability is still activated; in a main phase both are allowed again
 *   CR 603.4, 107.1, 608.2h, 111.4         "if a land entered the battlefield under your control this turn and you control a prime number of lands, create
 *                                           <Name>, the <Epithet>, a legendary 0/0 ... token, then put that many +1/+1 counters on it": three lands make a 3/3
 *                                           named token; four lands, or no land entering this turn, make nothing
 *   CR 701.20a, 608.2c, 401.4, 110.2a      "Look at the top five cards ... You may reveal up to two creature and/or land cards from among them, then put the rest on
 *                                           the bottom of your library in a random order. Put all land cards revealed this way onto the battlefield tapped and put
 *                                           all creature cards revealed this way into your hand.": the chosen land enters tapped, the chosen creature goes to hand,
 *                                           the three others go to the bottom; choosing none moves all five to the bottom
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, advanceTo, answer, find, pass, reject, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, opts: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [],
    ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}),
  } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';

/** Both players pass until the stack is empty (no decisions are expected on the way). */
function resolveAll(s0: GameState): GameState {
  let s = s0;
  for (let guard = 0; s.zones.stack.length > 0 && guard < 40; guard++) s = pass(s);
  return s;
}

describe('CR 604.1, 601.3, 602.5, 605.1a, 506.1: "During combat, players can\'t cast spells or activate abilities that aren\'t mana abilities"', () => {
  const MARSHAL = card('Test Duel Marshal', 'Creature — Human Samurai', "During combat, players can't cast spells or activate abilities that aren't mana abilities.", { pt: ['3', '3'] });
  const ZAP = card('Test Zap', 'Instant', 'Test Zap deals 1 damage to any target.');
  const TOTEM = card('Test Totem', 'Artifact', '{T}: You gain 1 life.');
  const defs = [MARSHAL, ZAP, TOTEM];
  const activations = (s: GameState, player: 'p1' | 'p2', source: string): number => legalActions(s, player).filter((x) => x.kind === 'activate' && x.object === source).length;

  it('is fully automated', () => expect(full(MARSHAL), JSON.stringify(MARSHAL.automation)).toBe(true));
  it('in the beginning of combat step no player may cast a spell, its controller included', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Zap'], battlefield: ['Test Duel Marshal'] }, p2: { hand: ['Test Zap'] } });
    const combat = advanceTo(s0, 1, 'beginCombat');
    expect(reject(combat, { type: 'cast', player: 'p1', card: find(combat, 'Test Zap', 'hand', 'p1') }).message).toBeTruthy();
    const theirs = pass(combat);
    expect(theirs.turn.step).toBe('beginCombat');
    expect(reject(theirs, { type: 'cast', player: 'p2', card: find(theirs, 'Test Zap', 'hand', 'p2') }).message).toBeTruthy();
  });
  it('in the main phase the same spell is cast', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Zap'], battlefield: ['Test Duel Marshal'] } });
    expect(() => act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Zap', 'hand', 'p1') })).not.toThrow();
  });
  it('a non-mana activated ability can be activated in the main phase but not during combat; a mana ability (a Forest) still can', () => {
    const s0 = scenario(['Forest'], { defs, p1: { battlefield: ['Test Duel Marshal', 'Test Totem', 'Forest'] } });
    const totem = find(s0, 'Test Totem', 'battlefield', 'p1');
    const forest = find(s0, 'Forest', 'battlefield', 'p1');
    expect(activations(s0, 'p1', totem)).toBeGreaterThan(0);
    const combat = advanceTo(s0, 1, 'beginCombat');
    expect(activations(combat, 'p1', totem)).toBe(0);
    expect(legalActions(combat, 'p1').some((x) => x.object === forest)).toBe(true);
  });
  it('without the Marshal, the totem is activated during combat (the restriction comes from it)', () => {
    const s0 = scenario([], { defs, p1: { battlefield: ['Test Totem'] } });
    const combat = advanceTo(s0, 1, 'beginCombat');
    expect(activations(combat, 'p1', find(combat, 'Test Totem', 'battlefield', 'p1'))).toBeGreaterThan(0);
  });
});

describe('CR 603.4, 107.1, 608.2h, 111.4: "if a land entered ... and you control a prime number of lands, create <Name>, the <Epithet>, ..., then put that many +1/+1 counters on it"', () => {
  const SAGE = card('Test Prime Sage', 'Legendary Creature — Human Wizard',
    'At the beginning of your end step, if a land entered the battlefield under your control this turn and you control a prime number of lands, create Quillo, the Unbroken, a legendary 0/0 red Elemental creature token, then put that many +1/+1 counters on it.',
    { pt: ['1', '3'] });
  const defs = [SAGE];
  const tokens = (s: GameState): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token');
  const playLand = (s: GameState): GameState => act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand', 'p1') });

  it('is fully automated', () => expect(full(SAGE), JSON.stringify(SAGE.automation)).toBe(true));
  it('three lands after playing one: a token named "Quillo, the Unbroken" with three +1/+1 counters (a 3/3)', () => {
    const s0 = scenario(['Forest'], { defs, p1: { hand: ['Forest'], battlefield: ['Test Prime Sage', 'Forest', 'Forest'] } });
    const s = resolveAll(advanceTo(playLand(s0), 1, 'end'));
    const made = tokens(s);
    expect(made.length).toBe(1);
    const c = getChars(s, made[0]!);
    expect(c.names).toContain('Quillo, the Unbroken');
    expect(s.objects[made[0]!]!.counters['+1/+1']).toBe(3);
    expect([Number(c.power), Number(c.toughness)]).toEqual([3, 3]);
  });
  it('four lands (not prime) after playing one: no token', () => {
    const s0 = scenario(['Forest'], { defs, p1: { hand: ['Forest'], battlefield: ['Test Prime Sage', 'Forest', 'Forest', 'Forest'] } });
    const s = resolveAll(advanceTo(playLand(s0), 1, 'end'));
    expect(tokens(s)).toEqual([]);
  });
  it('three lands but no land entered this turn: no token', () => {
    const s0 = scenario(['Forest'], { defs, p1: { battlefield: ['Test Prime Sage', 'Forest', 'Forest', 'Forest'] } });
    const s = resolveAll(advanceTo(s0, 1, 'end'));
    expect(tokens(s)).toEqual([]);
  });
});

describe('CR 701.20a, 608.2c, 401.4, 110.2a: reveal up to two creature and/or land cards, the rest to the bottom, lands onto the battlefield tapped, creatures into hand', () => {
  const STUDY = card('Test Field Study', 'Sorcery',
    'Look at the top five cards of your library. You may reveal up to two creature and/or land cards from among them, then put the rest on the bottom of your library in a random order. Put all land cards revealed this way onto the battlefield tapped and put all creature cards revealed this way into your hand.');
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const IDOL = card('Test Idol', 'Artifact', '');
  const defs = [STUDY, BEAR, IDOL];
  const LIB = ['Forest', 'Test Bear', 'Test Idol', 'Test Idol', 'Forest'];

  /** Cast the study, answer the choice of up to two cards with the named cards, and resolve. */
  function study(pickNames: string[]): GameState {
    const s0 = scenario(['Forest'], { defs, p1: { hand: ['Test Field Study'], library: LIB } });
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Field Study', 'hand', 'p1') });
    for (let guard = 0; guard < 40 && (s.zones.stack.length > 0 || s.pending?.kind !== 'priority'); guard++) {
      const d = s.pending!;
      if (d.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
      else if (d.kind === 'chooseObjects') {
        const opts = (d as unknown as { options: string[] }).options;
        const ids: string[] = [];
        for (const n of pickNames) { const id = opts.find((o) => s.objects[o]!.defId === n && !ids.includes(o)); if (id) ids.push(id); }
        s = answer(s, { kind: 'chooseObjects', ids });
      } else if (d.kind === 'priority') s = pass(s);
      else break;
    }
    return s;
  }
  const names = (s: GameState, ids: string[]): string[] => ids.map((id) => s.objects[id]!.defId);

  it('is fully automated', () => expect(full(STUDY), JSON.stringify(STUDY.automation)).toBe(true));
  it('choosing a Forest and the Bear: the Forest enters tapped, the Bear goes to hand, the other three go to the bottom', () => {
    const s = study(['Forest', 'Test Bear']);
    const forests = s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Forest');
    expect(forests.length).toBe(1);
    expect(s.objects[forests[0]!]!.tapped).toBe(true);
    expect(names(s, s.zones.hand.p1!)).toEqual(['Test Bear']);
    const lib = s.zones.library.p1!;
    expect(names(s, lib.slice(-3)).sort()).toEqual(['Forest', 'Test Idol', 'Test Idol']);
    expect(names(s, lib.slice(0, 1))).toEqual(['Plains']); // the twenty Plains under the five are now on top
  });
  it('choosing nothing: no card moves to the battlefield or hand, all five go to the bottom', () => {
    const s = study([]);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.defId === 'Forest')).toEqual([]);
    expect(s.zones.hand.p1).toEqual([]);
    expect(names(s, s.zones.library.p1!.slice(-5)).sort()).toEqual(['Forest', 'Forest', 'Test Bear', 'Test Idol', 'Test Idol']);
  });
});
