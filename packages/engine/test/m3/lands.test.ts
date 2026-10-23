import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, legalActions, type OracleCard } from '../../src/index';
import { act, advanceTo, answer, castAuto, find, labels, legal, life, pass, reject, scenario } from './scenario';

describe('playing a land (CR 305, 116.2a)', () => {
  it('CR 305.1: a land goes straight onto the battlefield and is never a spell', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Forest'] } });
    const card = find(s, 'Forest', 'hand');
    const r = applyAction(s, { type: 'playLand', player: 'p1', card });
    expect(r.error).toBeUndefined();
    expect(r.events.map((e) => e.type)).toContain('landPlayed');
    s = r.state;
    expect(s.zones.stack).toEqual([]);
    expect(s.zones.battlefield.map((id) => s.objects[id]!.defId)).toEqual(['Forest']);
    expect(s.zones.hand.p1).toHaveLength(0);
    expect(s.objects[s.zones.battlefield[0]!]).toMatchObject({ controller: 'p1', tapped: false, controlledSinceTurn: 1 });
  });

  it('CR 116.2a, 117.3c: playing a land does not use the stack and the player keeps priority', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Forest'] } });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') });
    expect(s.pending).toMatchObject({ kind: 'priority', player: 'p1' });
    expect(s.priority.passes).toBe(0);
    expect(s.turn.step).toBe('main1');
  });

  it('CR 305.2: only one land per turn; the count resets on the next turn', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Forest', 'Forest', 'Forest'] }, });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') });
    expect(labels(s, 'p1').filter((l) => l.startsWith('Play'))).toEqual([]);
    const err = reject(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') });
    expect(err.rules).toContain('CR 305.2');
    s = advanceTo(s, 3, 'main1');
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(0);
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') });
    expect(s.zones.battlefield).toHaveLength(2);
  });

  it('CR 305.2a: the land may be played in the second main phase if none was played before', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Forest'] } });
    s = advanceTo(s, 1, 'main2');
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') });
    expect(s.zones.battlefield).toHaveLength(1);
  });

  it('CR 305.1: lands are played only in your own main phase', () => {
    let s = scenario(['Forest'], { p1: { hand: ['Forest'] } });
    s = advanceTo(s, 1, 'beginCombat');
    expect(reject(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') }).message).toMatch(/main phase/);
    s = scenario(['Forest'], { p1: { hand: ['Forest'] } });
    s = advanceTo(s, 2, 'main1');
    s = pass(s);
    expect(reject(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') }).message).toMatch(/own turn/);
  });

  it('CR 305.1, 116.2a: lands cannot be played while the stack is not empty', () => {
    let s = scenario(['Lightning Bolt', 'Forest', 'Mountain'], { p1: { hand: ['Lightning Bolt', 'Forest'], battlefield: ['Mountain'] }, manual: ['Lightning Bolt'] });
    s = castAuto(s, 'Lightning Bolt');
    expect(reject(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand') }).message).toMatch(/stack is empty/);
    expect(labels(s, 'p1').some((l) => l.startsWith('Play'))).toBe(false);
  });

  it('CR 305.1: only land cards from your hand can be played', () => {
    const s = scenario(['Forest', 'Grizzly Bears'], { p1: { hand: ['Grizzly Bears'], graveyard: ['Forest'] }, p2: { hand: ['Forest'] } });
    expect(reject(s, { type: 'playLand', player: 'p1', card: find(s, 'Grizzly Bears', 'hand') }).message).toMatch(/not a land card/);
    expect(reject(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'graveyard') }).message).toMatch(/from your hand/);
    // M1 (audit 2026-10-12, CR 400.2): a card in another player's hand is hidden: one answer whatever it is.
    expect(reject(s, { type: 'playLand', player: 'p1', card: find(s, 'Forest', 'hand', 'p2') }).message).toBe("You can't play that card.");
  });

  it('CR 117.1: the non-active player cannot play a land on their opponent\'s turn even with priority', () => {
    let s = scenario(['Forest'], { p2: { hand: ['Forest'] } });
    s = pass(s);
    expect(s.pending!.player).toBe('p2');
    expect(reject(s, { type: 'playLand', player: 'p2', card: find(s, 'Forest', 'hand', 'p2') }).message).toMatch(/own turn/);
  });

  it('a land that is also a creature (Dryad Arbor) can be played as a land', () => {
    let s = scenario(['Dryad Arbor'], { p1: { hand: ['Dryad Arbor'] } });
    expect(labels(s, 'p1')).toContain('Play Dryad Arbor');
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Dryad Arbor', 'hand') });
    expect(s.zones.battlefield).toHaveLength(1);
  });

  it('CR 712.12: only a land face of a modal double-faced card can be played; the face is chosen when playing', () => {
    const name = 'Agadeem\'s Awakening // Agadeem, the Undercrypt';
    const s = scenario([name], { p1: { hand: [name] } });
    expect(reject(s, { type: 'playLand', player: 'p1', card: find(s, name, 'hand'), face: 0 }).message).toMatch(/not a land/);
    let t = act(s, { type: 'playLand', player: 'p1', card: find(s, name, 'hand') }); // default: the first land face
    // W3b: the back face's "As ~ enters, you may pay 3 life. If you don't, it enters tapped." is understood (CR 614.12a): the player is asked first
    expect(t.pending).toMatchObject({ kind: 'yesNo', player: 'p1', rules: ['CR 614.12a', 'CR 118.12'] });
    t = answer(t, { kind: 'yesNo', yes: false });
    expect(t.objects[t.zones.battlefield[0]!]!.face).toBe(1);
    expect(t.objects[t.zones.battlefield[0]!]!.tapped).toBe(true);
  });

  it('legalActions lists a Play action for every land in hand', () => {
    const s = scenario(['Forest', 'Mountain'], { p1: { hand: ['Forest', 'Mountain'] } });
    expect(legal(s, 'p1', 'playLand').map((a) => a.label)).toEqual(['Play Forest', 'Play Mountain']);
    expect(legalActions(s, 'p2')).toEqual([]);
  });
});

describe('lands with rules text the engine cannot automate yet', () => {
  it('playing a land with manual text works but logs a visible manual warning (never silently ignored)', () => {
    // W3b: the shock land of this test is automated now (below). CMD5: a painland's damage line is automated now too (cloud/cmd5/cmd5-mana.test.ts); a mana
    // ability with another instruction beside the mana stays manual text (CR 605: a mana ability with an extra effect; invented wording)
    const grove = compileCard({ name: 'Test Gift Grove', layout: 'normal', mana_cost: '', type_line: 'Land', oracle_text: '{T}: Add {C}.\n{T}: Add {R} or {G}. Each opponent gains 1 life.', colors: [] } as OracleCard);
    let s = scenario([], { defs: [grove], p1: { hand: ['Test Gift Grove'] } });
    s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Test Gift Grove', 'hand') });
    const warn = s.log.filter((l) => l.level === 'manual');
    expect(warn).toHaveLength(1);
    expect(warn[0]!.text).toMatch(/Test Gift Grove has rules text the engine cannot automate yet.*Each opponent gains 1 life/);
  });
});

describe('a shock land (CR 614.12a, 305.6)', () => {
  it('W3b: "As ~ enters, you may pay 2 life. If you do not, it enters tapped." asks the player, with no manual warning', () => {
    const play = (yes: boolean) => {
      let s = scenario(['Watery Grave'], { p1: { hand: ['Watery Grave'] } });
      s = act(s, { type: 'playLand', player: 'p1', card: find(s, 'Watery Grave', 'hand') });
      expect(s.pending).toMatchObject({ kind: 'yesNo', player: 'p1', yesLabel: 'Pay 2 life', noLabel: 'Enter tapped' });
      s = answer(s, { kind: 'yesNo', yes });
      expect(s.log.filter((l) => l.level === 'manual')).toEqual([]);
      return s;
    };
    const paid = play(true);
    expect(life(paid, 'p1')).toBe(18);
    expect(paid.objects[find(paid, 'Watery Grave', 'battlefield')]!.tapped).toBe(false);
    // The basic land types still give both mana abilities (CR 305.6).
    expect(legal(paid, 'p1', 'activate').map((a) => a.label)).toEqual(['Watery Grave: {T}: Add {U}.', 'Watery Grave: {T}: Add {B}.']);
    const tapped = play(false);
    expect(life(tapped, 'p1')).toBe(20);
    expect(tapped.objects[find(tapped, 'Watery Grave', 'battlefield')]!.tapped).toBe(true);
  });
});
