/**
 * The manual adjustments `discard` (CR 701.9a) and `tokenCopy` (CR 707.2, 111.1; haste CR 707.9a, 702.10; the next end step CR 603.7), applied while a spell is
 * resolved by hand (a Lightning Bolt compiled as manual text).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, type GameState, type ManualOp, type OracleCard } from '../../src/index';
import { getChars } from '../../src/rules/characteristics';
import { act, answer, find, lifeOf, logHas, pass, scenario } from './helpers';

const WATCHER = compileCard({ name: 'Test Watcher', layout: 'normal', mana_cost: '{1}', type_line: 'Creature — Spirit', oracle_text: 'Whenever a player discards a card, you gain 1 life.', colors: [], power: '1', toughness: '1' } as OracleCard);

/** Alice casts a Lightning Bolt resolved by hand: the state at its manualResolve decision. */
function byHand(extra: { hand?: string[]; battlefield?: string[] } = {}, before?: (s: GameState) => GameState): GameState {
  let s0 = scenario(['Lightning Bolt', 'Mountain', 'Grizzly Bears', 'Forest', 'Delver of Secrets // Insectile Aberration'], {
    p1: { hand: ['Lightning Bolt', ...(extra.hand ?? [])], battlefield: ['Mountain', 'Grizzly Bears', ...(extra.battlefield ?? [])] },
    defs: [WATCHER],
    manual: ['Lightning Bolt'],
  });
  // a change to the state goes in before the cast: an answer is replayed from the state the action started in
  if (before) s0 = before(s0);
  let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Lightning Bolt', 'hand') });
  s = answer(s, { kind: 'payCost', auto: true });
  s = pass(pass(s));
  expect(s.pending?.kind).toBe('manualResolve');
  return s;
}

/** Pass priority (answering trigger orders) until `done` or the turn is over. */
function passUntil(s0: GameState, done: (s: GameState) => boolean): GameState {
  let s = s0;
  for (let i = 0; i < 80 && !done(s) && s.turn.number === s0.turn.number; i++) {
    if (s.pending?.kind === 'order') s = answer(s, { kind: 'order', ids: (s.pending as unknown as { items: { id: string }[] }).items.map((x) => x.id) });
    else if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else s = pass(s);
  }
  return s;
}

const tokensNamed = (s: GameState, name: string) => s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token' && s.defs[s.objects[id]!.defId]?.name === name);

describe('manual discard (CR 701.9a)', () => {
  it('discards a card from the hand into the graveyard, as a discard: "whenever a player discards" triggers', () => {
    let s = byHand({ hand: ['Forest'], battlefield: ['Test Watcher'] });
    const forest = find(s, 'Forest', 'hand', 'p1');
    const before = lifeOf(s, 'p1');
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'discard', object: forest }] });
    s = passUntil(s, (x) => lifeOf(x, 'p1') > before);
    expect(s.zones.hand['p1']!.some((id) => s.defs[s.objects[id]!.defId]?.name === 'Forest')).toBe(false);
    expect(s.zones.graveyard['p1']!.some((id) => s.defs[s.objects[id]!.defId]?.name === 'Forest')).toBe(true);
    expect(logHas(s, /Alice discards Forest by hand/, 'CR 701.9a')).toBe(true);
    expect(lifeOf(s, 'p1')).toBe(before + 1);
  });

  it('refuses a card that is not in a hand', () => {
    const s = byHand();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    const r = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'manualResolve', ops: [{ op: 'discard', object: bears }] } });
    expect(r.error?.message).toMatch(/only a card in a hand can be discarded/);
  });
});

describe('manual token copy (CR 707.2, 111.1)', () => {
  it('with haste, sacrificed at the beginning of the next end step (Kiki-Jiki, Splinter Twin)', () => {
    let s = byHand();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    s = answer(s, { kind: 'manualResolve', ops: [{ op: 'tokenCopy', object: bears, player: 'p1', haste: true, atNextEndStep: 'sacrifice' }] });
    const [token] = tokensNamed(s, 'Grizzly Bears');
    expect(token).toBeDefined();
    expect(s.objects[token!]!.controller).toBe('p1');
    expect(getChars(s, token!).keywords.map((k) => k.keyword)).toContain('haste');
    expect([getChars(s, token!).power, getChars(s, token!).toughness].map(Number)).toEqual([2, 2]);
    expect(logHas(s, /creates a token that's a copy of Grizzly Bears, with haste,/, 'CR 707.2')).toBe(true);
    expect(s.delayedTriggers).toHaveLength(1);
    // Still there in combat; gone after the end step's trigger resolves (CR 603.7, 701.21a)
    s = passUntil(s, (x) => x.turn.step === 'end');
    expect(s.zones.battlefield).toContain(token);
    s = passUntil(s, (x) => !x.zones.battlefield.includes(token!));
    expect(s.zones.battlefield).not.toContain(token);
    expect(s.zones.battlefield).toContain(bears);
    expect(tokensNamed(s, 'Grizzly Bears')).toHaveLength(0);
  });

  it('without haste, exiled at the next end step; and kept when nothing is said', () => {
    let s = byHand();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    const ops: ManualOp[] = [{ op: 'tokenCopy', object: bears, player: 'p2', atNextEndStep: 'exile' }, { op: 'tokenCopy', object: bears, player: 'p1' }];
    s = answer(s, { kind: 'manualResolve', ops });
    const tokens = tokensNamed(s, 'Grizzly Bears');
    expect(tokens.map((id) => s.objects[id]!.controller).sort()).toEqual(['p1', 'p2']);
    expect(tokens.every((id) => !getChars(s, id).keywords.some((k) => k.keyword === 'haste'))).toBe(true);
    // CR 603.7d: the delayed trigger is the resolving player's (Alice's Bolt), whoever got the token
    expect(s.delayedTriggers.map((d) => d.controller)).toEqual(['p1']);
    const bobs = tokens.find((id) => s.objects[id]!.controller === 'p2')!;
    s = passUntil(s, (x) => !x.zones.battlefield.includes(bobs));
    expect(s.zones.battlefield).not.toContain(bobs);
    expect(tokensNamed(s, 'Grizzly Bears').map((id) => s.objects[id]!.controller)).toEqual(['p1']);
  });

  it('refuses a card that is not on the battlefield', () => {
    const s = byHand({ hand: ['Forest'] });
    const forest = find(s, 'Forest', 'hand', 'p1');
    const r = applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'manualResolve', ops: [{ op: 'tokenCopy', object: forest, player: 'p1' }] } });
    expect(r.error?.message).toMatch(/only a permanent on the battlefield can be copied/);
  });

  const refused = (s: GameState, op: ManualOp) => applyAction(s, { type: 'answer', player: 'p1', decisionId: s.pending!.id, answer: { kind: 'manualResolve', ops: [op] } }).error;

  it('CR 603.7d, 701.21a: a token another player gets is not "sacrificed" by the resolving player at the end step: exile it instead', () => {
    const s = byHand();
    const bears = find(s, 'Grizzly Bears', 'battlefield', 'p1');
    expect(refused(s, { op: 'tokenCopy', object: bears, player: 'p2', atNextEndStep: 'sacrifice' })).toMatchObject({ message: expect.stringMatching(/exile it instead/), rules: expect.arrayContaining(['CR 701.21a']) });
  });

  it('what the copy step would hand back to be done by hand is refused with the reason (phased out; a double-faced card with haste)', () => {
    const s = byHand({ battlefield: [{ name: 'Delver of Secrets // Insectile Aberration', face: 1 } as never] });
    const delver = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Delver of Secrets // Insectile Aberration')!;
    expect(refused(s, { op: 'tokenCopy', object: delver, player: 'p1', haste: true })?.message).toMatch(/can't be made automatically.*Create a token/);
    const phased = byHand({}, (x) => {
      const id = find(x, 'Grizzly Bears', 'battlefield', 'p1');
      return { ...x, objects: { ...x.objects, [id]: { ...x.objects[id]!, phasedOut: true } } };
    });
    expect(refused(phased, { op: 'tokenCopy', object: find(phased, 'Grizzly Bears', 'battlefield', 'p1'), player: 'p1' })?.message).toMatch(/phased out/);
  });
});
